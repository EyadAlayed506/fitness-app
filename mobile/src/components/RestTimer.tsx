import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Platform, Pressable, Text, Vibration, View } from "react-native";

import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  clampRest,
  formatRest,
  initialRestTimer,
  remainingMs,
  restTimerReducer,
  type RestTimerAction,
  type RestTimerState,
} from "@/lib/restTimer";
import { radius, space, useTheme } from "@/lib/theme";
import type { RestSetting } from "@/lib/types";

import { Meter, Row, Txt, type IconName } from "./ui";

export interface RestTimer {
  state: RestTimerState;
  now: number;
  dispatch: (a: RestTimerAction) => void;
  /** Load the rest time for an exercise (the user's own or the default) and show it. */
  loadExercise: (exerciseId: number, exerciseName: string) => Promise<number>;
  /** Change the rest time by some seconds and remember it for this exercise. */
  adjust: (deltaSec: number) => void;
}

/**
 * One rest timer for the whole workout (it lives in WorkoutSessionProvider), so two countdowns can never
 * run at once. `onDone` runs once when a countdown reaches zero; `late` is true when it ended while the
 * app was in the background (the notification already told the user).
 */
export function useRestTimer(onDone: (exerciseName: string, late: boolean) => void): RestTimer {
  const [state, dispatch] = useReducer(restTimerReducer, undefined, () => initialRestTimer());
  const [now, setNow] = useState(() => Date.now());
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A single interval, only while counting down
  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: "tick", now: t });
    }, 250);
    return () => clearInterval(id);
  }, [state.status]);

  const previous = useRef(state.status);
  const endsAt = useRef<number | null>(null);
  useEffect(() => {
    if (state.status === "running") endsAt.current = state.endsAt;
    if (previous.current === "running" && state.status === "done") {
      const late = endsAt.current != null && Date.now() - endsAt.current > 3000;
      if (!late) {
        if (Platform.OS === "web") beep();
        else {
          haptics.alert();
          Vibration.vibrate([0, 400, 200, 400]);
        }
      }
      doneRef.current(state.countdownFor, late);
    }
    previous.current = state.status;
  }, [state.status, state.countdownFor, state.endsAt]);

  const loadExercise = useCallback(async (exerciseId: number, exerciseName: string) => {
    const setting = await api<RestSetting>(`/exercises/${exerciseId}/rest`).catch(() => ({ seconds: 90 }));
    dispatch({ type: "configure", exerciseId, exerciseName, durationSec: setting.seconds });
    return clampRest(setting.seconds); // the rest time now in use
  }, []);

  const adjust = useCallback(
    (deltaSec: number) => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: "adjust", deltaSec, now: t });
      const id = state.exerciseId;
      const seconds = Math.min(600, Math.max(15, state.durationSec + deltaSec));
      if (id == null) return;
      // Remember the new time for this exercise (once the user stops tapping)
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        api(`/exercises/${id}/rest`, { method: "PUT", body: { seconds } }).catch(() => {});
      }, 600);
    },
    [state.exerciseId, state.durationSec],
  );

  const wrappedDispatch = useCallback((a: RestTimerAction) => {
    setNow(Date.now());
    dispatch(a);
  }, []);

  return { state, now, dispatch: wrappedDispatch, loadExercise, adjust };
}

/** Two short tones in the browser (phones vibrate instead). Silently does nothing if audio isn't allowed. */
function beep() {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.3].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // no sound available: the on-screen message still shows
  }
}

/**
 * The rest timer as one line: time left, then small controls. `compact` (the workout card) hides it
 * while no rest is running. The countdown starts by itself when a set is logged.
 */
export function RestTimerPanel({ timer, compact = false }: { timer: RestTimer; compact?: boolean }) {
  const t = useTheme();
  const { state, dispatch, adjust } = timer;
  const left = remainingMs(state, timer.now);
  const running = state.status === "running";
  const paused = state.status === "paused";
  const done = state.status === "done";
  // the running countdown's own length (moving on to another exercise changes only the next one)
  const total = (running || paused ? state.countdownSec : state.durationSec) * 1000;

  if (compact && state.status === "idle") return null;

  const play = running
    ? { icon: "pause" as const, label: "Pause the rest", onPress: () => dispatch({ type: "pause", now: Date.now() }) }
    : paused
      ? { icon: "play" as const, label: "Resume the rest", onPress: () => dispatch({ type: "resume", now: Date.now() }) }
      : { icon: "play" as const, label: done ? "Start the rest again" : "Start the rest", onPress: () => dispatch({ type: "start", now: Date.now() }) };

  return (
    <View
      style={{ marginTop: space.md, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.sm, borderRadius: radius.md, backgroundColor: done ? t.accentSoft : t.surface2 }}
      accessibilityLabel={`Rest timer, ${formatRest(left)} left`}
    >
      <Row gap={space.sm} style={{ alignItems: "center" }}>
        <Ionicons name="timer-outline" size={18} color={done ? t.accentText : t.text2} />
        <Text
          style={{ fontSize: 20, fontWeight: "700", color: done ? t.accentText : t.text, fontVariant: ["tabular-nums"] }}
          accessibilityLiveRegion="polite"
        >
          {done ? "0:00" : formatRest(left)}
        </Text>
        <Txt variant="tiny" style={{ flex: 1 }} numberOfLines={1}>
          {done ? "Rest over" : paused ? "Paused" : running ? `of ${formatRest(total)}` : "rest"}
        </Txt>
        <TimerButton text="−15" label="Shorter rest, 15 seconds less" onPress={() => adjust(-15)} />
        <TimerButton text="+15" label="Longer rest, 15 seconds more" onPress={() => adjust(15)} />
        <TimerButton icon={play.icon} label={play.label} onPress={play.onPress} />
        {running || paused || done ? <TimerButton icon="close" label={done ? "Dismiss" : "Skip the rest"} onPress={() => dispatch({ type: "skip" })} /> : null}
      </Row>
      {running || paused ? (
        <View style={{ marginTop: 6, marginRight: space.xs }}>
          <Meter value={total - left} max={total} height={3} />
        </View>
      ) : null}
    </View>
  );
}

/** A small control in the rest line (its touch area is larger than it looks). */
function TimerButton({ text, icon, label, onPress }: { text?: string; icon?: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        minWidth: 34,
        height: 32,
        paddingHorizontal: 6,
        borderRadius: radius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.surface,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {icon ? (
        <Ionicons name={icon} size={16} color={t.text} />
      ) : (
        <Text style={{ fontSize: 13, fontWeight: "600", color: t.text, fontVariant: ["tabular-nums"] }}>{text}</Text>
      )}
    </Pressable>
  );
}
