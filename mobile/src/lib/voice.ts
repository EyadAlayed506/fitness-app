import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { api } from "./api";

export const MAX_SECONDS = 120; // voice messages are short; recording stops (and is sent to Whisper) after two minutes

export type VoiceState = "idle" | "recording" | "transcribing";

/** Whisper on the PC turns a recording into text. */
async function transcribe(uri: string): Promise<string> {
  const web = Platform.OS === "web";
  const { text } = await api<{ text: string }>("/assistant/transcribe", {
    method: "POST",
    upload: { field: "audio", uri, name: web ? "voice.webm" : "voice.m4a", type: web ? "audio/webm" : "audio/mp4" },
  });
  return text;
}

/**
 * Record a voice message and turn it into text on the backend (Whisper on the PC).
 * `onText` gets the words; nothing is sent to the coach until the user taps send.
 */
export function useVoiceMessage(
  onText: (text: string) => void,
  onError: (message: string) => void,
  maxSeconds: number = MAX_SECONDS,
) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<VoiceState>("idle");
  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);
  const recording = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the latest callbacks, also for a recording stopped by the time limit
  const handlers = useRef({ onText, onError });
  useEffect(() => {
    handlers.current = { onText, onError };
  });

  const failed = (e: unknown) => {
    recording.current = false;
    setState("idle");
    handlers.current.onError((e as Error).message || "The microphone isn't available.");
  };

  const stop = async () => {
    if (!recording.current) return;
    recording.current = false;
    if (limit.current) clearTimeout(limit.current);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) {
      setState("idle");
      handlers.current.onError("Nothing was recorded. Try again.");
      return;
    }
    setState("transcribing");
    try {
      handlers.current.onText(await transcribe(uri));
    } catch (e) {
      handlers.current.onError((e as Error).message);
    } finally {
      setState("idle");
    }
  };

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      handlers.current.onError("Allow the microphone to use your voice (in your phone's settings).");
      return false;
    }
    // a headset's microphone (wired or Bluetooth) is used when one is connected
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    // The time limit is kept here, not with record({ forDuration }): in the browser that timer isn't
    // cancelled by stop() and fails later. At the limit the recording is turned into text as usual.
    recorder.record();
    recording.current = true;
    setState("recording");
    limit.current = setTimeout(() => void stop().catch(failed), maxSeconds * 1000);
    return true;
  };

  return {
    state,
    seconds,
    start: () => start().catch((e) => (failed(e), false)),
    stop: () => stop().catch(failed),
    toggle: () => (state === "recording" ? stop() : state === "idle" ? start() : Promise.resolve()).catch(failed),
  };
}

/**
 * Hold to talk, let go to send. A quick tap (or a screen reader's double tap) starts listening instead,
 * and a second tap sends: no need to keep a finger on the screen.
 */
export function useHoldToTalk(onText: (text: string) => void, onError: (message: string) => void, maxSeconds = 15) {
  const voice = useVoiceMessage(onText, onError, maxSeconds);
  const pressedAt = useRef(0);
  const starting = useRef<Promise<boolean> | null>(null);
  const startedByThisPress = useRef(false);
  const HOLD_MS = 450;

  const begin = () => {
    const pending = voice.start();
    starting.current = pending;
    pending.then((ok) => {
      if (!ok && starting.current === pending) starting.current = null; // no microphone: nothing to stop
    });
  };
  const finish = async () => {
    const pending = starting.current;
    if (!pending) return; // already stopping
    starting.current = null;
    if (await pending) await voice.stop();
  };

  return {
    state: voice.state,
    seconds: voice.seconds,
    pressProps: {
      onPressIn: () => {
        startedByThisPress.current = voice.state === "idle" && !starting.current;
        if (!startedByThisPress.current) return; // a tap to stop: onPress handles it
        pressedAt.current = Date.now();
        begin();
      },
      onPressOut: () => {
        // held: let go to send. A quick tap keeps listening until the next tap.
        if (startedByThisPress.current && Date.now() - pressedAt.current >= HOLD_MS) void finish();
      },
      onPress: () => {
        if (startedByThisPress.current) {
          startedByThisPress.current = false;
          return;
        }
        if (starting.current) void finish();
        else if (voice.state === "idle") begin(); // a screen reader's double tap: start listening
      },
    },
  };
}
