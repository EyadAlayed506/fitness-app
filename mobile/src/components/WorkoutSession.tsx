import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useWorkouts } from "@/lib/data";
import { cancelRestEnd, scheduleRestEnd } from "@/lib/restNotifications";
import { formatRest, remainingMs, type RestTimerState } from "@/lib/restTimer";
import { storage } from "@/lib/storage";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";

import { useRestTimer, type RestTimer } from "./RestTimer";
import { useToast, useToastInset } from "./ui";

interface WorkoutSessionValue {
  /** the one rest timer, shared by every screen */
  timer: RestTimer;
  /** weekday (0 = Monday) of the plan day the workout in progress follows, or null for a free workout */
  planDay: number | null;
  setPlanDay: (workoutId: number, weekday: number | null) => void;
  /** forget the plan day of a workout that was finished or discarded */
  clearPlanDay: (workoutId: number) => void;
}

const WorkoutSessionContext = createContext<WorkoutSessionValue | null>(null);

const planKey = (workoutId: number) => `guided_${workoutId}`;

/** State of the workout in progress that every tab needs: the rest timer and the plan day being followed. */
export function WorkoutSessionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { data } = useWorkouts();
  const activeId = data?.active?.id ?? null;
  const timer = useRestTimer((name) =>
    toast(name ? `Rest is over. Time for your next set of ${name}` : "Rest is over. Time for your next set"),
  );
  useRestNotification(timer.state);

  // The plan day is remembered on this device per workout (e.g. after the app restarts)
  const [plan, setPlan] = useState<{ workoutId: number; weekday: number | null } | null>(null);
  useEffect(() => {
    if (activeId == null) return;
    let cancelled = false;
    storage
      .get(planKey(activeId))
      .then((saved) => {
        if (!cancelled) setPlan({ workoutId: activeId, weekday: saved ? Number(saved) : null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeId]);
  const setPlanDay = useCallback((workoutId: number, weekday: number | null) => {
    setPlan({ workoutId, weekday });
    if (weekday == null) storage.remove(planKey(workoutId)).catch(() => {});
    else storage.set(planKey(workoutId), String(weekday)).catch(() => {});
  }, []);
  const clearPlanDay = useCallback((workoutId: number) => {
    storage.remove(planKey(workoutId)).catch(() => {});
  }, []);

  const planDay = plan && plan.workoutId === activeId ? plan.weekday : null;
  const value = useMemo(() => ({ timer, planDay, setPlanDay, clearPlanDay }), [timer, planDay, setPlanDay, clearPlanDay]);
  return <WorkoutSessionContext.Provider value={value}>{children}</WorkoutSessionContext.Provider>;
}

export function useWorkoutSession(): WorkoutSessionValue {
  const ctx = useContext(WorkoutSessionContext);
  if (!ctx) throw new Error("useWorkoutSession must be used inside WorkoutSessionProvider");
  return ctx;
}

/** Keep one "Rest is over" notification scheduled while a rest counts down. */
function useRestNotification(state: RestTimerState) {
  const scheduled = useRef<string | null>(null);
  const { status, endsAt, countdownFor } = state;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await cancelRestEnd(scheduled.current);
      scheduled.current = null;
      if (status !== "running" || endsAt == null) return;
      const id = await scheduleRestEnd((endsAt - Date.now()) / 1000, countdownFor);
      if (cancelled) await cancelRestEnd(id);
      else scheduled.current = id;
    })();
    return () => {
      cancelled = true;
    };
  }, [status, endsAt, countdownFor]);
}

// ---------- the bar above the tabs ----------

const BAR_HEIGHT = 48;

/** "Workout · 23:14 · Rest 1:12": shown above the tab bar on every tab except Workouts. Tap to go back. */
export function WorkoutMiniBar() {
  const t = useTheme();
  const pathname = usePathname();
  const { data } = useWorkouts();
  const { timer } = useWorkoutSession();
  const active = data?.active ?? null;
  const visible = !!active && pathname !== "/workouts";
  useToastInset(visible ? BAR_HEIGHT + space.sm : 0);
  if (!visible || !active) return null;
  const resting = timer.state.status === "running" || timer.state.status === "paused";
  const restDone = timer.state.status === "done";
  return (
    <Pressable
      onPress={() => router.navigate("/workouts")}
      accessibilityRole="button"
      accessibilityLabel="Workout in progress. Open it"
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: t.surface, borderTopColor: t.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: t.good }]} />
      <Text style={[typeScale.label, { color: t.text }]}>Workout</Text>
      <Elapsed since={active.started_at} />
      <View style={{ flex: 1 }} />
      {resting ? (
        <View style={[styles.pill, { backgroundColor: t.accentSoft }]}>
          <Ionicons name="timer-outline" size={14} color={t.accent} />
          <Text style={[typeScale.label, { color: t.accent, fontVariant: ["tabular-nums"] }]}>
            Rest {formatRest(remainingMs(timer.state, timer.now))}
            {timer.state.status === "paused" ? " · paused" : ""}
          </Text>
        </View>
      ) : restDone ? (
        <View style={[styles.pill, { backgroundColor: t.goodSoft }]}>
          <Ionicons name="checkmark" size={14} color={t.goodInk} />
          <Text style={[typeScale.label, { color: t.goodInk }]}>Next set</Text>
        </View>
      ) : (
        <Text style={[typeScale.small, { color: t.text2 }]}>
          {active.set_count} {active.set_count === 1 ? "set" : "sets"}
        </Text>
      )}
      <Ionicons name="chevron-up" size={18} color={t.muted} />
    </Pressable>
  );
}

/** Time since the workout started, ticking every second ("23:14", then "1:02:05"). */
function Elapsed({ since }: { since: string }) {
  const t = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text style={[typeScale.small, { color: t.text2, fontVariant: ["tabular-nums"] }]}>{elapsedText(now - Date.parse(since))}</Text>;
}

export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export { Elapsed };

const styles = StyleSheet.create({
  bar: {
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm + 2, paddingVertical: 4, borderRadius: radius.pill },
});
