/**
 * Spoken feedback for hands-free sets ("Saved: 8 reps at 60 kilos", "Rest is over. Next: …").
 *
 * The speech goes wherever the phone's sound goes: headphones (wired or Bluetooth) when they're connected,
 * otherwise the speaker. Music from other apps is turned down while the app speaks, then back up.
 *
 * Hands-free listening and speaking share the microphone's audio session, so:
 * - while hands-free is recording, speaking keeps the session in record mode (switching it would stop the
 *   recording on iPhones), and the listener ignores what it hears while the app speaks;
 * - the app doesn't start talking while the user is mid-sentence (it waits a few seconds at most).
 */
import { setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";

let speaking = 0;
let recordingActive = false;
let userSpeaking = false;
const WAIT_FOR_USER_MS = 4000;

/** The app is saying something right now (the hands-free listener ignores the microphone meanwhile). */
export const isSpeaking = () => speaking > 0;

/** Set by the hands-free listener while it records, so speaking doesn't switch the audio session. */
export function setRecordingActive(on: boolean) {
  recordingActive = on;
}

/** Set by the hands-free listener while it hears someone talk, so the app doesn't talk over them. */
export function setUserSpeaking(on: boolean) {
  userSpeaking = on;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Say something. Resolves when it has been said (or couldn't be). */
export async function speak(text: string): Promise<void> {
  for (let waited = 0; userSpeaking && waited < WAIT_FOR_USER_MS; waited += 200) await sleep(200);
  try {
    // playback without recording: iOS sends it to the headphones' normal output, not the call channel
    await setAudioModeAsync(
      recordingActive
        ? { playsInSilentMode: true, allowsRecording: true, interruptionMode: "duckOthers" }
        : { playsInSilentMode: true, allowsRecording: false, interruptionMode: "duckOthers" },
    );
  } catch {
    // no audio session to set (e.g. the browser): speak anyway
  }
  speaking++;
  await new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      speaking = Math.max(0, speaking - 1);
      if (speaking === 0) setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
      resolve();
    };
    // if the phone never reports the end (no voice installed), don't wait forever
    setTimeout(done, 1500 + text.length * 90);
    try {
      Speech.speak(text, { rate: 1.0, onDone: done, onStopped: done, onError: done });
    } catch {
      done();
    }
  });
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
