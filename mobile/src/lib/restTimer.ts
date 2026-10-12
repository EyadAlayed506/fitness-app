/**
 * Rest timer between sets, as a pure state machine (no React), so it's easy to test.
 *
 * There is only ever one countdown: starting again replaces the running one.
 * Time is kept as an end timestamp, so the display stays right even if the app was in the background.
 */

export const MIN_REST = 15;
export const MAX_REST = 600;

export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface RestTimerState {
  status: TimerStatus;
  /** Rest length for the exercise being logged (the next countdown uses it). */
  durationSec: number;
  exerciseId: number | null;
  exerciseName: string;
  /** Which exercise the current countdown is resting after. */
  countdownFor: string;
  /** Length of the countdown that's running or paused (s); it can differ from durationSec after moving on. */
  countdownSec: number;
  /** When running: the moment the rest ends (ms since epoch). */
  endsAt: number | null;
  /** When paused / idle / done: what's left (ms). */
  remainingMs: number;
}

export type RestTimerAction =
  | { type: "configure"; exerciseId: number; exerciseName: string; durationSec: number }
  | { type: "start"; now: number }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number }
  | { type: "restart"; now: number }
  | { type: "skip" }
  | { type: "adjust"; deltaSec: number; now: number }
  | { type: "tick"; now: number };

export const clampRest = (sec: number) => Math.min(MAX_REST, Math.max(MIN_REST, Math.round(sec)));

export function initialRestTimer(durationSec = 90): RestTimerState {
  const d = clampRest(durationSec);
  return {
    status: "idle",
    durationSec: d,
    exerciseId: null,
    exerciseName: "",
    countdownFor: "",
    countdownSec: d,
    endsAt: null,
    remainingMs: d * 1000,
  };
}

/** Milliseconds left at `now`. */
export function remainingMs(state: RestTimerState, now: number): number {
  if (state.status === "running" && state.endsAt != null) return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

/** "1:05" */
export function formatRest(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function restTimerReducer(state: RestTimerState, action: RestTimerAction): RestTimerState {
  switch (action.type) {
    case "configure": {
      // Moving to another exercise: its rest time is used for the next countdown.
      // A countdown that's already running (rest after the previous set) keeps going.
      const durationSec = clampRest(action.durationSec);
      const next = { ...state, exerciseId: action.exerciseId, exerciseName: action.exerciseName, durationSec };
      return state.status === "running" || state.status === "paused"
        ? next
        : { ...next, status: "idle", endsAt: null, countdownSec: durationSec, remainingMs: durationSec * 1000 };
    }
    case "start":
    case "restart":
      return {
        ...state,
        status: "running",
        countdownFor: state.exerciseName,
        countdownSec: state.durationSec,
        endsAt: action.now + state.durationSec * 1000,
        remainingMs: state.durationSec * 1000,
      };
    case "pause":
      if (state.status !== "running") return state;
      return { ...state, status: "paused", remainingMs: remainingMs(state, action.now), endsAt: null };
    case "resume":
      if (state.status !== "paused") return state;
      return { ...state, status: "running", endsAt: action.now + state.remainingMs };
    case "skip":
      return { ...state, status: "idle", endsAt: null, countdownFor: "", countdownSec: state.durationSec, remainingMs: state.durationSec * 1000 };
    case "adjust": {
      const durationSec = clampRest(state.durationSec + action.deltaSec);
      const applied = (durationSec - state.durationSec) * 1000;
      const countdownSec = Math.max(0, state.countdownSec + applied / 1000);
      if (state.status === "running" && state.endsAt != null) {
        return { ...state, durationSec, countdownSec, endsAt: Math.max(action.now, state.endsAt + applied) };
      }
      if (state.status === "paused") return { ...state, durationSec, countdownSec, remainingMs: Math.max(0, state.remainingMs + applied) };
      return { ...state, durationSec, countdownSec: durationSec, remainingMs: durationSec * 1000 };
    }
    case "tick":
      if (state.status === "running" && state.endsAt != null && action.now >= state.endsAt) {
        return { ...state, status: "done", endsAt: null, remainingMs: 0 };
      }
      return state;
  }
}
