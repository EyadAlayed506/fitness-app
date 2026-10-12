import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useState } from "react";
import { Platform } from "react-native";

import { api } from "./api";

export const MAX_SECONDS = 120; // voice messages are short; recording stops by itself after two minutes

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Record a voice message and turn it into text on the backend (Whisper on the PC).
 * `onText` gets the words; nothing is sent to the coach until the user taps send.
 */
export function useVoiceMessage(onText: (text: string) => void, onError: (message: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<VoiceState>("idle");
  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      onError("Allow the microphone to send voice messages (in your phone's settings).");
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: MAX_SECONDS }); // stops by itself at the limit; tap stop to send
    setState("recording");
  };

  const stop = async () => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) {
      setState("idle");
      onError("Nothing was recorded. Try again.");
      return;
    }
    setState("transcribing");
    try {
      const web = Platform.OS === "web";
      const { text } = await api<{ text: string }>("/assistant/transcribe", {
        method: "POST",
        upload: { field: "audio", uri, name: web ? "voice.webm" : "voice.m4a", type: web ? "audio/webm" : "audio/mp4" },
      });
      onText(text);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setState("idle");
    }
  };

  return {
    state,
    seconds,
    toggle: () => (state === "recording" ? stop() : state === "idle" ? start() : Promise.resolve()).catch((e) => {
      setState("idle");
      onError((e as Error).message || "The microphone isn't available.");
    }),
  };
}
