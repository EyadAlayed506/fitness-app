/**
 * Hands-free workout mode: say "Chat, 12 reps at 25 kilos" with the phone in your pocket.
 *
 * Pieces (each tested on its own):
 * - wakeWordListener: microphone -> speech found on the phone -> Whisper on the PC -> text
 * - wakeWord: does the text start with the wake word?
 * - voiceCommands + voiceExecutor: what the words mean, checked against the workout, and done with the app's
 *   own actions (the same ones the buttons use), then a short spoken reply.
 *
 * It only listens while switched on, with a workout in progress and the app open.
 */
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { addSet, deleteSet, finishWorkout, saveWorkoutNotes, updateSet, useRoutine, useWorkouts, type WorkoutsData } from "@/lib/data";
import { units } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { invalidate, qk, queryClient } from "@/lib/query";
import { remainingMs } from "@/lib/restTimer";
import { speak } from "@/lib/speech";
import { storage } from "@/lib/storage";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Exercise, WorkoutSet } from "@/lib/types";
import type { Command } from "@/lib/voiceCommands";
import { VoiceAssistant, type ExerciseRef, type PlannedExercise, type VoiceDeps, type VoiceSet, type VoiceState } from "@/lib/voiceExecutor";
import { normaliseSpeech } from "@/lib/voiceSet";
import { DEFAULT_WAKE_WORD, matchWakeWord } from "@/lib/wakeWord";
import { useWakeWordListener, type ListenerStatus } from "@/lib/wakeWordListener";

import { Button, Field, LinkButton, Meter, Row, Txt } from "./ui";
import { useWorkoutSession } from "./WorkoutSession";

const WAKE_KEY = "handsfree_wake_word";
const ANSWER_WINDOW_MS = 15_000; // after a question, the answer needs no wake word for this long

export interface Exchange {
  heard: string;
  said: string;
  ok: boolean;
}

interface HandsFreeValue {
  /** switched on for the workout in progress */
  on: boolean;
  setOn: (on: boolean) => void;
  status: ListenerStatus;
  /** microphone level (dBFS), for the on-screen meter */
  level: number;
  wakeWord: string;
  setWakeWord: (w: string) => void;
  /** the exercise short commands ("12 reps at 25") are for */
  current: ExerciseRef | null;
  setCurrent: (e: { id: number; name: string }) => void;
  /** what was heard and answered, newest first */
  log: Exchange[];
  error: string | null;
}

const HandsFreeContext = createContext<HandsFreeValue | null>(null);

/** Hands-free state, or null outside the tabs. */
export const useHandsFree = () => useContext(HandsFreeContext);

const toVoiceSet = (s: WorkoutSet): VoiceSet => ({ id: s.id, exercise_id: s.exercise_id, exercise_name: s.exercise_name, reps: s.reps, weight_kg: s.weight_kg });

/** Every spoken word of `spoken` is in the exercise's name or aliases ("chest press" -> "Machine Chest Press"). */
function sureMatch(spoken: string, e: Exercise): boolean {
  const words = (s: string) => normaliseSpeech(s).split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w.length > 1);
  const have = new Set([...words(e.name), ...words(e.aliases ?? "")]);
  return words(spoken).every((w) => have.has(w) || ["the", "machine"].includes(w));
}

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const { data } = useWorkouts();
  const active = data?.active ?? null;
  const routine = useRoutine().data ?? null;
  const session = useWorkoutSession();
  const { profile } = useProfile();
  const unit = units(profile.unit_system).imperial ? "lb" : "kg";

  const [onFor, setOnFor] = useState<number | null>(null); // the workout hands-free was switched on for
  const on = onFor != null && onFor === active?.id;
  const [wakeWord, setWakeWordState] = useState(DEFAULT_WAKE_WORD);
  const [chosen, setChosen] = useState<{ workoutId: number; exercise: ExerciseRef } | null>(null);
  const [log, setLog] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    storage.get(WAKE_KEY).then((w) => w && setWakeWordState(w)).catch(() => {});
  }, []);
  const setWakeWord = useCallback((w: string) => {
    const word = w.trim() || DEFAULT_WAKE_WORD;
    setWakeWordState(word);
    storage.set(WAKE_KEY, word).catch(() => {});
  }, []);

  // the plan being followed (with "machine taken" swaps), like the Workouts screen shows it
  const plan: PlannedExercise[] = useMemo(() => {
    const p = session.plan;
    const day = p?.day ?? (p?.weekday != null ? routine?.days.find((d) => d.weekday_index === p.weekday) : null);
    return (day?.exercises ?? []).map((x) => {
      const to = p?.swaps?.[x.exercise_id];
      return { id: to?.id ?? x.exercise_id, name: to?.name ?? x.name, sets: x.sets, reps: x.reps };
    });
  }, [session.plan, routine]);

  // the exercise being done: the one chosen (by voice or by tapping it), else the plan's next one
  const done = (id: number) => active?.sets.filter((s) => s.exercise_id === id).length ?? 0;
  const current: ExerciseRef | null =
    chosen && chosen.workoutId === active?.id ? chosen.exercise : (plan.find((x) => done(x.id) < x.sets) ?? null);

  // what the assistant reads (always the latest values)
  const live = useRef({ active, plan, current, unit: unit as "kg" | "lb", session, onFor });
  useEffect(() => {
    live.current = { active, plan, current, unit, session, onFor };
  });

  const bodyweight = useRef(new Map<number, boolean>());
  const setCurrent = useCallback((e: { id: number; name: string }) => {
    const workoutId = live.current.active?.id;
    if (workoutId == null) return;
    const exercise: ExerciseRef = { id: e.id, name: e.name, bodyweight: bodyweight.current.get(e.id) };
    setChosen({ workoutId, exercise });
    live.current.session.timer.loadExercise(e.id, e.name).catch(() => {});
    if (!bodyweight.current.has(e.id)) {
      api<Exercise>(`/exercises/${e.id}`)
        .then((x) => {
          bodyweight.current.set(e.id, x.category === "bodyweight");
          setChosen((c) => (c && c.exercise.id === e.id ? { ...c, exercise: { ...c.exercise, bodyweight: x.category === "bodyweight" } } : c));
        })
        .catch(() => {});
    }
  }, []);

  // the assistant reads the app through `live` (always the latest values); made once, after the first render
  const assistantRef = useRef<VoiceAssistant | null>(null);
  useEffect(() => {
    if (assistantRef.current) return;
    const fullSet = (id: number) => queryClient.getQueryData<WorkoutsData>(qk.workouts)?.active?.sets.find((s) => s.id === id) ?? null;
    const deps: VoiceDeps = {
      state(): VoiceState {
        const L = live.current;
        const cached = queryClient.getQueryData<WorkoutsData>(qk.workouts)?.active ?? L.active;
        const t = L.session.timer.state;
        return {
          workoutId: cached?.id ?? null,
          sets: (cached?.sets ?? []).filter((s) => s.id > 0).map(toVoiceSet),
          current: L.current,
          plan: L.plan,
          unit: L.unit,
          rest: { status: t.status, remainingSec: Math.round(remainingMs(t, Date.now()) / 1000), usualSec: t.durationSec },
        };
      },
      async addSet(workoutId, ex, v) {
        const saved = await addSet(workoutId, {
          exercise_id: ex.id, exercise_name: ex.name, reps: v.reps, weight: v.weight, unit: v.unit, rpe: null, notes: "", added_via: "voice",
        });
        return toVoiceSet(saved);
      },
      async updateSet(workoutId, set, v) {
        const full = fullSet(set.id);
        if (!full) throw new Error("That set isn't there any more.");
        return toVoiceSet(await updateSet(workoutId, full, { reps: v.reps, weight: v.weight, unit: v.unit, rpe: full.rpe, notes: full.notes }));
      },
      async deleteSet(workoutId, set) {
        const full = fullSet(set.id);
        if (!full) throw new Error("That set isn't there any more.");
        await deleteSet(workoutId, full);
      },
      async findExercise(spoken) {
        const found = await api<Exercise[]>(`/exercises?limit=3&search=${encodeURIComponent(spoken)}`).catch(() => []);
        const top = found[0];
        if (!top) return null;
        bodyweight.current.set(top.id, top.category === "bodyweight");
        return { exercise: { id: top.id, name: top.name, bodyweight: top.category === "bodyweight" }, sure: sureMatch(spoken, top) };
      },
      setCurrent: (e) => setCurrent(e),
      timer: {
        startUsual: () => live.current.session.timer.dispatch({ type: "start", now: Date.now() }),
        startFor: (seconds) => live.current.session.timer.dispatch({ type: "startFor", seconds, now: Date.now() }),
        extend: (seconds) => live.current.session.timer.dispatch({ type: "extend", seconds, now: Date.now() }),
        setTotal: (seconds) => live.current.session.timer.dispatch({ type: "setTotal", seconds, now: Date.now() }),
        cancel: () => live.current.session.timer.dispatch({ type: "skip" }),
        async setUsual(seconds) {
          const ex = live.current.current;
          if (!ex) throw new Error("No exercise");
          await api(`/exercises/${ex.id}/rest`, { method: "PUT", body: { seconds } });
          live.current.session.timer.dispatch({ type: "configure", exerciseId: ex.id, exerciseName: ex.name, durationSec: seconds });
        },
      },
      async saveNote(text) {
        const a = queryClient.getQueryData<WorkoutsData>(qk.workouts)?.active;
        if (!a) throw new Error("No workout");
        await saveWorkoutNotes(a.id, a.notes ? `${a.notes}\n${text}` : text);
      },
      async finishWorkout() {
        const a = queryClient.getQueryData<WorkoutsData>(qk.workouts)?.active;
        if (!a) throw new Error("No workout");
        await finishWorkout(a.id, a.notes ?? "");
        live.current.session.clearPlanDay(a.id);
        invalidate(qk.points);
      },
      stopListening: () => setOnFor(null),
      announceAfterRest: (text) => live.current.session.announceAfterRest(text),
      async interpret(text, s): Promise<Command | null> {
        const r = await api<{ command: Command | null }>("/voice/interpret", {
          method: "POST",
          body: { text, current_exercise: s.current?.name ?? null, plan: s.plan.map((p) => p.name), unit: s.unit },
        }).catch(() => null);
        return r?.command ?? null;
      },
    };
    assistantRef.current = new VoiceAssistant(deps);
  }, [setCurrent]);

  const lastReplyAt = useRef(0);
  const onText = useCallback(
    async (text: string) => {
      const assistant = assistantRef.current;
      if (!assistant) return;
      if (assistant.pending && Date.now() - lastReplyAt.current > ANSWER_WINDOW_MS) assistant.pending = null; // too late to be the answer
      const wake = matchWakeWord(text, wakeWord);
      if (!wake.matched && !assistant.pending) return; // not for us: ignored, not stored
      const reply = await assistant.handle(wake.matched ? wake.command : text, wake.matched);
      if (!reply) return;
      lastReplyAt.current = Date.now();
      setLog((l) => [{ heard: text, said: reply.say, ok: reply.ok }, ...l].slice(0, 5));
      if (reply.ok) haptics.selection();
      await speak(reply.say);
      lastReplyAt.current = Date.now();
    },
    [wakeWord],
  );

  const onError = useCallback((message: string, fatal: boolean) => {
    setError(message);
    if (fatal) setOnFor(null);
  }, []);

  const prompt = useCallback(() => {
    const L = live.current;
    const names = [...new Set([L.current?.name, ...L.plan.map((p) => p.name)].filter(Boolean))].slice(0, 12);
    return `${wakeWord}, ${names.join(", ")}. 12 reps at 25 kilos. Rest 30 seconds. Note.`;
  }, [wakeWord]);

  const { status, level } = useWakeWordListener({ enabled: on, prompt, onText, onError });

  // the screen stays on while listening (Expo Go can't use the microphone with the screen locked)
  useEffect(() => {
    if (!on) return;
    activateKeepAwakeAsync("handsfree").catch(() => {});
    return () => {
      deactivateKeepAwake("handsfree").catch(() => {});
    };
  }, [on]);

  const setOn = useCallback(
    (next: boolean) => {
      setError(null);
      if (assistantRef.current) assistantRef.current.pending = null;
      setOnFor(next ? (live.current.active?.id ?? null) : null);
      if (next && live.current.current) setCurrent(live.current.current);
    },
    [setCurrent],
  );

  const value = useMemo(
    () => ({ on, setOn, status: on ? status : "off", level, wakeWord, setWakeWord, current, setCurrent, log, error }),
    [on, setOn, status, level, wakeWord, setWakeWord, current, setCurrent, log, error],
  );
  return <HandsFreeContext.Provider value={value}>{children}</HandsFreeContext.Provider>;
}

// ---------- on the Workouts screen ----------

const STATUS_TEXT: Record<ListenerStatus, string> = {
  off: "Off",
  starting: "Starting the microphone…",
  listening: "Listening for",
  hearing: "Hearing you…",
  thinking: "Working on it…",
  paused: "Paused: the app is in the background",
  error: "The microphone isn't available",
};

const EXAMPLES = [
  "12 reps at 25 kilos",
  "Leg press, first set, 15 reps at 100 kilos",
  "Same again",
  "Rest 30 seconds · Add 20 seconds · Cancel the timer",
  "Make the rest two minutes · How much rest is left?",
  "Note: my left shoulder feels uncomfortable",
  "Correct my last set to 10 reps · Delete my last set",
  "How many sets are left? · Next exercise · Switch to lat pulldown",
  "Stop listening",
];

export function HandsFreePanel() {
  const t = useTheme();
  const hf = useHandsFree();
  const [showHelp, setShowHelp] = useState(false);
  const [wordDraft, setWordDraft] = useState<string | null>(null);
  if (!hf) return null;
  const { on, status } = hf;
  const live = on && (status === "listening" || status === "hearing" || status === "thinking");
  const levelPct = Math.max(0, Math.min(100, ((hf.level + 70) / 70) * 100));
  const last = hf.log[0];
  return (
    <View style={[styles.panel, { backgroundColor: on ? t.accentSoft : t.surface2 }]} accessibilityLiveRegion="polite" aria-live="polite">
      <Row style={{ justifyContent: "space-between", alignItems: "center" }} gap={space.sm}>
        <Row gap={space.sm} style={{ flex: 1 }}>
          <View style={[styles.dot, { backgroundColor: live ? t.critical : t.muted }]} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "700" }}>Hands-free {on ? "on" : "off"}</Txt>
            <Txt variant="tiny" numberOfLines={2}>
              {on
                ? status === "listening"
                  ? `${STATUS_TEXT.listening} “${hf.wakeWord}”`
                  : STATUS_TEXT[status]
                : `Say “${hf.wakeWord}, 12 reps at 25 kilos” instead of tapping.`}
            </Txt>
          </View>
        </Row>
        <Button
          title={on ? "Turn off" : "Turn on"}
          icon={on ? "mic-off-outline" : "mic-outline"}
          kind={on ? "ghost" : "primary"}
          small
          onPress={() => hf.setOn(!on)}
          accessibilityLabel={on ? "Turn hands-free off" : "Turn hands-free on"}
        />
      </Row>

      {on ? (
        <>
          <View style={{ marginTop: space.sm }} accessibilityLabel="Microphone level">
            <Meter value={live ? levelPct : 0} max={100} color={status === "hearing" ? t.critical : t.accent} height={4} />
          </View>
          <Txt variant="small" style={{ marginTop: space.sm, color: t.text }}>
            {hf.current ? `Now: ${hf.current.name}` : "No exercise yet: say its name, e.g. “leg press, 12 reps at 100”."}
          </Txt>
          {last ? (
            <View style={{ marginTop: space.xs }}>
              <Txt variant="tiny" numberOfLines={2}>
                Heard: “{last.heard}”
              </Txt>
              <Txt variant="tiny" style={{ color: last.ok ? t.goodInk : t.warnInk }} numberOfLines={3}>
                {last.said}
              </Txt>
            </View>
          ) : null}
        </>
      ) : null}
      {hf.error ? (
        <Txt variant="tiny" style={{ marginTop: space.xs, color: t.critical }}>
          {hf.error}
        </Txt>
      ) : null}

      <Row gap={space.lg} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
        <LinkButton title={showHelp ? "Hide what to say" : "What can I say?"} onPress={() => setShowHelp(!showHelp)} />
        {wordDraft == null ? <LinkButton title={`Wake word: ${hf.wakeWord}`} onPress={() => setWordDraft(hf.wakeWord)} /> : null}
      </Row>
      {wordDraft != null ? (
        <Row style={{ alignItems: "flex-end" }} gap={space.sm}>
          <Field label="Wake word" value={wordDraft} onChangeText={setWordDraft} maxLength={20} autoCorrect={false} style={{ flex: 1 }} />
          <Button
            title="Save"
            small
            kind="soft"
            onPress={() => {
              hf.setWakeWord(wordDraft);
              setWordDraft(null);
            }}
          />
        </Row>
      ) : null}
      {showHelp ? (
        <View style={{ marginTop: space.sm, gap: 4 }}>
          <Txt variant="tiny">Start each with “{hf.wakeWord}”. When the app asks a question, just answer.</Txt>
          {EXAMPLES.map((e) => (
            <Row key={e} gap={6} style={{ alignItems: "flex-start" }}>
              <Ionicons name="chatbubble-outline" size={12} color={t.muted} style={{ marginTop: 3 }} />
              <Txt variant="tiny" style={{ flex: 1, color: t.text2 }}>
                {e}
              </Txt>
            </Row>
          ))}
          <Txt variant="tiny" style={{ marginTop: space.xs }}>
            Works with the app open (the screen stays on while hands-free is on). The phone listens for speech itself;
            only what you say is sent to your PC to be understood, never silence. Headphones with a microphone work best
            in a loud gym.
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/** A small "listening" mark for the bar above the tabs. */
export function HandsFreeBadge() {
  const t = useTheme();
  const hf = useHandsFree();
  if (!hf?.on) return null;
  return (
    <Pressable onPress={() => hf.setOn(false)} accessibilityRole="button" accessibilityLabel="Hands-free is listening. Turn it off" hitSlop={8}>
      <View style={[styles.badge, { backgroundColor: t.criticalSoft }]}>
        <Ionicons name="mic" size={12} color={t.critical} />
        <Txt variant="tiny" style={{ ...typeScale.caption, color: t.critical, fontWeight: "700" }}>
          {hf.status === "paused" ? "Paused" : "Listening"}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.md, padding: space.md, marginTop: space.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
});
