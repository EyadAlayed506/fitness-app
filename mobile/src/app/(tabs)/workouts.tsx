import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ExerciseInfo } from "@/components/ExerciseInfo";
import { ExercisePhoto } from "@/components/ExercisePhoto";
import { RestTimerPanel, useRestTimer } from "@/components/RestTimer";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  FadeIn,
  Field,
  IconButton,
  ListRow,
  Row,
  Screen,
  Section,
  Sheet,
  SkeletonCards,
  Stat,
  Txt,
  useToast,
} from "@/components/ui";
import { ExerciseSearch, QrScanner, SetForm, SetsList, WorkoutDetail, type PickedExercise } from "@/components/WorkoutParts";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { WEEKDAYS_SHORT, duration, longDateTime, plural, timeOf, tzOffset, units, weekdayIndex } from "@/lib/format";
import { confirm } from "@/lib/confirm";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Points, Routine, Workout } from "@/lib/types";

type SheetState =
  | { kind: "search" }
  | { kind: "scan" }
  | { kind: "photo" }
  | { kind: "set"; exercise: PickedExercise; via: "name" | "qr" | "photo" }
  | { kind: "info"; exercise: PickedExercise }
  | { kind: "plan" }
  | { kind: "history"; id: number }
  | null;

export default function Workouts() {
  const t = useTheme();
  const toast = useToast();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [active, setActive] = useState<Workout | null>(null);
  const [notes, setNotes] = useState("");
  const [openDay, setOpenDay] = useState<number | null>(null); // weekday index; null = today or the next training day
  const [sheet, setSheet] = useState<SheetState>(null);
  // One rest timer for the whole screen, so there's never more than one countdown
  const timer = useRestTimer((name) => toast(name ? `Rest is over. Time for your next set of ${name}` : "Rest is over. Time for your next set"));

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, r] = await Promise.all([api<Workout[]>("/workouts?limit=15"), api<Routine>("/me/routine")]);
      setRoutine(r);
      setHistory(list.filter((w) => w.ended_at));
      const current = list.find((w) => !w.ended_at);
      const full = current ? await api<Workout>(`/workouts/${current.id}`) : null;
      setActive(full);
      setNotes(full?.notes ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your workouts.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const closeSheet = () => {
    setSheet(null);
    load().catch(() => {});
  };
  const logExercise = (exercise: PickedExercise, via: "name" | "qr" | "photo") => {
    if (!active) {
      toast("Start a workout first, then tap an exercise to log it");
      return;
    }
    timer.loadExercise(exercise.id, exercise.name).catch(() => {});
    setSheet({ kind: "set", exercise, via });
  };

  const todayPlan = routine?.days.find((d) => d.weekday_index === weekdayIndex()) ?? null;

  return (
    <Screen
      title="Workouts"
      subtitle={routine ? `${routine.split} · ${routine.days_per_week} days a week`.toUpperCase() : undefined}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load().catch(() => {});
        setRefreshing(false);
      }}
    >
      {error ? (
        <Card>
          <ErrorText message={error} />
          <Button title="Try again" kind="soft" small onPress={load} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
        </Card>
      ) : null}
      {!loaded ? (
        <SkeletonCards count={3} />
      ) : (
        <FadeIn>
          {active ? (
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <Row gap={space.sm}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.good }} />
                  <Txt variant="tiny" style={{ ...typeScale.overline, color: t.goodInk }}>
                    IN PROGRESS
                  </Txt>
                </Row>
                <Txt variant="tiny">Started {timeOf(active.started_at)}</Txt>
              </Row>
              <Row style={{ marginTop: space.md }}>
                <Stat label="Sets" value={String(active.set_count)} />
                <Stat label="Volume" value={u.weight(active.volume_kg, 0)} />
                <Stat label="Exercises" value={String(new Set(active.sets.map((x) => x.exercise_id)).size)} />
              </Row>
              <Button title="Add exercise" icon="add" onPress={() => setSheet({ kind: "search" })} style={{ marginTop: space.lg }} />
              <Row style={{ marginTop: space.sm }}>
                <Button title="Scan QR" icon="qr-code" kind="soft" small onPress={() => setSheet({ kind: "scan" })} style={{ flex: 1 }} />
                <Button title="From photo" icon="image" kind="soft" small onPress={() => setSheet({ kind: "photo" })} style={{ flex: 1 }} />
              </Row>
              {sheet?.kind !== "set" ? <RestTimerPanel timer={timer} compact /> : null}
              <View style={{ marginTop: space.lg }}>
                <SetsList
                  sets={active.sets}
                  onAddSet={(e) => logExercise(e, "name")}
                  onDelete={async (s) => {
                    await api(`/workouts/${active.id}/sets/${s.id}`, { method: "DELETE" });
                    await load();
                  }}
                />
              </View>
              <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="How did it go?" multiline />
              <Button
                title="Finish workout"
                icon="checkmark"
                style={{ marginTop: space.lg }}
                onPress={async () => {
                  await api(`/workouts/${active.id}`, { method: "PATCH", body: { finish: true, notes } });
                  const points = await api<Points>(`/points?tz_offset=${tzOffset()}`).catch(() => null);
                  const earned = points?.new.reduce((sum, x) => sum + x.points, 0) ?? 0;
                  toast(earned ? `Workout saved. +${earned} wellness points` : "Workout saved. Nice work!");
                  await load();
                }}
              />
              <Button
                title="Discard workout"
                kind="danger"
                small
                style={{ marginTop: space.sm, alignSelf: "center", borderColor: "transparent" }}
                onPress={async () => {
                  if (!(await confirm("Discard workout?", "The sets you logged in this workout will be deleted.", "Discard"))) return;
                  await api(`/workouts/${active.id}`, { method: "DELETE" });
                  await load();
                }}
              />
            </Card>
          ) : (
            <Card style={{ padding: space.lg + 2 }}>
              <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
                {todayPlan ? "TODAY'S SESSION" : "REST DAY"}
              </Txt>
              <Txt style={{ ...typeScale.heading, fontSize: 19, lineHeight: 24, marginTop: 2 }}>
                {todayPlan ? todayPlan.title : "Nothing planned today"}
              </Txt>
              <Txt variant="small" style={{ marginTop: space.sm }}>
                {todayPlan
                  ? `${plural(todayPlan.exercises.length, "exercise")}${todayPlan.cardio_minutes ? ` + ${todayPlan.cardio_minutes} min cardio` : ""}. Add exercises by name, by scanning a machine’s QR code, or from a photo.`
                  : "You can still log a workout. Add exercises by name, by scanning a machine’s QR code, or from a photo."}
              </Txt>
              <Button
                title="Start workout"
                icon="play"
                style={{ marginTop: space.lg }}
                onPress={async () => {
                  await api("/workouts", { method: "POST", body: {} });
                  await load();
                }}
              />
            </Card>
          )}

          {routine ? (
            <>
              <Section title="Your week" action="Edit plan" onAction={() => setSheet({ kind: "plan" })} />
              <Card>
                <WeekStrip routine={routine} />
                <Txt variant="small" style={{ marginTop: space.md }}>
                  {routine.exercises_per_day} exercises per session · about {routine.minutes_per_session} min
                </Txt>
                {routine.warnings.map((w) => (
                  <Row key={w} gap={6} style={{ marginTop: space.xs, alignItems: "flex-start" }}>
                    <Ionicons name="warning" size={14} color={t.warnInk} style={{ marginTop: 2 }} />
                    <Txt variant="small" style={{ color: t.warnInk, flex: 1 }}>
                      {w}
                    </Txt>
                  </Row>
                ))}
              </Card>
              <Card style={{ paddingVertical: space.xs }}>
                {routine.days.map((d, i) => {
                  const shown = openDay ?? nextTrainingDay(routine);
                  const open = shown === d.weekday_index;
                  const isToday = d.weekday_index === weekdayIndex();
                  return (
                    <View key={d.weekday} style={{ borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.border }}>
                      <Pressable
                        onPress={() => setOpenDay(open ? -1 : d.weekday_index)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, opacity: pressed ? 0.6 : 1 })}
                      >
                        <View style={{ width: 40 }}>
                          <Txt variant="tiny" style={{ ...typeScale.overline, color: isToday ? t.accent : t.muted }}>
                            {d.weekday.slice(0, 3).toUpperCase()}
                          </Txt>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontWeight: "600" }} numberOfLines={1}>
                            {d.title}
                          </Txt>
                          <Txt variant="tiny" numberOfLines={1}>
                            {d.custom_name ? `${d.focus_label} · ` : ""}
                            {plural(d.exercises.length, "exercise")}
                            {d.cardio_minutes ? ` · ${d.cardio_minutes} min cardio` : ""}
                          </Txt>
                        </View>
                        {isToday ? <Badge label="Today" tone="info" /> : null}
                        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
                      </Pressable>
                      {open ? (
                        <View style={{ paddingBottom: space.md, paddingLeft: 40 + space.md }}>
                          {d.exercises.map((x) => (
                            <Row key={x.exercise_id} gap={space.sm} style={{ minHeight: 44 }}>
                              <Pressable
                                onPress={() => logExercise({ id: x.exercise_id, name: x.name }, "name")}
                                accessibilityRole="button"
                                accessibilityLabel={`Log ${x.name}`}
                                style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.5 : 1, paddingVertical: space.xs })}
                              >
                                <Txt style={{ color: active ? t.accent : t.text }} numberOfLines={2}>
                                  {x.name}
                                </Txt>
                                <Txt variant="tiny">
                                  {x.sets} × {x.reps}
                                </Txt>
                              </Pressable>
                              <IconButton
                                icon="information-circle-outline"
                                label={`How to do ${x.name}, and alternatives`}
                                onPress={() => setSheet({ kind: "info", exercise: { id: x.exercise_id, name: x.name } })}
                              />
                            </Row>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
              <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
                <Txt variant="small">
                  <Txt variant="small" style={{ fontWeight: "600", color: t.text }}>
                    {routine.split}.
                  </Txt>{" "}
                  {routine.split_reason}
                </Txt>
                {routine.notes.map((n) => (
                  <Txt key={n} variant="tiny">
                    • {n}
                  </Txt>
                ))}
              </View>
            </>
          ) : null}

          <Section title="History" />
          <Card style={{ paddingVertical: history.length ? space.xs : space.lg }}>
            {history.length ? (
              history.map((w, i) => (
                <ListRow
                  key={w.id}
                  first={i === 0}
                  icon="barbell-outline"
                  title={longDateTime(w.started_at)}
                  subtitle={`${plural(w.set_count, "set")} · ${u.weight(w.volume_kg, 0)}${w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}`}
                  onPress={() => setSheet({ kind: "history", id: w.id })}
                />
              ))
            ) : (
              <EmptyState icon="barbell-outline" title="No finished workouts yet" text="Finished workouts show up here with their sets and volume." />
            )}
          </Card>
          <Card onPress={() => router.push("/qr-stickers")}>
            <Row gap={space.md}>
              <Ionicons name="qr-code-outline" size={20} color={t.text2} />
              <Txt style={{ flex: 1 }}>Print QR stickers for the machines</Txt>
              <Ionicons name="chevron-forward" size={18} color={t.muted} />
            </Row>
          </Card>
        </FadeIn>
      )}

      <Sheet visible={sheet?.kind === "search"} title="Add exercise" onClose={closeSheet}>
        <ExerciseSearch onPick={(e) => logExercise(e, "name")} />
      </Sheet>
      <Sheet visible={sheet?.kind === "scan"} title="Scan machine QR code" onClose={closeSheet}>
        {sheet?.kind === "scan" ? (
          <QrScanner onFound={(e) => logExercise({ id: e.id, name: e.name }, "qr")} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "photo"} title="What machine is this?" onClose={closeSheet}>
        {sheet?.kind === "photo" ? (
          <ExercisePhoto onPick={(e) => logExercise(e, "photo")} onSearch={() => setSheet({ kind: "search" })} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "set"} title={sheet?.kind === "set" ? sheet.exercise.name : ""} onClose={closeSheet}>
        {sheet?.kind === "set" && active ? (
          <SetForm
            key={sheet.exercise.id}
            workoutId={active.id}
            exercise={sheet.exercise}
            addedVia={sheet.via}
            timer={timer}
            onSaved={toast}
            onInfo={() => setSheet({ kind: "info", exercise: sheet.exercise })}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "info"} title={sheet?.kind === "info" ? sheet.exercise.name : ""} onClose={closeSheet}>
        {sheet?.kind === "info" ? (
          <ExerciseInfo
            exerciseId={sheet.exercise.id}
            onUse={active ? (e) => logExercise(e, "name") : undefined}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "plan"} title="Your plan" onClose={closeSheet}>
        {sheet?.kind === "plan" && routine ? (
          <ScheduleEditor
            routine={routine}
            onSaved={(_, message) => {
              setOpenDay(null);
              toast(message);
              closeSheet();
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "history"} title="Workout" onClose={closeSheet}>
        {sheet?.kind === "history" ? <WorkoutDetail workoutId={sheet.id} onDeleted={closeSheet} /> : null}
      </Sheet>
    </Screen>
  );
}

/** Today if it's a training day, otherwise the next one. */
function nextTrainingDay(routine: Routine): number {
  const today = weekdayIndex();
  for (let k = 0; k < 7; k++) {
    const d = (today + k) % 7;
    if (routine.training_days.includes(d)) return d;
  }
  return routine.training_days[0] ?? 0;
}

/** Monday to Sunday: training days with their session, rest days, and today. */
function WeekStrip({ routine }: { routine: Routine }) {
  const t = useTheme();
  const today = weekdayIndex();
  const titles = new Map(routine.days.map((d) => [d.weekday_index, d.title]));
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`Training days: ${routine.days.map((d) => d.weekday).join(", ")}`}>
      {WEEKDAYS_SHORT.map((label, d) => {
        const title = titles.get(d);
        const isToday = d === today;
        return (
          <View key={label} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <Txt variant="tiny" style={{ color: isToday ? t.text : t.muted, fontWeight: isToday ? "700" : "500" }}>
              {label}
            </Txt>
            <View
              style={{
                width: "100%",
                maxWidth: 44,
                height: 36,
                borderRadius: radius.sm + 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: title ? (isToday ? t.ink : t.accentSoft) : t.surface2,
              }}
            >
              <Ionicons
                name={title ? "barbell" : "remove"}
                size={14}
                color={title ? (isToday ? t.inkText : t.accent) : t.muted}
              />
            </View>
            <Txt variant="tiny" style={{ color: title ? t.text2 : t.muted, fontSize: 10, lineHeight: 12, textAlign: "center" }} numberOfLines={2}>
              {title ?? "Rest"}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}
