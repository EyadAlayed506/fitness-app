import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

import { api } from "./api";
import { tzOffset } from "./format";
import { derivedKeys, invalidate, qk, queryClient } from "./query";
import type {
  AssistantStatus,
  ExerciseHistory,
  FoodDay,
  FoodLogEntry,
  GettingStarted,
  Meal,
  Points,
  Recommendations,
  RecentFoods,
  Routine,
  SleepAnalytics,
  SleepEntry,
  WhoopStatus,
  WhoopSyncResult,
  Workout,
  WorkoutSet,
} from "./types";

/**
 * Server data for the screens (cached; see query.ts) and the logging actions that change it.
 * Actions update the cache straight away, undo that if the server says no, and then refetch what they affect.
 */

// ---------- reading ----------

export interface WorkoutsData {
  /** finished workouts, newest first */
  history: Workout[];
  /** the workout in progress, with its sets */
  active: Workout | null;
}

async function fetchWorkouts(): Promise<WorkoutsData> {
  const list = await api<Workout[]>("/workouts?limit=15");
  const current = list.find((w) => !w.ended_at);
  const active = current ? await api<Workout>(`/workouts/${current.id}`) : null;
  return { history: list.filter((w) => w.ended_at), active };
}

export const useWorkouts = () => useQuery({ queryKey: qk.workouts, queryFn: fetchWorkouts });
export const useRoutine = () => useQuery({ queryKey: qk.routine, queryFn: () => api<Routine>("/me/routine") });
export const useFoodDay = (date: string) =>
  useQuery({ queryKey: qk.foodDay(date), queryFn: () => api<FoodDay>(`/food-logs?date=${date}`) });
export const useRecentFoods = () => useQuery({ queryKey: qk.foodRecent, queryFn: () => api<RecentFoods>("/food-logs/recent") });
export const useRecommendations = () =>
  useQuery({ queryKey: qk.recommendations, queryFn: () => api<Recommendations>(`/me/recommendations?tz_offset=${tzOffset()}`) });
export const usePoints = () => useQuery({ queryKey: qk.points, queryFn: () => api<Points>(`/points?tz_offset=${tzOffset()}`) });
export const useWhoopStatus = () => useQuery({ queryKey: qk.whoop, queryFn: () => api<WhoopStatus>("/whoop") });
export const useSleepList = (limit: number) =>
  useQuery({ queryKey: qk.sleepList(limit), queryFn: () => api<SleepEntry[]>(`/sleep?limit=${limit}`) });
export const useSleepAnalytics = (days: number) =>
  useQuery({
    queryKey: qk.sleepAnalytics(days),
    queryFn: () => api<SleepAnalytics>(`/analytics/sleep?days=${days}&tz_offset=${tzOffset()}`),
  });
export const useGettingStarted = () =>
  useQuery({ queryKey: qk.gettingStarted, queryFn: () => api<GettingStarted>(`/me/getting-started?tz_offset=${tzOffset()}`) });
export const useAssistant = () => useQuery({ queryKey: qk.assistant, queryFn: () => api<AssistantStatus>("/assistant") });
export const useExerciseHistory = (exerciseId: number | null, excludeWorkoutId: number | null) =>
  useQuery({
    queryKey: qk.exerciseHistory(exerciseId ?? 0, excludeWorkoutId),
    queryFn: () =>
      api<ExerciseHistory>(
        `/exercises/${exerciseId}/history${excludeWorkoutId != null ? `?exclude_workout_id=${excludeWorkoutId}` : ""}`,
      ),
    enabled: exerciseId != null,
  });

/**
 * With WHOOP connected: each time the screen comes into view, bring in new sleep (the server skips it
 * if it synced less than `staleMinutes` ago). New nights refresh sleep, points and suggestions.
 */
export function useWhoopAutoSync(connected: boolean, staleMinutes: number, onSynced?: (r: WhoopSyncResult) => void) {
  const callback = useRef(onSynced);
  useEffect(() => {
    callback.current = onSynced;
  });
  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      api<WhoopSyncResult>(`/whoop/sync?stale_minutes=${staleMinutes}`, { method: "POST" })
        .then((r) => {
          if (!r.skipped && (r.imported || r.replaced_manual)) invalidate(qk.sleep, qk.whoop, ...derivedKeys);
          callback.current?.(r);
        })
        .catch(() => {}); // older data stays on screen
    }, [connected, staleMinutes]),
  );
}

// ---------- helpers ----------

/** Change cached data now; put it back if `run` fails. */
async function optimistic<T, R>(key: QueryKey, update: (old: T) => T, run: () => Promise<R>): Promise<R> {
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<T>(key);
  if (previous !== undefined) queryClient.setQueryData<T>(key, update(previous));
  try {
    return await run();
  } catch (e) {
    if (previous !== undefined) queryClient.setQueryData<T>(key, previous);
    throw e;
  }
}

const withSets = (w: Workout, sets: WorkoutSet[]): Workout => ({
  ...w,
  sets,
  set_count: sets.length,
  volume_kg: Math.round(sets.reduce((a, s) => a + s.reps * s.weight_kg, 0) * 10) / 10,
});

/** Change the workout in progress in the cache, if it's the one with this id (sets of past workouts live elsewhere). */
function updateActive(workoutId: number, change: (active: Workout) => Workout) {
  return (old: WorkoutsData): WorkoutsData => (old.active?.id === workoutId ? { ...old, active: change(old.active) } : old);
}

// ---------- workouts ----------

export interface SetInput {
  exercise_id: number;
  exercise_name: string;
  reps: number;
  weight: number;
  unit: string;
  rpe: number | null;
  notes: string;
  added_via: "name" | "qr" | "photo";
}

const KG_PER_LB = 0.45359237;
const toKg = (weight: number, unit: string) => (unit === "lb" ? weight * KG_PER_LB : weight);

export async function startWorkout(): Promise<Workout> {
  const created = await api<Workout>("/workouts", { method: "POST", body: {} });
  queryClient.setQueryData<WorkoutsData>(qk.workouts, (old) => ({ history: old?.history ?? [], active: created }));
  return created;
}

let tempId = -1;

/** Log a set. It shows in the workout immediately; the saved set replaces it when the server answers. */
export async function addSet(workoutId: number, input: SetInput): Promise<WorkoutSet> {
  const temp: WorkoutSet = {
    id: tempId--,
    exercise_id: input.exercise_id,
    exercise_name: input.exercise_name,
    set_number: 0,
    reps: input.reps,
    weight_kg: Math.round(toKg(input.weight, input.unit) * 100) / 100,
    rpe: input.rpe,
    rest_seconds: null,
    notes: input.notes,
    added_via: input.added_via,
  };
  const saved = await optimistic<WorkoutsData, WorkoutSet>(
    qk.workouts,
    updateActive(workoutId, (a) => withSets(a, [...a.sets, temp])),
    () =>
      api<WorkoutSet>(`/workouts/${workoutId}/sets`, {
        method: "POST",
        body: {
          exercise_id: input.exercise_id,
          reps: input.reps,
          weight: input.weight,
          unit: input.unit,
          rpe: input.rpe,
          notes: input.notes,
          added_via: input.added_via,
        },
      }),
  );
  queryClient.setQueryData<WorkoutsData>(
    qk.workouts,
    (old) => old && updateActive(workoutId, (a) => withSets(a, a.sets.map((s) => (s.id === temp.id ? saved : s))))(old),
  );
  invalidate(qk.workout(workoutId));
  return saved;
}

export async function updateSet(
  workoutId: number,
  set: WorkoutSet,
  changes: { reps: number; weight: number; unit: string; rpe: number | null; notes: string },
): Promise<WorkoutSet> {
  const local = { ...set, reps: changes.reps, weight_kg: Math.round(toKg(changes.weight, changes.unit) * 100) / 100, rpe: changes.rpe, notes: changes.notes };
  const saved = await optimistic<WorkoutsData, WorkoutSet>(
    qk.workouts,
    updateActive(workoutId, (a) => withSets(a, a.sets.map((s) => (s.id === set.id ? local : s)))),
    () => api<WorkoutSet>(`/workouts/${workoutId}/sets/${set.id}`, { method: "PATCH", body: changes }),
  );
  queryClient.setQueryData<WorkoutsData>(
    qk.workouts,
    (old) => old && updateActive(workoutId, (a) => withSets(a, a.sets.map((s) => (s.id === set.id ? saved : s))))(old),
  );
  invalidate(qk.workout(workoutId), ["exercise-history"]);
  return saved;
}

export async function deleteSet(workoutId: number, set: WorkoutSet): Promise<void> {
  await optimistic<WorkoutsData, void>(
    qk.workouts,
    updateActive(workoutId, (a) => withSets(a, a.sets.filter((s) => s.id !== set.id))),
    () => api(`/workouts/${workoutId}/sets/${set.id}`, { method: "DELETE" }),
  );
  invalidate(qk.workout(workoutId));
}

/** Undo for a deleted set: log it again with the same numbers. */
export const restoreSet = (workoutId: number, set: WorkoutSet) =>
  addSet(workoutId, {
    exercise_id: set.exercise_id,
    exercise_name: set.exercise_name,
    reps: set.reps,
    weight: set.weight_kg,
    unit: "kg",
    rpe: set.rpe,
    notes: set.notes,
    added_via: set.added_via,
  });

export async function finishWorkout(workoutId: number, notes: string): Promise<void> {
  await api(`/workouts/${workoutId}`, { method: "PATCH", body: { finish: true, notes } });
  invalidate(qk.workouts, ["exercise-history"], ...derivedKeys);
}

export async function deleteWorkout(workoutId: number): Promise<void> {
  await api(`/workouts/${workoutId}`, { method: "DELETE" });
  queryClient.setQueryData<WorkoutsData>(qk.workouts, (old) =>
    old ? { history: old.history.filter((w) => w.id !== workoutId), active: old.active?.id === workoutId ? null : old.active } : old,
  );
  invalidate(qk.workouts, ["exercise-history"], ...derivedKeys);
}

// ---------- food ----------

const dayTotals = (entries: FoodLogEntry[]) => ({
  calories: entries.reduce((a, e) => a + e.calories, 0),
  protein_g: entries.reduce((a, e) => a + e.protein_g, 0),
  carbs_g: entries.reduce((a, e) => a + e.carbs_g, 0),
  fat_g: entries.reduce((a, e) => a + e.fat_g, 0),
});

const withEntries = (day: FoodDay, entries: FoodLogEntry[]): FoodDay => ({ ...day, entries, totals: dayTotals(entries) });

function afterFoodChange(date: string) {
  invalidate(qk.foodDay(date), qk.foodRecent, ...derivedKeys);
}

/** Log a food. `preview` (calories etc. worked out on the phone) shows in the day until the server answers. */
export async function addFood(
  body: { food_id: number; quantity: number; unit: string; meal: Meal; date: string },
  preview?: Omit<FoodLogEntry, "id">,
): Promise<FoodLogEntry> {
  const key = qk.foodDay(body.date);
  const temp = preview ? { ...preview, id: tempId-- } : null;
  const saved = await optimistic<FoodDay, FoodLogEntry>(
    key,
    (day) => (temp ? withEntries(day, [...day.entries, temp]) : day),
    () => api<FoodLogEntry>("/food-logs", { method: "POST", body }),
  );
  queryClient.setQueryData<FoodDay>(key, (day) =>
    day ? withEntries(day, [...day.entries.filter((e) => e.id !== temp?.id && e.id !== saved.id), saved]) : day,
  );
  afterFoodChange(body.date);
  return saved;
}

export async function updateFood(entry: FoodLogEntry, changes: { quantity: number; unit: string; meal: Meal }): Promise<FoodLogEntry> {
  const key = qk.foodDay(entry.date);
  // Same unit: scale the numbers on the phone so the change shows at once
  const factor = changes.unit === entry.unit && entry.quantity > 0 ? changes.quantity / entry.quantity : null;
  const local: FoodLogEntry = factor
    ? {
        ...entry,
        ...changes,
        calories: entry.calories * factor,
        protein_g: entry.protein_g * factor,
        carbs_g: entry.carbs_g * factor,
        fat_g: entry.fat_g * factor,
      }
    : { ...entry, meal: changes.meal };
  const saved = await optimistic<FoodDay, FoodLogEntry>(
    key,
    (day) => withEntries(day, day.entries.map((e) => (e.id === entry.id ? local : e))),
    () => api<FoodLogEntry>(`/food-logs/${entry.id}`, { method: "PATCH", body: changes }),
  );
  queryClient.setQueryData<FoodDay>(key, (day) => (day ? withEntries(day, day.entries.map((e) => (e.id === entry.id ? saved : e))) : day));
  afterFoodChange(entry.date);
  return saved;
}

export async function deleteFood(entry: FoodLogEntry): Promise<void> {
  await optimistic<FoodDay, void>(
    qk.foodDay(entry.date),
    (day) => withEntries(day, day.entries.filter((e) => e.id !== entry.id)),
    () => api(`/food-logs/${entry.id}`, { method: "DELETE" }),
  );
  afterFoodChange(entry.date);
}

/** Undo for a deleted food: log it again with the same amount. */
export const restoreFood = (entry: FoodLogEntry) =>
  addFood(
    { food_id: entry.food_id, quantity: entry.quantity, unit: entry.unit, meal: entry.meal, date: entry.date },
    { ...entry },
  );

/** Log a meal from another day again. Returns the new entries (for Undo). */
export async function copyMeal(fromDate: string, toDate: string, meal: Meal | null): Promise<FoodLogEntry[]> {
  const created = await api<FoodLogEntry[]>("/food-logs/copy", {
    method: "POST",
    body: { from_date: fromDate, to_date: toDate, meal },
  });
  queryClient.setQueryData<FoodDay>(qk.foodDay(toDate), (day) => (day ? withEntries(day, [...day.entries, ...created]) : day));
  afterFoodChange(toDate);
  return created;
}

export async function deleteFoods(entries: FoodLogEntry[]): Promise<void> {
  if (!entries.length) return;
  const ids = new Set(entries.map((e) => e.id));
  const date = entries[0].date;
  await optimistic<FoodDay, void>(
    qk.foodDay(date),
    (day) => withEntries(day, day.entries.filter((e) => !ids.has(e.id))),
    async () => {
      for (const e of entries) await api(`/food-logs/${e.id}`, { method: "DELETE" });
    },
  );
  afterFoodChange(date);
}

// ---------- coach ----------

/** The coach logged or removed something: refresh the screens that show it. */
export function afterCoachActions(kinds: string[]) {
  if (!kinds.length) return;
  const keys: QueryKey[] = [...derivedKeys];
  if (kinds.some((k) => k === "food" || k === "removed")) keys.push(["food-day"], qk.foodRecent);
  if (kinds.some((k) => k === "sets" || k === "removed")) keys.push(qk.workouts, ["exercise-history"], ["workout"]);
  if (kinds.includes("sleep")) keys.push(qk.sleep);
  invalidate(...keys);
}
