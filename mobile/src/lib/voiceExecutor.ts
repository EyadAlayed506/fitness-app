/**
 * Hands-free: checks a recognised command against the workout in progress and carries it out with the app's
 * own actions (passed in as `deps`, so this file has no React or network code and is tested with fakes in
 * voiceExecutor.test.ts).
 *
 * Rules:
 * - Nothing uncertain is saved: missing reps or weight are asked for ("How many reps?"), an exercise name that
 *   only loosely matches is confirmed, and deleting a set or finishing the workout is confirmed.
 * - Success is only said after the app's save succeeded; the rest timer only starts after a saved set.
 * - One command at a time, and the same words again within a few seconds are ignored (speech-to-text can
 *   deliver an utterance twice).
 */
import { parseCommand, type Command, type Unit } from "./voiceCommands.ts";
import { normaliseSpeech } from "./voiceSet.ts";

export interface VoiceSet {
  id: number;
  exercise_id: number;
  exercise_name: string;
  reps: number;
  weight_kg: number;
}

export interface ExerciseRef {
  id: number;
  name: string;
  /** a bodyweight exercise: a set without a weight is fine */
  bodyweight?: boolean;
}

export interface PlannedExercise extends ExerciseRef {
  sets: number;
  reps: string;
}

export interface VoiceState {
  workoutId: number | null;
  /** this workout's sets, oldest first */
  sets: VoiceSet[];
  /** the exercise being done */
  current: ExerciseRef | null;
  /** the plan the workout follows (empty for a free workout) */
  plan: PlannedExercise[];
  /** the user's unit, used when a weight is said without one */
  unit: Unit;
  rest: { status: "idle" | "running" | "paused" | "done"; remainingSec: number; usualSec: number };
}

export interface SetValues {
  reps: number;
  weight: number;
  unit: Unit;
}

export interface VoiceDeps {
  state(): VoiceState;
  addSet(workoutId: number, exercise: ExerciseRef, values: SetValues): Promise<VoiceSet>;
  updateSet(workoutId: number, set: VoiceSet, values: SetValues): Promise<VoiceSet>;
  deleteSet(workoutId: number, set: VoiceSet): Promise<void>;
  /** the catalogue's best match for a spoken name; `sure` when every spoken word is in its name */
  findExercise(spoken: string): Promise<{ exercise: ExerciseRef; sure: boolean } | null>;
  /** make this the exercise being done (and load its rest time) */
  setCurrent(exercise: ExerciseRef): void;
  timer: {
    startUsual(): void;
    startFor(seconds: number): void;
    extend(seconds: number): void;
    setTotal(seconds: number): void;
    cancel(): void;
    /** the current exercise's usual rest from now on */
    setUsual(seconds: number): Promise<void>;
  };
  saveNote(text: string): Promise<void>;
  finishWorkout(): Promise<void>;
  stopListening(): void;
  /** what to say when the rest is over (null: nothing) */
  announceAfterRest(text: string | null): void;
  /** optional: an AI reading of words the parser didn't understand */
  interpret?(text: string, state: VoiceState): Promise<Command | null>;
}

type LogSet = Extract<Command, { intent: "log_set" }>;

export type Pending =
  /** heard the wake word alone: the next words are the command */
  | { kind: "awake" }
  /** a set is missing something; the next words answer it */
  | { kind: "need"; field: "reps" | "weight" | "exercise"; command: LogSet }
  /** a yes/no question */
  | { kind: "confirm"; question: string; command: Command; exercise?: ExerciseRef; replace?: VoiceSet };

export interface Reply {
  /** what to say out loud (short) */
  say: string;
  /** the command was carried out (and saved, where it saves something) */
  ok: boolean;
}

const DUPLICATE_MS = 4000;
const MAX_REPS = 100;
const MAX_KG = 500;

// ---------- words ----------

export function weightWords(weight: number, unit: Unit): string {
  if (weight <= 0) return "bodyweight";
  const n = Number.isInteger(weight) ? String(weight) : weight.toFixed(1).replace(/\.0$/, "");
  return `${n} ${unit === "lb" ? (weight === 1 ? "pound" : "pounds") : weight === 1 ? "kilo" : "kilos"}`;
}

export function durationWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} seconds`;
  const mins = `${m} minute${m === 1 ? "" : "s"}`;
  return r ? `${mins} ${r}` : mins;
}

const setWords = (reps: number, weight: number, unit: Unit) => `${reps} reps at ${weightWords(weight, unit)}`;
const toKg = (w: number, unit: Unit) => (unit === "lb" ? w * 0.45359237 : w);
const fromKg = (kg: number, unit: Unit) => Math.round((unit === "lb" ? kg / 0.45359237 : kg) * 10) / 10;

// ---------- matching exercise names ----------

const nameWords = (s: string) =>
  normaliseSpeech(s)
    .split(" ")
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length > 1 && !["the", "a", "an", "machine", "on"].includes(w));

/** An exercise of the plan or this workout whose name has every spoken word ("chest press" -> "Machine Chest Press"). */
function matchKnown(spoken: string, known: ExerciseRef[]): ExerciseRef[] {
  const words = nameWords(spoken);
  if (!words.length) return [];
  const seen = new Set<number>();
  return known.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    const have = new Set(nameWords(e.name));
    return words.every((w) => have.has(w));
  });
}

// ---------- the assistant ----------

export class VoiceAssistant {
  pending: Pending | null = null;
  private busy = false;
  private recent: { key: string; at: number } | null = null;

  private deps: VoiceDeps;
  private now: () => number;

  constructor(deps: VoiceDeps, now: () => number = () => Date.now()) {
    this.deps = deps;
    this.now = now;
  }

  /**
   * Handle what was said after the wake word (`woke`), or an answer to a question the app asked (no wake word
   * needed while `pending` is set). Null: ignored (not for us, or a duplicate).
   */
  async handle(text: string, woke: boolean): Promise<Reply | null> {
    const words = text.trim();
    if (!woke && !this.pending) return null;
    const key = normaliseSpeech(words);
    const at = this.now();
    if (key && this.recent && this.recent.key === key && at - this.recent.at < DUPLICATE_MS) return null;
    if (this.busy) return { say: "One moment, still on the last one.", ok: false };
    this.busy = true;
    try {
      const reply = await this.run(words, woke);
      if (key) this.recent = { key, at };
      return reply;
    } finally {
      this.busy = false;
    }
  }

  private async run(text: string, woke: boolean): Promise<Reply> {
    const pending = this.pending;
    const command = parseCommand(text);
    if (!text) {
      this.pending = { kind: "awake" };
      return { say: "Yes?", ok: true };
    }
    if (pending) {
      this.pending = null;
      if (pending.kind === "need") {
        const answered = this.answer(pending, text, command);
        if (answered) return this.logSet(answered);
        if (command.intent === "no") return { say: "Okay, not saved.", ok: true };
        if (!woke && command.intent === "unknown") {
          this.pending = pending; // didn't get the answer: ask again once more
          return { say: this.question(pending.field), ok: false };
        }
      } else if (pending.kind === "confirm") {
        if (command.intent === "yes") return this.confirmed(pending);
        if (command.intent === "no") return { say: "Okay, cancelled.", ok: true };
        if (!woke && command.intent === "unknown") {
          this.pending = pending;
          return { say: `${pending.question} Say yes or no.`, ok: false };
        }
      }
      // otherwise: a new command, handled below (the question is dropped)
    }
    return this.execute(command, text);
  }

  private question(field: "reps" | "weight" | "exercise"): string {
    return field === "reps" ? "How many reps?" : field === "weight" ? "At what weight?" : "Which exercise?";
  }

  /** The missing value from an answer ("12", "25 kilos", "same as last time", "bodyweight", "leg press"). */
  private answer(p: Extract<Pending, { kind: "need" }>, text: string, command: Command): LogSet | null {
    const t = normaliseSpeech(text);
    const c = { ...p.command };
    if (command.intent === "log_set") {
      // a full answer ("12 reps at 25"): take what it has
      c.reps ??= command.reps;
      if (command.weight != null) [c.weight, c.unit] = [command.weight, command.unit ?? c.unit];
      if (command.bodyweight) [c.weight, c.bodyweight] = [0, true];
      c.exercise ??= command.exercise;
    }
    if (p.field === "reps" && c.reps == null) {
      const n = /^(\d+)( reps)?$/.exec(t);
      if (n) c.reps = Number(n[1]);
    }
    if (p.field === "weight" && c.weight == null) {
      if (/\b(bodyweight|body weight|no weight)\b/.test(t)) [c.weight, c.bodyweight] = [0, true];
      else if (/\b(same|same weight|same as (last time|before))\b/.test(t)) {
        const last = this.lastSet(this.deps.state().current?.id ?? null);
        if (last) [c.weight, c.unit] = [fromKg(last.weight_kg, this.deps.state().unit), this.deps.state().unit];
      } else {
        const n = /^(\d+(?:\.\d+)?)\s*(kg|lb)?$/.exec(t);
        if (n) [c.weight, c.unit] = [Number(n[1]), (n[2] as Unit) ?? c.unit];
      }
    }
    if (p.field === "exercise" && !c.exercise && command.intent !== "log_set") c.exercise = text.replace(/[.!?]$/, "").trim();
    const filled = p.field === "reps" ? c.reps != null : p.field === "weight" ? c.weight != null : !!c.exercise;
    return filled ? c : null;
  }

  private lastSet(exerciseId: number | null): VoiceSet | null {
    const sets = this.deps.state().sets;
    const mine = exerciseId == null ? sets : sets.filter((s) => s.exercise_id === exerciseId);
    return mine.at(-1) ?? null;
  }

  private async resolveExercise(spoken: string): Promise<{ exercise: ExerciseRef; sure: boolean } | null> {
    const s = this.deps.state();
    const fromWorkout = s.sets.map((x) => ({ id: x.exercise_id, name: x.exercise_name }));
    const known = matchKnown(spoken, [...(s.current ? [s.current] : []), ...s.plan, ...fromWorkout]);
    if (known.length === 1) return { exercise: s.plan.find((p) => p.id === known[0].id) ?? known[0], sure: true };
    if (known.length > 1) return { exercise: known[0], sure: false };
    return this.deps.findExercise(spoken);
  }

  // ---------- commands ----------

  private async execute(command: Command, text: string): Promise<Reply> {
    const s = this.deps.state();
    const needsWorkout = !["rest_start", "rest_set_total", "rest_extend", "rest_cancel", "rest_query", "stop_listening", "yes", "no", "unknown"].includes(command.intent);
    if (needsWorkout && s.workoutId == null) return { say: "Start a workout first.", ok: false };

    switch (command.intent) {
      case "log_set":
        // a name the parser pulled out that matches no exercise: maybe it wasn't a name at all; let the AI read it
        if (command.exercise && this.deps.interpret && !(await this.resolveExercise(command.exercise))) {
          return this.execute({ intent: "unknown", text }, text);
        }
        return this.logSet(command);
      case "same_again": {
        const last = this.lastSet(s.current?.id ?? null);
        if (!last) return { say: "There's no set to repeat yet.", ok: false };
        return this.logSet({
          intent: "log_set", exercise: null, setNumber: null, count: 1, reps: last.reps,
          weight: fromKg(last.weight_kg, s.unit), unit: s.unit, bodyweight: last.weight_kg === 0,
        }, { id: last.exercise_id, name: last.exercise_name });
      }
      case "next_set": {
        if (s.rest.status === "running" || s.rest.status === "paused") this.deps.timer.cancel();
        this.deps.announceAfterRest(null);
        if (!s.current) return { say: "Go ahead. Which exercise?", ok: true };
        return { say: this.nextSetText(s.current), ok: true };
      }
      case "rest_start":
        if (command.seconds == null) {
          this.deps.timer.startUsual();
          return { say: `Resting ${durationWords(s.rest.usualSec)}.`, ok: true };
        }
        this.deps.timer.startFor(command.seconds);
        return { say: `Resting ${durationWords(command.seconds)}.`, ok: true };
      case "rest_set_total":
        if (s.rest.status === "running" || s.rest.status === "paused") this.deps.timer.setTotal(command.seconds);
        else this.deps.timer.startFor(command.seconds);
        return { say: `Rest set to ${durationWords(command.seconds)}.`, ok: true };
      case "rest_extend": {
        if (s.rest.status !== "running" && s.rest.status !== "paused") return { say: "No rest is running.", ok: false };
        const left = Math.max(0, s.rest.remainingSec + command.seconds); // read before the timer changes
        this.deps.timer.extend(command.seconds);
        return {
          say: command.seconds >= 0
            ? `Added ${durationWords(command.seconds)}. ${durationWords(left)} left.`
            : `Took off ${durationWords(-command.seconds)}. ${durationWords(left)} left.`,
          ok: true,
        };
      }
      case "rest_cancel":
        if (s.rest.status !== "running" && s.rest.status !== "paused") return { say: "No rest is running.", ok: true };
        this.deps.timer.cancel();
        this.deps.announceAfterRest(null);
        return { say: "Timer cancelled.", ok: true };
      case "rest_query":
        if (s.rest.status === "running" || s.rest.status === "paused") {
          return { say: `${durationWords(s.rest.remainingSec)} left${s.rest.status === "paused" ? ", paused" : ""}.`, ok: true };
        }
        return { say: "No rest is running.", ok: true };
      case "rest_default": {
        if (!s.current) return { say: "Which exercise? Say its name first.", ok: false };
        try {
          await this.deps.timer.setUsual(command.seconds);
        } catch {
          return { say: "That wasn't saved. Check the connection.", ok: false };
        }
        return { say: `${s.current.name}: rest ${durationWords(command.seconds)} from now on.`, ok: true };
      }
      case "note": {
        const note = s.current ? `${s.current.name}: ${command.text}` : command.text;
        try {
          await this.deps.saveNote(note);
        } catch {
          return { say: "The note wasn't saved. Check the connection.", ok: false };
        }
        return { say: "Note saved.", ok: true };
      }
      case "correct_last": {
        const last = this.lastSet(s.current?.id ?? null) ?? this.lastSet(null);
        if (!last) return { say: "There's no set to correct.", ok: false };
        if (command.reps == null && command.weight == null) return { say: "What should it be? For example: 10 reps.", ok: false };
        const unit = command.unit ?? s.unit;
        const values: SetValues = {
          reps: command.reps ?? last.reps,
          weight: command.weight ?? fromKg(last.weight_kg, unit),
          unit,
        };
        const bad = this.invalid(values);
        if (bad) return { say: bad, ok: false };
        try {
          await this.deps.updateSet(s.workoutId!, last, values);
        } catch {
          return { say: "The change wasn't saved. Check the connection.", ok: false };
        }
        return { say: `Last set changed to ${setWords(values.reps, values.weight, values.unit)}.`, ok: true };
      }
      case "delete_last": {
        const last = this.lastSet(s.current?.id ?? null) ?? this.lastSet(null);
        if (!last) return { say: "There's no set to delete.", ok: false };
        const question = `Delete ${last.exercise_name}, ${setWords(last.reps, fromKg(last.weight_kg, s.unit), s.unit)}?`;
        this.pending = { kind: "confirm", question, command, replace: last };
        return { say: question, ok: true };
      }
      case "sets_left":
        return { say: this.setsLeftText(), ok: true };
      case "next_exercise": {
        const next = this.nextPlanned();
        if (!next) return { say: s.plan.length ? "That was the last exercise in the plan." : "There's no plan for this workout. Say the next exercise's name.", ok: false };
        this.deps.setCurrent(next);
        return { say: `Next: ${next.name}, ${next.sets} sets of ${next.reps}.`, ok: true };
      }
      case "switch_exercise": {
        const found = await this.resolveExercise(command.exercise);
        if (!found) return { say: `I couldn't find ${command.exercise}. Say the name again.`, ok: false };
        if (!found.sure) {
          const question = `Did you mean ${found.exercise.name}?`;
          this.pending = { kind: "confirm", question, command, exercise: found.exercise };
          return { say: question, ok: true };
        }
        this.deps.setCurrent(found.exercise);
        return { say: `Now ${found.exercise.name}.`, ok: true };
      }
      case "stop_listening":
        this.deps.stopListening();
        return { say: "Hands-free off.", ok: true };
      case "finish_workout": {
        const question = "Finish the workout?";
        this.pending = { kind: "confirm", question, command };
        return { say: question, ok: true };
      }
      case "yes":
      case "no":
        return { say: "There's nothing to confirm.", ok: false };
      case "unknown": {
        const guess = this.deps.interpret ? await this.deps.interpret(text, s).catch(() => null) : null;
        if (guess && guess.intent !== "unknown" && guess.intent !== "yes" && guess.intent !== "no") {
          if (guess.intent === "log_set") {
            // the AI's reading of a set is confirmed before anything is saved
            const question = `${guess.exercise ? `${guess.exercise}, ` : ""}${guess.reps ?? "?"} reps at ${guess.weight != null ? weightWords(guess.weight, guess.unit ?? s.unit) : "?"}. Save it?`;
            this.pending = { kind: "confirm", question, command: guess };
            return { say: question, ok: true };
          }
          if (guess.intent === "delete_last" || guess.intent === "finish_workout") return this.execute(guess, text); // these ask anyway
          return this.execute(guess, text);
        }
        return { say: "Sorry, I didn't get that. Try: 12 reps at 25 kilos.", ok: false };
      }
    }
  }

  private async confirmed(p: Extract<Pending, { kind: "confirm" }>): Promise<Reply> {
    const s = this.deps.state();
    const c = p.command;
    if (c.intent === "delete_last" && p.replace) {
      try {
        await this.deps.deleteSet(s.workoutId!, p.replace);
      } catch {
        return { say: "It wasn't deleted. Check the connection.", ok: false };
      }
      this.deps.announceAfterRest(null);
      return { say: "Deleted.", ok: true };
    }
    if (c.intent === "finish_workout") {
      try {
        await this.deps.finishWorkout();
      } catch {
        return { say: "The workout wasn't finished. Check the connection.", ok: false };
      }
      this.deps.timer.cancel();
      this.deps.stopListening();
      return { say: "Workout finished. Well done.", ok: true };
    }
    if (c.intent === "switch_exercise" && p.exercise) {
      this.deps.setCurrent(p.exercise);
      return { say: `Now ${p.exercise.name}.`, ok: true };
    }
    if (c.intent === "log_set") {
      if (p.replace && p.exercise) return this.saveSet(c, p.exercise, p.replace);
      return this.logSet(c, p.exercise, true);
    }
    return { say: "Okay.", ok: true };
  }

  private invalid(v: SetValues): string | null {
    if (!Number.isInteger(v.reps) || v.reps < 1 || v.reps > MAX_REPS) return `${v.reps} reps doesn't sound right. Say the set again.`;
    if (!(v.weight >= 0) || toKg(v.weight, v.unit) > MAX_KG) return `${weightWords(v.weight, v.unit)} doesn't sound right. Say the set again.`;
    return null;
  }

  /** Check a set, ask for anything missing or uncertain, then save it. */
  private async logSet(c: LogSet, exercise?: ExerciseRef, confirmedExercise = false): Promise<Reply> {
    const s = this.deps.state();
    let ex = exercise ?? null;
    if (!ex && c.exercise) {
      const found = await this.resolveExercise(c.exercise);
      if (!found) return { say: `I couldn't find ${c.exercise}. Say the name again.`, ok: false };
      if (!found.sure && !confirmedExercise) {
        const question = `Did you mean ${found.exercise.name}?`;
        this.pending = { kind: "confirm", question, command: c, exercise: found.exercise };
        return { say: question, ok: true };
      }
      ex = found.exercise;
    }
    ex ??= s.current;
    if (!ex) {
      this.pending = { kind: "need", field: "exercise", command: c };
      return { say: "Which exercise?", ok: true };
    }
    if (c.reps == null) {
      this.pending = { kind: "need", field: "reps", command: { ...c, exercise: ex.name } };
      return { say: "How many reps?", ok: true };
    }
    const bodyweight = c.bodyweight || (c.weight == null && !!ex.bodyweight);
    if (c.weight == null && !bodyweight) {
      this.pending = { kind: "need", field: "weight", command: { ...c, exercise: ex.name } };
      return { say: "At what weight?", ok: true };
    }
    const values: SetValues = { reps: c.reps, weight: bodyweight ? 0 : c.weight!, unit: c.unit ?? s.unit };
    const bad = this.invalid(values);
    if (bad) return { say: bad, ok: false };

    // "first set" when there's already a first set: replace it? (asked, never silently)
    const done = s.sets.filter((x) => x.exercise_id === ex.id);
    if (c.setNumber != null && c.setNumber <= done.length && c.count === 1) {
      const old = done[c.setNumber - 1];
      const question = `Set ${c.setNumber} of ${ex.name} is already ${setWords(old.reps, fromKg(old.weight_kg, values.unit), values.unit)}. Change it to ${setWords(values.reps, values.weight, values.unit)}?`;
      this.pending = { kind: "confirm", question, command: { ...c, ...values, bodyweight }, exercise: ex, replace: old };
      return { say: question, ok: true };
    }
    return this.saveSet({ ...c, ...values, bodyweight }, ex, null);
  }

  private async saveSet(c: LogSet, ex: ExerciseRef, replace: VoiceSet | null): Promise<Reply> {
    const s = this.deps.state();
    const values: SetValues = { reps: c.reps!, weight: c.weight!, unit: c.unit ?? s.unit };
    if (replace) {
      try {
        await this.deps.updateSet(s.workoutId!, replace, values);
      } catch {
        return { say: "The set wasn't changed. Check the connection.", ok: false };
      }
      return { say: `Set ${c.setNumber} changed to ${setWords(values.reps, values.weight, values.unit)}.`, ok: true };
    }
    // what the workout had before this set (the app's state changes as soon as a set is saved)
    const before = [...s.sets];
    const usual = s.rest.usualSec;
    if (s.current?.id !== ex.id) this.deps.setCurrent(ex);
    let saved = 0;
    for (let k = 0; k < c.count; k++) {
      try {
        await this.deps.addSet(s.workoutId!, ex, values);
        saved++;
      } catch {
        break;
      }
    }
    if (!saved) return { say: "Your connection failed. The set wasn't saved.", ok: false };
    const number = before.filter((x) => x.exercise_id === ex.id).length + saved;
    this.deps.timer.startUsual(); // only after a saved set
    const after = { ...s, sets: [...before, ...Array.from({ length: saved }, (_, i) => ({ id: -1 - i, exercise_id: ex.id, exercise_name: ex.name, reps: values.reps, weight_kg: toKg(values.weight, values.unit) }))] };
    this.deps.announceAfterRest(this.afterRestText(ex, after, values));
    const what = saved > 1 ? `${saved} sets of ${ex.name}, ${setWords(values.reps, values.weight, values.unit)}` : `Set ${number} of ${ex.name}, ${setWords(values.reps, values.weight, values.unit)}`;
    const failed = saved < c.count ? ` The other ${c.count - saved} weren't saved.` : "";
    return { say: `${what}. Resting ${durationWords(usual)}.${failed}`, ok: failed === "" };
  }

  // ---------- plan helpers ----------

  private done(exerciseId: number, sets = this.deps.state().sets) {
    return sets.filter((x) => x.exercise_id === exerciseId).length;
  }

  private nextPlanned(after: ExerciseRef | null = this.deps.state().current, sets?: VoiceSet[]): PlannedExercise | null {
    const plan = this.deps.state().plan;
    const i = after ? plan.findIndex((p) => p.id === after.id) : -1;
    const order = i >= 0 ? [...plan.slice(i + 1), ...plan.slice(0, i)] : plan;
    return order.find((p) => this.done(p.id, sets) < p.sets) ?? null;
  }

  private afterRestText(ex: ExerciseRef, s: VoiceState, last: SetValues): string {
    const planned = s.plan.find((p) => p.id === ex.id);
    const done = this.done(ex.id, s.sets);
    if (planned && done >= planned.sets) {
      const next = this.nextPlanned(ex, s.sets);
      return next ? `Next: ${next.name}.` : `That's all ${planned.sets} sets of ${ex.name}.`;
    }
    return `Next: set ${done + 1}${planned ? ` of ${planned.sets}` : ""}, ${setWords(last.reps, last.weight, last.unit)}.`;
  }

  private nextSetText(ex: ExerciseRef): string {
    const s = this.deps.state();
    const planned = s.plan.find((p) => p.id === ex.id);
    const done = this.done(ex.id);
    const last = this.lastSet(ex.id);
    const target = last ? `, last was ${setWords(last.reps, fromKg(last.weight_kg, s.unit), s.unit)}` : planned ? `, ${planned.reps} reps` : "";
    return `Set ${done + 1}${planned ? ` of ${planned.sets}` : ""} of ${ex.name}${target}.`;
  }

  private setsLeftText(): string {
    const s = this.deps.state();
    if (!s.plan.length) return `There's no plan for this workout. You've done ${s.sets.length} sets.`;
    const remaining = s.plan.filter((p) => this.done(p.id) < p.sets);
    if (!remaining.length) return "All planned sets are done.";
    const cur = s.current ? s.plan.find((p) => p.id === s.current!.id) : null;
    const total = remaining.reduce((a, p) => a + p.sets - this.done(p.id), 0);
    if (cur && this.done(cur.id) < cur.sets) {
      const here = cur.sets - this.done(cur.id);
      const others = remaining.filter((p) => p.id !== cur.id).length;
      return `${here} ${here === 1 ? "set" : "sets"} left of ${cur.name}${others ? `, then ${others} more ${others === 1 ? "exercise" : "exercises"}` : ""}.`;
    }
    return `${total} sets left in ${remaining.length} ${remaining.length === 1 ? "exercise" : "exercises"}.`;
  }
}
