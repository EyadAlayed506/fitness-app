import { QueryClient, focusManager, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

/**
 * Cached server data (TanStack Query).
 *
 * Every screen reads its data through a query, so opening a tab shows what was loaded before right
 * away and refreshes it in the background. Logging something updates the cache straight away
 * (optimistic update) and then refetches what it affects.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // data younger than this isn't refetched when a screen comes back into view
      gcTime: 10 * 60_000,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

// On phones, "window focus" means the app coming back to the foreground
if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => sub.remove();
  });
}

/** Query keys in one place, so screens and mutations agree on them. */
export const qk = {
  foodDay: (date: string) => ["food-day", date] as const,
  foodRecent: ["food-recent"] as const,
  sleep: ["sleep"] as const,
  sleepList: (limit: number) => ["sleep", "list", limit] as const,
  sleepAnalytics: (days: number) => ["sleep", "analytics", days] as const,
  whoop: ["whoop"] as const,
  recommendations: ["recommendations"] as const,
  points: ["points"] as const,
  gettingStarted: ["getting-started"] as const,
  workouts: ["workouts"] as const,
  workout: (id: number) => ["workout", id] as const,
  routine: ["routine"] as const,
  exerciseHistory: (exerciseId: number, excludeWorkoutId: number | null) =>
    ["exercise-history", exerciseId, excludeWorkoutId] as const,
  progress: ["progress"] as const,
  lift: (exerciseId: number) => ["progress", "lift", exerciseId] as const,
  weekly: (week: string | null) => ["weekly", week ?? "current"] as const,
  assistant: ["assistant"] as const,
  gyms: ["gyms"] as const,
  gymInventory: (gymId: number) => ["gyms", "inventory", gymId] as const,
  machineSetting: (gymId: number, exerciseId: number) => ["gyms", "machine", gymId, exerciseId] as const,
  machinePhotos: ["photo-memory", "photos"] as const,
  photoStatus: ["photo-memory", "status"] as const,
  alternatives: (exerciseId: number) => ["alternatives", exerciseId] as const,
};

/** Everything that depends on logged workouts, food, sleep or weight (recommendations, points, charts). */
export const derivedKeys: QueryKey[] = [
  qk.recommendations,
  qk.points,
  qk.gettingStarted,
  qk.progress,
  ["weekly"],
];

/** Mark these queries out of date; the ones on screen refetch in the background. */
export function invalidate(...keys: QueryKey[]) {
  for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
}

/**
 * When the screen comes back into view, refetch its queries that are older than `staleTime`.
 * (The first time, the queries load by themselves.)
 */
export function useRefreshOnFocus(keys: QueryKey[]) {
  const client = useQueryClient();
  const first = useRef(true);
  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  });
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      for (const queryKey of keysRef.current) client.refetchQueries({ queryKey, stale: true, type: "active" });
    }, [client]),
  );
}

/** A query's error as a message, or null. */
export const errorMessage = (e: unknown): string | null =>
  e == null ? null : e instanceof Error ? e.message : "Something went wrong. Try again.";
