# Hands-free workout mode

Say **"Chat, 12 reps at 25 kilos"** with the phone in your pocket: the set is saved, the rest timer starts, and the app answers out loud. This page explains how it works, what it needs, what it can't do yet, and how to test it on a phone.

## Using it

1. Start a workout (Workouts → Start).
2. In the workout card, tap **Turn on** under *Hands-free*. Allow the microphone the first time.
3. Say the wake word, then the command: "Chat, 12 reps at 25 kilos". The red dot and the moving bar show the microphone is live. The bar above the tabs shows **Listening** on other tabs.
4. When the app asks something ("At what weight?", "Delete Leg Press, 10 reps at 30 kilos?"), just answer within 15 seconds, without the wake word.
5. "Chat, stop listening" or **Turn off** stops it at once. Finishing or discarding the workout stops it too.

The wake word can be changed in the panel ("Wake word: Chat").

### What you can say

| Say | Does |
|---|---|
| "12 reps at 25 kilos", "add 25 kilos 12 reps", "12 times 25", "twelve twenty five", "25 kg x 12", "60 kg for 8", "weight 25, reps 12" | logs a set of the current exercise (reps and weight in any order; "kilos", "kg", "pounds") |
| "Chest press, first set, 15 reps at 20 kilograms" | logs a set of that exercise (and makes it the current one) |
| "3 sets of 10 at 60" | logs three sets |
| "Same again" | repeats the last set |
| "One more set, 8 reps at 100", "another set 12 reps 25 kilos" | an extra set of the current exercise, even when its planned sets are done |
| "12 reps" / "at 25 kilos" | asks for the missing weight / reps; "bodyweight" or "same weight" are answers too |
| "Rest 30 seconds", "start the timer" | starts a rest (a one-off length, or the exercise's usual one) |
| "Make the rest two minutes" | the rest running now lasts 2:00 in total |
| "Add 20 seconds", "extend my rest by 20 seconds", "take off 15 seconds" | changes only the rest running now |
| "Cancel the timer", "skip rest" | stops the rest |
| "How much rest is left?" | says the time left |
| "Set my default rest to 90 seconds" | the exercise's usual rest from now on |
| "Note: my left shoulder feels uncomfortable", "remember that this weight felt easy" | adds your words, unchanged, to the workout's notes |
| "Correct my last set to 10 reps", "the last set was 12 reps at 25 kilos" | changes the last set |
| "Delete my last set", "undo that" | asks first, then deletes it |
| "How many sets are left?" | from the plan you're following |
| "Next exercise", "switch to lat pulldown" | changes the current exercise |
| "Next set" | ends the rest and says the target |
| "Finish the workout" | asks first, then finishes it |
| "Stop listening" | turns hands-free off |

"Current exercise" is the one you last named or tapped; with a plan, it starts with the plan's next unfinished exercise. When all the planned sets of the current exercise are done, a set without an exercise name goes to the **next exercise in the plan** (the app says so: "Leg Press is done. Set 1 of Seated Leg Curl, …"). Say "one more set" or the exercise's name to add to the finished one instead.

## How it works

```
microphone ─► speech detection ON THE PHONE ─► (only speech) ─► Whisper on YOUR PC ─► text
                                                                                        │
                    spoken reply ◄── app's own save / timer / notes ◄── command ◄── starts with "Chat"?
```

| Step | Where | File |
|---|---|---|
| Microphone loop: records while switched on; restarts the recording after each utterance, after 30 s of nobody speaking, and after the app spoke | phone | `mobile/src/lib/wakeWordListener.ts` |
| Speech detection: learns the background noise from the microphone level and finds speech above it (250 ms to 12 s); clanks, coughs and steady music are ignored | phone | `mobile/src/lib/speechDetector.ts` |
| Speech to text, with a hint (the wake word and the plan's exercise names) | your PC (Whisper) | `app/services/speech.py`, `/api/assistant/transcribe` |
| Wake word: the text must start with it (a few listed spellings: "Chat", "Chad", "Chet"; never fuzzy, because "that" is one letter away) | phone | `mobile/src/lib/wakeWord.ts` |
| The words as a structured command (deterministic, offline) | phone | `mobile/src/lib/voiceCommands.ts` |
| Checked against the workout and done with the app's own actions; spoken reply | phone + backend (same endpoints as the buttons) | `mobile/src/lib/voiceExecutor.ts`, `mobile/src/components/HandsFree.tsx` |
| Only for words the parser can't read: an AI reading (Claude or Ollama), checked again; a set from it is confirmed before saving | your PC / Claude | `/api/voice/interpret`, `app/services/voice.py` |

### The wake-word approach, and why

A wake-word engine has to run all the time, so it should run on the phone. The options:

| Option | Runs in Expo Go | Wake word checked | Trade-offs |
|---|---|---|---|
| **A. Speech detection on the phone + Whisper on your PC** (built) | yes, and in the browser | on your PC, after the phone found speech | Works today with the existing stack. Silence is never sent. But every *utterance* near the phone (other people talking, loud lyrics) goes to your PC to be checked, and the reply takes the Whisper time (about a second on a graphics card, a few on a processor). |
| B. On-device speech recognition (`expo-speech-recognition`, iOS Speech framework / Android SpeechRecognizer) | no: needs a development build | on the phone | Faster, nothing leaves the phone with on-device recognition. Android's recognizer stops after silence and must be restarted (with a beep on some phones); on-device recognition needs the language downloaded. |
| C. A dedicated wake-word engine (Picovoice Porcupine) | no: needs a development build | on the phone, very low power | Best battery and accuracy for the wake word itself. Needs a Picovoice account key and a custom "Chat" keyword trained in their console (one file per platform); free tier for personal use. The command after it still needs speech-to-text (Whisper or B). |

Nothing here pretends to listen: the microphone level on screen is the real input, and the listening loop only runs while the panel says it's on.

## Safety rules

- Nothing uncertain is saved: missing reps or weight are asked for; an exercise name that only loosely matches is confirmed ("Did you mean Seated Cable Row?"); an unknown name is refused; a set read by the AI fallback is confirmed.
- Deleting a set and finishing the workout are confirmed. Normal sets are not.
- Success is only said after the save succeeded ("Your connection failed. The set wasn't saved." otherwise); the rest timer only starts after a saved set. There is one rest timer, so repeated commands can't start two.
- One command at a time; the same words again within 4 seconds are ignored (a duplicate from speech-to-text).
- Words without the wake word are ignored (and not stored), except an answer to the app's own question within 15 seconds.
- Notes are your words, unchanged (the app only adds the exercise name in front).
- Limits: 1–100 reps, up to 500 kg (1,100 lb), rests of 5 s to 10 min.

## Platform limits

| | Expo Go (now) | Development build | Notes |
|---|---|---|---|
| Foreground microphone | ✅ | ✅ | |
| Continuous listening with the app open | ✅ the screen is kept on while hands-free is on | ✅ | Pocket the phone with the screen on; a locked screen stops it. |
| Listening in the background / screen locked | ❌ pauses, resumes when the app is back | ⚠️ possible, needs configuration (below) | iOS shows the orange microphone dot; Android shows a notification. |
| Wake word checked on the phone | ❌ (on your PC) | ✅ with option B or C | |
| Headphone button to talk | ❌ | ⚠️ needs a media-session native module | iOS only gives remote-control events to apps that are playing audio. |
| Spoken replies through headphones | ✅ | ✅ | On iPhone, while the microphone is on, Bluetooth headsets use the call (HFP) audio route: lower quality, but their microphone is used. On Android the phone's own microphone may be used unless the headset is chosen as the input (expo-audio can select it; not done yet). |
| Rest-over notification in the background | ✅ local notification (with the next set) | ✅ | Push notifications aren't needed. |

### What a development build would need (not done, not tested)

Expo Go only contains the native code Expo ships in it, so anything needing extra native code or background permissions needs a development build (`npx expo prebuild` / `eas build --profile development`), installed on the phone instead of Expo Go.

1. **Background / locked-screen listening** (keeps option A):
   - `app.json`: the `expo-audio` plugin with `"enableBackgroundRecording": true` (adds iOS `UIBackgroundModes: audio`, and an Android foreground service of type `microphone` with `FOREGROUND_SERVICE_MICROPHONE`).
   - In code: `setAudioModeAsync({ allowsBackgroundRecording: true, shouldPlayInBackground: true })` while hands-free is on, and not pausing on `AppState` "background".
   - The listening must start while the app is open (both systems refuse to start the microphone from the background). iOS may still end the session after a phone call or Siri.
   - The speech-detection loop runs on a JavaScript timer, which both systems may slow down in the background; it needs testing on each platform.
2. **On-device wake word (option B)**: add `expo-speech-recognition` (version 57.x matches this SDK) and its config plugin with `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription` (iOS) / `RECORD_AUDIO` (Android). Use continuous mode with `requiresOnDeviceRecognition` where the language is installed, and match the wake word in the results with `wakeWord.ts`. The rest (commands, executor) stays as it is.
3. **Porcupine (option C)**: add `@picovoice/porcupine-react-native` + `@picovoice/react-native-voice-processor`, a Picovoice AccessKey (kept out of git, like `.env`), and a custom keyword file per platform. On detection, record the command with the existing loop.
4. **Headphone button**: a native module that registers a media session (Android `MediaSession`, iOS `MPRemoteCommandCenter`); on iOS this only works while the app plays audio.

## Battery and privacy

- While on, the microphone and a 10-per-second level check run, and the screen stays on: expect noticeably more battery use than a normal workout. Turn it off when you're done.
- Audio is only sent to your own backend, and only when the phone detected speech; recordings aren't stored (Whisper reads them in memory). Text without the wake word is thrown away. With Claude set up, the AI fallback sends the *words* of a command it couldn't read to Anthropic (with Ollama, nothing leaves your PC).

## Tests

Automated (no microphone and no Whisper):

- `mobile/src/lib/voiceCommands.test.ts`, `wakeWord.test.ts`, `speechDetector.test.ts`, `restTimer.test.ts`: parsing, units, durations, notes, the wake word, speech detection (background noise, music, coughs), the new timer actions.
- `mobile/src/lib/voiceExecutor.test.ts`: the executor with fake app actions: sets with and without a name, units, missing values, invalid values, duplicates, a failed save (no timer, no success), timer changes, notes, corrections, "first set" conflicts, wrong or loose exercise names, the plan, confirmations, the AI fallback.
- `tests/test_voice.py`, `tests/test_speech.py`: the AI fallback with fake Claude and Ollama (answers checked), the Whisper hint.
- Browser (Playwright, run by hand): a fake microphone file (quiet, then a loud burst every 5 s) feeds the real listening loop, recording and upload; the backend's speech-to-text is replaced by a script returning one sentence per utterance. It checks the whole chain, including the ignored chatter, the question and answer, the confirmed delete, and what the server saved.

Not tested automatically: real Whisper accuracy on gym audio, a real phone microphone, headphones, and how often speech detection triggers in a real gym. That's the device checklist below.

## Device-testing checklist

Backend running on the PC, the phone on the same Wi-Fi, Expo Go, a workout started.

1. **Permission**: tap Turn on → the microphone prompt appears. Deny → the panel says it needs the microphone and stays off. Allow in settings → Turn on works.
2. **Indicator**: when on, the red dot and the level bar move when you talk, and stay low when quiet. iOS shows the orange dot.
3. **Basic set**: "Chat, 12 reps at 25 kilos" → spoken "Set 1 of …", the set appears in the checklist, the rest timer starts.
4. **Chatter**: talk normally without "Chat" for a minute → nothing happens.
5. **Missing value**: "Chat, 10 reps" → "At what weight?" → "30 kilos" → saved. Wait 20 s instead of answering → the question lapses.
6. **Named exercise**: "Chat, chest press, first set, 15 reps at 20 kilograms" → the right machine, set 1. Say a name that isn't in the library → "I couldn't find …".
7. **Timer**: "Chat, rest 30 seconds", "Chat, add 20 seconds", "Chat, how much rest is left?", "Chat, cancel the timer".
8. **Notes**: "Chat, note: my left shoulder feels uncomfortable" → Note saved, visible in the workout notes.
9. **Corrections**: "Chat, correct my last set to 8 reps"; "Chat, delete my last set" → asks → "Yes" → deleted.
10. **No PC**: stop the backend, say a command → the panel says it can't reach the PC; nothing is announced as saved. Start it again → works.
11. **Headphones**: wired, then Bluetooth: replies come through them; music from another app gets quieter while the app speaks. Check which microphone hears you (on Android it may be the phone's own).
12. **Self-hearing**: with the phone speaker (no headphones), the app's own replies don't trigger commands.
13. **Background**: press Home → the bar says Paused; come back → it listens again. Lock the screen → it pauses (Expo Go).
14. **Loud gym**: with music playing, check commands still work and that the level bar doesn't stay "Hearing you…".
15. **Battery**: note the battery drop over 30 minutes with hands-free on.
16. **Stop**: "Chat, stop listening" and the Turn off button both stop it at once; the orange dot goes away.

## Known limitations

- The wake word is checked after speech-to-text on your PC (option A): replies take Whisper's time, and other people's speech near the phone is sent to your PC to be checked (and thrown away).
- Expo Go: no background or locked-screen listening, no headphone button.
- An answer to the app's question (within 15 s) needs no wake word, so someone nearby saying a number then could answer it. Turn hands-free off in very busy spots, or use headphones with a microphone.
- Timed sets ("plank 45 seconds") and RPE aren't spoken commands yet.
- Commands are English; Whisper can transcribe other languages, but the parser only knows English words (the AI fallback may cope).
