/**
 * Hands-free listening: the microphone stays on (only while hands-free is switched on, with the app open),
 * the phone itself finds speech in the loudness (speechDetector.ts), and only those moments are recorded and
 * sent to Whisper on the user's PC. The text comes back and the caller checks it for the wake word.
 *
 * - Silence and background noise are never sent: the recording is thrown away and started again.
 * - One microphone session at a time; while the app speaks, what the microphone hears is thrown away.
 * - In the background (or with the screen locked) Expo Go can't use the microphone, so listening pauses and
 *   starts again when the app is back.
 */
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { api, ApiError } from "./api";
import { isSpeaking, setRecordingActive, setUserSpeaking } from "./speech";
import { SpeechDetector } from "./speechDetector";

export type ListenerStatus = "off" | "starting" | "listening" | "hearing" | "thinking" | "paused" | "error";

const TICK_MS = 100;
const DROP_SILENCE_AFTER_MS = 30_000; // a recording with nobody speaking is thrown away after this
const OPTIONS: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

interface LoopCallbacks {
  prompt: () => string;
  onText: (text: string) => Promise<void>;
  onError: (message: string, fatal: boolean) => void;
  onStatus: (s: ListenerStatus) => void;
  onLevel: (db: number) => void;
}

/** The microphone loop, outside React: one instance per "switched on" period. */
class ListenLoop {
  private on = false;
  private recording = false;
  private busy = false; // stopping/starting the recorder
  private since = 0;
  private heardSelf = false;
  private detector = new SpeechDetector();
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: string[] = [];
  private sending = false;
  private lastLevelAt = 0;
  private lastNetworkError = 0;
  private recorder: AudioRecorder;
  private cb: LoopCallbacks;

  constructor(recorder: AudioRecorder, cb: LoopCallbacks) {
    this.recorder = recorder;
    this.cb = cb;
  }

  async start() {
    if (this.on) return;
    this.cb.onStatus("starting");
    const permission = await requestRecordingPermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      this.cb.onStatus("error");
      this.cb.onError("Hands-free needs the microphone. Allow it in your phone's settings, then try again.", true);
      return;
    }
    try {
      // a headset's microphone (wired or Bluetooth) is used when one is connected
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      this.on = true;
      this.detector = new SpeechDetector();
      await this.startRecording();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.cb.onStatus("listening");
    } catch (e) {
      await this.stop("error");
      this.cb.onError((e as Error).message || "The microphone isn't available.", true);
    }
  }

  async stop(next: ListenerStatus) {
    this.on = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    setUserSpeaking(false);
    await this.stopRecording();
    setRecordingActive(false);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    this.cb.onLevel(-160);
    this.cb.onStatus(next);
  }

  private async startRecording() {
    await this.recorder.prepareToRecordAsync();
    this.recorder.record();
    this.recording = true;
    this.since = Date.now();
    this.detector.reset(this.since);
    setRecordingActive(true);
  }

  private async stopRecording(): Promise<string | null> {
    if (!this.recording) return null;
    this.recording = false;
    try {
      await this.recorder.stop();
    } catch {
      return null;
    }
    return this.recorder.uri ?? null;
  }

  /** Throw the current recording away and start a new one (silence, or the app's own voice). */
  private async restart() {
    if (this.busy || !this.on) return;
    this.busy = true;
    try {
      await this.stopRecording();
      if (this.on) await this.startRecording();
    } catch (e) {
      this.cb.onError((e as Error).message || "The microphone stopped.", true);
    } finally {
      this.busy = false;
    }
  }

  private async send() {
    if (this.sending) return;
    const uri = this.queue.shift();
    if (!uri) return;
    this.sending = true;
    this.cb.onStatus("thinking");
    try {
      const web = Platform.OS === "web";
      const { text } = await api<{ text: string }>("/assistant/transcribe", {
        method: "POST",
        upload: {
          field: "audio",
          uri,
          name: web ? "command.webm" : "command.m4a",
          type: web ? "audio/webm" : "audio/mp4",
          fields: { prompt: this.cb.prompt() },
        },
      });
      if (this.on) await this.cb.onText(text);
    } catch (e) {
      // 422: no words in it (a noise). Anything else: tell the user, at most every 30 s
      const status = e instanceof ApiError ? e.status : 0;
      if (status !== 422 && Date.now() - this.lastNetworkError > 30_000) {
        this.lastNetworkError = Date.now();
        this.cb.onError(status === 0 ? "Can't reach your PC to understand speech. Is the backend running?" : (e as Error).message, false);
      }
    } finally {
      this.sending = false;
      if (this.on) this.cb.onStatus("listening");
      if (this.queue.length) void this.send();
    }
  }

  private async tick() {
    if (!this.on || this.busy || !this.recording) return;
    const now = Date.now();
    if (isSpeaking()) {
      this.heardSelf = true; // the microphone is hearing the app: ignore, and drop it afterwards
      return;
    }
    if (this.heardSelf) {
      this.heardSelf = false;
      await this.restart();
      return;
    }
    let db = -160;
    try {
      db = this.recorder.getStatus().metering ?? -160;
    } catch {
      return;
    }
    if (now - this.lastLevelAt > 250) {
      this.lastLevelAt = now;
      this.cb.onLevel(db);
    }
    const event = this.detector.feed(db, now);
    setUserSpeaking(this.detector.inSpeech);
    if (event?.type === "speech_start") this.cb.onStatus("hearing");
    else if (event?.type === "discard") {
      this.cb.onStatus(this.sending ? "thinking" : "listening");
      await this.restart();
    } else if (event?.type === "speech_end") {
      this.busy = true;
      try {
        const uri = await this.stopRecording();
        if (this.on) await this.startRecording(); // keep listening while this one is understood
        if (uri) {
          this.queue = [...this.queue.slice(-1), uri]; // at most one waiting: commands are short
          void this.send();
        }
      } catch (e) {
        this.cb.onError((e as Error).message || "The microphone stopped.", true);
      } finally {
        this.busy = false;
        if (!this.sending) this.cb.onStatus("listening");
      }
    } else if (!this.detector.inSpeech && now - this.since > DROP_SILENCE_AFTER_MS) {
      await this.restart();
    }
  }
}

export function useWakeWordListener({
  enabled,
  prompt,
  onText,
  onError,
}: {
  enabled: boolean;
  /** words likely to be said (wake word, exercise names), to help Whisper */
  prompt: () => string;
  /** every utterance, as text (the caller checks the wake word) */
  onText: (text: string) => Promise<void>;
  /** the microphone can't be used (permission, no device); `fatal`: hands-free must stop */
  onError: (message: string, fatal: boolean) => void;
}) {
  const recorder = useAudioRecorder(OPTIONS);
  const [phase, setPhase] = useState<ListenerStatus>("off");
  const [level, setLevel] = useState(-160); // for the on-screen meter: proof the microphone is live
  const handlers = useRef({ prompt, onText, onError });
  useEffect(() => {
    handlers.current = { prompt, onText, onError };
  });

  // on/off, and pause while the app is in the background (Expo Go can't record there)
  useEffect(() => {
    if (!enabled) return;
    const loop = new ListenLoop(recorder, {
      prompt: () => handlers.current.prompt(),
      onText: (t) => handlers.current.onText(t),
      onError: (m, fatal) => handlers.current.onError(m, fatal),
      onStatus: setPhase,
      onLevel: setLevel,
    });
    if (AppState.currentState === "active" || Platform.OS === "web") void loop.start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loop.start();
      else if (Platform.OS !== "web") void loop.stop("paused");
    });
    return () => {
      sub.remove();
      void loop.stop("off");
    };
  }, [enabled, recorder]);

  return { status: enabled ? (phase === "off" ? "starting" : phase) : ("off" as ListenerStatus), level: enabled ? level : -160 };
}
