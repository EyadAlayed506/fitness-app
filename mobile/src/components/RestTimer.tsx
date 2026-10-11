import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Platform, Text, Vibration, View } from "react-native";

import { api } from "@/lib/api";
import {
  formatRest,
  initialRestTimer,
  remainingMs,
  restTimerReducer,
  type RestTimerAction,
  type RestTimerState,
} from "@/lib/restTimer";
import { useTheme } from "@/lib/theme";
import type { RestSetting } from "@/lib/types";

import { Button, Meter, Row, Txt } from "./ui";

export interface RestTimer {
  state: RestTimerState;
  now: number;
  dispatch: (a: RestTimerAction) => void;
  /** Load the rest time for an exercise (the user's own or the default) and show it. */
  loadExercise: (exerciseId: number, exerciseName: string) => Promise<void>;
  /** Change the rest time by some seconds and remember it for this exercise. */
  adjust: (deltaSec: number) => void;
}

/**
 * One rest timer for the whole workout screen, so two countdowns can never run at once.
 * `onDone` runs once when a countdown reaches zero.
 */
export function useRestTimer(onDone: (exerciseName: string) => void): RestTimer {
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
  useEffect(() => {
    if (previous.current === "running" && state.status === "done") {
      if (Platform.OS === "web") beep();
      else Vibration.vibrate([0, 400, 200, 400]);
      doneRef.current(state.countdownFor);
    }
    previous.current = state.status;
  }, [state.status, state.countdownFor]);

  const loadExercise = useCallback(async (exerciseId: number, exerciseName: string) => {
    const setting = await api<RestSetting>(`/exercises/${exerciseId}/rest`).catch(() => ({ seconds: 90 }));
    dispatch({ type: "configure", exerciseId, exerciseName, durationSec: setting.seconds });
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

/** The rest-time section: remaining time, the exercise's rest length, and the controls. */
export function RestTimerPanel({ timer, compact = false }: { timer: RestTimer; compact?: boolean }) {
  const t = useTheme();
  const { state, dispatch, adjust } = timer;
  const left = remainingMs(state, timer.now);
  const running = state.status === "running";
  const paused = state.status === "paused";
  const done = state.status === "done";
  const total = state.durationSec * 1000;
  const label = running || paused ? `Rest after ${state.countdownFor || "your set"}` : done ? "Rest over" : `Rest for ${state.exerciseName}`;

  if (compact && state.status === "idle") return null;

  return (
    <View
      style={{ borderRadius: 12, padding: 12, marginTop: 12, backgroundColor: done ? t.accentSoft : t.surface2 }}
      accessibilityLabel={`Rest timer, ${formatRest(left)} left`}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Txt>
        {!compact ? (
          <Row gap={6}>
            <Button title="−15 s" kind="ghost" small onPress={() => adjust(-15)} accessibilityLabel="Shorter rest, 15 seconds less" />
            <Button title="+15 s" kind="ghost" small onPress={() => adjust(15)} accessibilityLabel="Longer rest, 15 seconds more" />
          </Row>
        ) : null}
      </Row>
      <Row style={{ alignItems: "baseline", marginTop: 4 }} gap={8}>
        <Text
          style={{ fontSize: compact ? 28 : 44, fontWeight: "700", color: done ? t.accent : t.text, fontVariant: ["tabular-nums"] }}
          accessibilityLiveRegion="polite"
        >
          {done ? "0:00" : formatRest(left)}
        </Text>
        <Txt variant="tiny">
          {done ? "Time for your next set" : paused ? "Paused" : `of ${formatRest(total)}`}
        </Txt>
      </Row>
      {running || paused ? <View style={{ marginTop: 6 }}><Meter value={total - left} max={total} height={6} /></View> : null}
      <Row style={{ marginTop: 10, flexWrap: "wrap" }} gap={6}>
        {running ? <Button title="Pause" icon="pause" small onPress={() => dispatch({ type: "pause", now: Date.now() })} /> : null}
        {paused ? <Button title="Resume" icon="play" small onPress={() => dispatch({ type: "resume", now: Date.now() })} /> : null}
        {state.status === "idle" || done ? (
          <Button title={done ? "Start again" : "Start rest"} icon="timer-outline" small kind="soft" onPress={() => dispatch({ type: "start", now: Date.now() })} />
        ) : null}
        {running || paused ? <Button title="Restart" icon="refresh" small kind="ghost" onPress={() => dispatch({ type: "restart", now: Date.now() })} /> : null}
        {running || paused || done ? <Button title={done ? "Dismiss" : "Skip"} small kind="ghost" onPress={() => dispatch({ type: "skip" })} /> : null}
      </Row>
    </View>
  );
}
