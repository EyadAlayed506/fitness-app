/**
 * Spoken feedback for hands-free sets ("Saved: 8 reps at 60 kilos", "Rest is over. Next: …").
 *
 * The speech goes wherever the phone's sound goes: headphones (wired or Bluetooth) when they're connected,
 * otherwise the speaker. Music from other apps is turned down while the app speaks, then back up.
 */
import { setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";

let speaking = 0;

export async function speak(text: string): Promise<void> {
  try {
    // playback (not recording): iOS sends it to the headphones' normal output, not the call channel
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: "duckOthers" });
  } catch {
    // no audio session to set (e.g. the browser): speak anyway
  }
  speaking++;
  const done = () => {
    speaking = Math.max(0, speaking - 1);
    if (speaking === 0) setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
  };
  Speech.speak(text, { rate: 1.0, onDone: done, onStopped: done, onError: done });
}

export function stopSpeaking() {
  Speech.stop().catch(() => {});
}

/** "60 kilos", "135 pounds", "bodyweight" */
export function spokenWeight(weight: number, unit: string): string {
  if (weight <= 0) return "bodyweight";
  const n = Number.isInteger(weight) ? String(weight) : weight.toFixed(1).replace(/\.0$/, "");
  return `${n} ${unit === "lb" ? "pounds" : "kilos"}`;
}
