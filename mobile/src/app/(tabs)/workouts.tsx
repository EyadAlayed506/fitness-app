import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ExerciseInfo } from "@/components/ExerciseInfo";
import { GymPicker, MachineTaken } from "@/components/GymParts";
import { ExercisePhoto } from "@/components/ExercisePhoto";
import { RestTimerPanel } from "@/components/RestTimer";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import {
  Badge,
  Button,
  Card,
  Chips,
  EmptyState,
  ErrorText,
  FadeIn,
  Field,
  Icon,
  IconButton,
  LinkButton,
  ListRow,
  Row,
  Screen,
  Section,
  Sheet,
  SkeletonCards,
  Stat,
  Txt,
  useToast,
  type IconName,
} from "@/components/ui";
import { ExerciseSearch, QrScanner, SetEditForm, SetForm, SetsList, WorkoutDetail, type PickedExercise } from "@/components/WorkoutParts";
import { Elapsed, useWorkoutSession } from "@/components/WorkoutSession";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import {
  deleteSet,
  deleteWorkout,
  finishWorkout,
  removeCustomDay,
  restoreSet,
  setWorkoutGym,
  startWorkout,
  useCurrentGym,
  useRoutine,
  useWorkouts,
} from "@/lib/data";
import { WEEKDAYS, WEEKDAYS_MIN, WEEKDAYS_SHORT, duration, longDateTime, timeOf, tzOffset, units, weekdayIndex } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { errorMessage, invalidate, qk, queryClient, useRefreshOnFocus } from "@/lib/query";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Points, Routine, RoutineDay, WorkoutSet } from "@/lib/types";

type Via = "name" | "qr" | "photo";
type SheetState =
  | { kind: "search" }
  | { kind: "scan" }
  | { kind: "photo" }
  | { kind: "set"; exercise: PickedExercise; via: Via }
  | { kind: "info"; exercise: PickedExercise }
  | { kind: "plan" }
  | { kind: "history"; id: number }
  | { kind: "edit-set"; workoutId: number; set: WorkoutSet; back: SheetState }
  | { kind: "taken"; exercise: PickedExercise }
  | { kind: "gym-pick" }
  | null;

export default function Workouts() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const toast = useToast();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const workouts = useWorkouts();
  const routineQuery = useRoutine();
  useRefreshOnFocus([qk.workouts, qk.routine]);
  const { timer, planDay, plan, setPlanDay, swap, clearPlanDay } = useWorkoutSession();
  const gym = useCurrentGym();
  const params = useLocalSearchParams<{ start?: string }>();
  // typed notes; `base` is what the saved notes were when typing started (the server copy can change meanwhile, e.g. from another device)
  const [notesDraft, setNotesDraft] = useState<{ workoutId: number; text: string; base: string } | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null); // weekday index; null = today or the next training day
  const [sheet, setSheet] = useState<SheetState>(null);
  const [refreshing, setRefreshing] = useState(false);

  const active = workouts.data?.active ?? null;
  const history = workouts.data?.history ?? [];
  const routine = routineQuery.data ?? null;
  const today = weekdayIndex();
  const todayPlan = routine?.days.find((d) => d.weekday_index === today) ?? null;
  // what the workout follows: a one-off session (another gym) or a day of the plan, with "machine taken" swaps
  const baseDay = plan?.day ?? (planDay != null ? (routine?.days.find((d) => d.weekday_index === planDay) ?? null) : null);
  const swaps = plan?.swaps ?? {};
  const swappedFrom: Record<number, string> = {};
  const followed: RoutineDay | null = baseDay
    ? {
        ...baseDay,
        exercises: baseDay.exercises.map((x) => {
          const to = swaps[x.exercise_id];
          if (!to) return x;
          swappedFrom[to.id] = x.name;
          return { ...x, exercise_id: to.id, name: to.name };
        }),
      }
    : null;
  /** the planned exercise an exercise stands in for (itself when it wasn't swapped) */
  const plannedId = (exerciseId: number) =>
    Number(Object.entries(swaps).find(([, to]) => to.id === exerciseId)?.[0] ?? exerciseId);
  const saved = active?.notes ?? "";
  const notes =
    notesDraft && notesDraft.workoutId === active?.id
      ? saved !== notesDraft.base && saved.startsWith(notesDraft.base)
        ? notesDraft.text + saved.slice(notesDraft.base.length) // keep voice notes added while typing
        : notesDraft.text
      : saved;

  const done = (exerciseId: number) => active?.sets.filter((s) => s.exercise_id === exerciseId).length ?? 0;
  const planned = followed?.exercises ?? [];
  const upNext = planned.find((x) => done(x.exercise_id) < x.sets) ?? null;
  /** The next planned exercise that still needs sets, after this one (then wrapping round). */
  const nextAfter = (exerciseId: number): PickedExercise | null => {
    const i = planned.findIndex((x) => x.exercise_id === exerciseId);
    const order = i >= 0 ? [...planned.slice(i + 1), ...planned.slice(0, i)] : planned;
    const x = order.find((p) => done(p.exercise_id) < p.sets);
    return x ? { id: x.exercise_id, name: x.name } : null;
  };

  // After starting a plan day, the first exercise opens straight away: nothing to add by hand
  const openFirst = useRef(false);
  const startSession = async (weekday: number | null) => {
    try {
      const created = await startWorkout();
      if (weekday != null) {
        setPlanDay(created.id, weekday);
        openFirst.current = true;
      }
      haptics.impact();
    } catch (e) {
      toast(errorMessage(e) ?? tr("workouts.couldntStart"));
    }
  };

  // "Start workout" on the Today screen opens this tab with ?start=today
  const handledStart = useRef(false);
  useEffect(() => {
    if (params.start !== "today") {
      handledStart.current = false;
      return;
    }
    if (handledStart.current || !workouts.data || !routine) return;
    handledStart.current = true;
    router.setParams({ start: undefined });
    if (!workouts.data.active) startSession(routine.days.some((d) => d.weekday_index === today) ? today : null);
  });

  const logExercise = (exercise: PickedExercise, via: Via) => {
    if (!active) {
      toast(tr("workouts.startFirst"));
      return;
    }
    timer.loadExercise(exercise.id, exercise.name).catch(() => {});
    setSheet({ kind: "set", exercise, via });
  };
  useEffect(() => {
    if (!openFirst.current || !active || !upNext) return;
    openFirst.current = false;
    logExercise({ id: upNext.exercise_id, name: upNext.name }, "name");
  });

  const removeSet = async (workoutId: number, s: WorkoutSet) => {
    try {
      await deleteSet(workoutId, s);
      toast(tr("sets.deleted"), { action: { label: tr("common.undo"), onPress: () => void restoreSet(workoutId, s).catch(() => {}) } });
    } catch (e) {
      toast(errorMessage(e) ?? tr("workouts.couldntDeleteSet"));
    }
  };

  const loading = (workouts.isPending || routineQuery.isPending) && !workouts.error;
  const loadError = errorMessage(workouts.error ?? routineQuery.error);

  return (
    <Screen
      title={tr("nav.workouts")}
      subtitle={routine ? `${routine.split} · ${tn("plan.daysPerWeek", routine.days_per_week)}`.toLocaleUpperCase() : undefined}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await Promise.all([workouts.refetch(), routineQuery.refetch()]);
        setRefreshing(false);
      }}
    >
      {loadError && !workouts.data ? (
        <Card>
          <ErrorText message={loadError} />
          <Button
            title={tr("common.tryAgain")}
            kind="soft"
            small
            onPress={async () => {
              await Promise.all([workouts.refetch(), routineQuery.refetch()]);
            }}
            style={{ marginTop: space.md, alignSelf: "flex-start" }}
          />
        </Card>
      ) : null}
      {loading ? (
        <SkeletonCards count={3} />
      ) : workouts.data ? (
        <FadeIn>
          {active ? (
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <Row gap={space.sm}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.good }} />
                  <Txt variant="tiny" style={{ ...typeScale.overline, color: t.goodInk }}>
                    {tr("workouts.inProgress").toLocaleUpperCase()}
                  </Txt>
                </Row>
                <Row gap={6}>
                  <Txt variant="tiny">{tr("workouts.startedAt", { time: timeOf(active.started_at) })}</Txt>
                  <Elapsed since={active.started_at} />
                </Row>
              </Row>
              <Row style={{ marginTop: space.md }}>
                <Stat label={tr("workouts.sets")} value={String(active.set_count)} />
                <Stat label={tr("workouts.volume")} value={u.weight(active.volume_kg, 0)} />
                <Stat label={tr("workouts.exercises")} value={String(new Set(active.sets.map((x) => x.exercise_id)).size)} />
              </Row>
              {gym ? (
                <Row gap={space.sm} style={{ marginTop: space.md }}>
                  <Icon name="location-outline" size={16} color={t.text2} />
                  <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
                    {tr("workouts.atGym", { gym: gym.name })}
                  </Txt>
                  <Button title={tr("common.change")} kind="ghost" small onPress={() => setSheet({ kind: "gym-pick" })} style={{ borderColor: "transparent" }} accessibilityLabel={tr("workouts.changeGymLabel")} />
                </Row>
              ) : null}

              {followed ? (
                <SessionChecklist
                  day={followed}
                  done={done}
                  upNextId={upNext?.exercise_id ?? null}
                  swappedFrom={swappedFrom}
                  onPick={(x) => logExercise(x, "name")}
                  onChange={() => setPlanDay(active.id, null)}
                />
              ) : routine && routine.days.length ? (
                <View style={{ marginTop: space.lg }}>
                  <Txt variant="label">{tr("workouts.followDay")}</Txt>
                  <Txt variant="tiny">{tr("workouts.followDayHint")}</Txt>
                  <Chips<number>
                    value={-1}
                    onChange={(d) => {
                      setPlanDay(active.id, d);
                      openFirst.current = true;
                    }}
                    options={routine.days.map((d) => ({ value: d.weekday_index, label: `${WEEKDAYS_SHORT[d.weekday_index]} · ${d.title}` }))}
                    style={{ marginTop: space.xs }}
                  />
                </View>
              ) : null}

              {followed ? (
                // The plan's exercises are already listed; adding one is the exception, so it stays quiet
                <Row style={{ marginTop: space.md, justifyContent: "center", flexWrap: "wrap" }} gap={space.lg}>
                  <LinkButton title={tr("workouts.addAnother")} onPress={() => setSheet({ kind: "search" })} />
                  <LinkButton title={tr("workouts.scanQr")} onPress={() => setSheet({ kind: "scan" })} />
                  <LinkButton title={tr("workouts.fromPhoto")} onPress={() => setSheet({ kind: "photo" })} />
                </Row>
              ) : (
                <>
                  <Button title={tr("workouts.addExercise")} icon="add" onPress={() => setSheet({ kind: "search" })} style={{ marginTop: space.lg }} />
                  <Row style={{ marginTop: space.sm }}>
                    <Button title={tr("workouts.scanQr")} icon="qr-code" kind="soft" small onPress={() => setSheet({ kind: "scan" })} style={{ flex: 1 }} />
                    <Button title={tr("workouts.fromPhoto")} icon="image" kind="soft" small onPress={() => setSheet({ kind: "photo" })} style={{ flex: 1 }} />
                  </Row>
                </>
              )}
              {sheet?.kind !== "set" ? <RestTimerPanel timer={timer} compact /> : null}
              {active.sets.length ? (
                <View style={{ marginTop: space.lg }}>
                  <SetsList
                    sets={active.sets}
                    onAddSet={(e) => logExercise(e, "name")}
                    onEdit={(s) => setSheet({ kind: "edit-set", workoutId: active.id, set: s, back: null })}
                    onDelete={(s) => removeSet(active.id, s)}
                  />
                </View>
              ) : null}
              <Field
                label={tr("workouts.notes")}
                value={notes}
                onChangeText={(text) => setNotesDraft({ workoutId: active.id, text, base: active.notes ?? "" })}
                placeholder={tr("workouts.notesHint")}
                multiline
              />
              <Button
                title={tr("workouts.finish")}
                icon="checkmark"
                style={{ marginTop: space.lg }}
                onPress={async () => {
                  try {
                    await finishWorkout(active.id, notes);
                  } catch (e) {
                    toast(errorMessage(e) ?? tr("workouts.couldntSave"));
                    return;
                  }
                  clearPlanDay(active.id);
                  timer.dispatch({ type: "skip" });
                  haptics.success();
                  const points = await api<Points>(`/points?tz_offset=${tzOffset()}`).catch(() => null);
                  if (points) queryClient.setQueryData(qk.points, points);
                  const earned = points?.new.reduce((sum, x) => sum + x.points, 0) ?? 0;
                  toast(earned ? tr("workouts.savedPoints", { points: earned }) : tr("workouts.saved"));
                }}
              />
              <Button
                title={tr("workouts.discard")}
                kind="danger"
                small
                style={{ marginTop: space.sm, alignSelf: "center", borderColor: "transparent" }}
                onPress={async () => {
                  if (!(await confirm(tr("workouts.discardTitle"), tr("workouts.discardText"), tr("workouts.discardConfirm")))) return;
                  try {
                    await deleteWorkout(active.id);
                    clearPlanDay(active.id);
                    timer.dispatch({ type: "skip" });
                    toast(tr("workouts.discarded"));
                  } catch (e) {
                    toast(errorMessage(e) ?? tr("workouts.couldntDiscard"));
                  }
                }}
              />
            </Card>
          ) : (
            <Card style={{ padding: space.lg + 2 }}>
              <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
                {tr(todayPlan ? "today.session" : "workouts.restDay").toLocaleUpperCase()}
              </Txt>
              <Txt style={{ ...typeScale.heading, fontSize: 19, lineHeight: 24, marginTop: 2 }}>
                {todayPlan ? todayPlan.title : tr("workouts.nothingPlanned")}
              </Txt>
              <Txt variant="small" style={{ marginTop: space.sm }}>
                {todayPlan
                  ? `${tn("workouts.exerciseCount", todayPlan.exercises.length)}${todayPlan.cardio_minutes ? tr("workouts.plusCardio", { n: todayPlan.cardio_minutes }) : ""}: ${todayPlan.exercises
                      .slice(0, 3)
                      .map((x) => x.name)
                      .join(tr("list.separator"))}${todayPlan.exercises.length > 3 ? "…" : ""}`
                  : tr("workouts.restDayText")}
              </Txt>
              {todayPlan ? (
                <Button title={tr("workouts.startToday")} icon="play" style={{ marginTop: space.lg }} onPress={() => startSession(today)} />
              ) : (
                <Button title={tr("today.start")} icon="play" style={{ marginTop: space.lg }} onPress={() => startSession(null)} />
              )}
            </Card>
          )}

          {routine ? (
            <WeekPlan
              routine={routine}
              openDay={openDay}
              onToggleDay={setOpenDay}
              canLog={!!active}
              onLog={(x) => logExercise(x, "name")}
              onInfo={(x) => setSheet({ kind: "info", exercise: x })}
              onEdit={() => setSheet({ kind: "plan" })}
            />
          ) : null}

          <Section title={tr("workouts.history")} />
          <Card style={{ paddingVertical: history.length ? space.xs : space.lg }}>
            {history.length ? (
              history.map((w, i) => (
                <ListRow
                  key={w.id}
                  first={i === 0}
                  icon="barbell-outline"
                  title={longDateTime(w.started_at)}
                  subtitle={`${tn("workouts.setCount", w.set_count)} · ${u.weight(w.volume_kg, 0)}${w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}`}
                  onPress={() => setSheet({ kind: "history", id: w.id })}
                />
              ))
            ) : (
              <EmptyState icon="barbell-outline" title={tr("workouts.noHistory")} text={tr("workouts.noHistoryText")} />
            )}
          </Card>
          <Card onPress={() => router.push("/qr-stickers")}>
            <Row gap={space.md}>
              <Icon name="qr-code-outline" size={20} color={t.text2} />
              <Txt style={{ flex: 1 }}>{tr("workouts.printQr")}</Txt>
              <Icon name="chevron-forward" size={18} color={t.muted} />
            </Row>
          </Card>
        </FadeIn>
      ) : null}

      <Sheet visible={sheet?.kind === "search"} title={tr("workouts.addExercise")} onClose={() => setSheet(null)}>
        <ExerciseSearch onPick={(e) => logExercise(e, "name")} />
      </Sheet>
      <Sheet visible={sheet?.kind === "scan"} title={tr("workouts.scanTitle")} onClose={() => setSheet(null)}>
        {sheet?.kind === "scan" ? <QrScanner onFound={(e) => logExercise({ id: e.id, name: e.name }, "qr")} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "photo"} title={tr("workouts.photoTitle")} onClose={() => setSheet(null)}>
        {sheet?.kind === "photo" ? (
          <ExercisePhoto onPick={(e) => logExercise(e, "photo")} onSearch={() => setSheet({ kind: "search" })} gymId={active?.gym_id ?? gym?.id ?? null} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "set"} title={sheet?.kind === "set" ? sheet.exercise.name : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "set" && active ? (
          <SetForm
            key={sheet.exercise.id}
            workout={active}
            exercise={sheet.exercise}
            addedVia={sheet.via}
            target={(() => {
              const x = planned.find((p) => p.exercise_id === sheet.exercise.id);
              return x ? { sets: x.sets, reps: x.reps } : null;
            })()}
            next={followed ? nextAfter(sheet.exercise.id) : null}
            onNext={() => {
              const next = nextAfter(sheet.exercise.id);
              if (next) logExercise(next, "name");
            }}
            onInfo={() => setSheet({ kind: "info", exercise: sheet.exercise })}
            onEditSet={(s) => setSheet({ kind: "edit-set", workoutId: active.id, set: s, back: sheet })}
            gym={gym}
            onTaken={() => setSheet({ kind: "taken", exercise: sheet.exercise })}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "info"} title={sheet?.kind === "info" ? sheet.exercise.name : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "info" ? (
          <ExerciseInfo exerciseId={sheet.exercise.id} onUse={active ? (e) => logExercise(e, "name") : undefined} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "plan"} title={tr("home.yourPlan")} onClose={() => setSheet(null)}>
        {sheet?.kind === "plan" && routine ? (
          <ScheduleEditor
            routine={routine}
            onSaved={(saved: Routine, message) => {
              queryClient.setQueryData(qk.routine, saved);
              invalidate(qk.recommendations, ["weekly"]);
              setOpenDay(null);
              toast(message);
              setSheet(null);
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "history"} title={tr("workouts.workout")} onClose={() => setSheet(null)}>
        {sheet?.kind === "history" ? (
          <WorkoutDetail
            workoutId={sheet.id}
            onDeleted={() => setSheet(null)}
            onEditSet={(s) => setSheet({ kind: "edit-set", workoutId: sheet.id, set: s, back: sheet })}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "taken"} title={sheet?.kind === "taken" ? tr("workouts.takenTitle", { name: sheet.exercise.name }) : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "taken" ? (
          <MachineTaken
            exercise={sheet.exercise}
            gym={gym}
            swapsPlan={!!followed && followed.exercises.some((x) => x.exercise_id === sheet.exercise.id)}
            onSwap={(to) => {
              if (active && followed && followed.exercises.some((x) => x.exercise_id === sheet.exercise.id)) {
                swap(active.id, plannedId(sheet.exercise.id), to);
              }
              toast(tr("workouts.instead", { to: to.name, from: sheet.exercise.name }));
              logExercise(to, "name");
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "gym-pick"} title={tr("workouts.whichGym")} onClose={() => setSheet(null)}>
        {sheet?.kind === "gym-pick" && active ? (
          <View>
            <GymPicker
              value={active.gym_id ?? gym?.id ?? null}
              onChange={async (g) => {
                try {
                  await setWorkoutGym(active.id, g.id);
                  setSheet(null);
                  toast(tr("workouts.gymChanged", { gym: g.name }));
                } catch (e) {
                  toast(errorMessage(e) ?? tr("workouts.couldntChangeGym"));
                }
              }}
            />
            <Txt variant="tiny" style={{ marginTop: space.md }}>
              {tr("workouts.gymHint")}
            </Txt>
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "edit-set"} title={tr("workouts.editSet")} onClose={() => setSheet(sheet?.kind === "edit-set" ? sheet.back : null)}>
        {sheet?.kind === "edit-set" ? (
          <SetEditForm
            key={sheet.set.id}
            workoutId={sheet.workoutId}
            set={sheet.set}
            onDone={() => setSheet(sheet.back)}
            onDeleted={(s) => {
              setSheet(sheet.back);
              toast(tr("sets.deleted"), {
                action: { label: tr("common.undo"), onPress: () => void restoreSet(sheet.workoutId, s).catch(() => {}) },
              });
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** The plan day being followed, as a checklist: what's done, and what's next. */
function SessionChecklist({
  day,
  done,
  upNextId,
  swappedFrom,
  onPick,
  onChange,
}: {
  day: RoutineDay;
  done: (exerciseId: number) => number;
  upNextId: number | null;
  /** exercises done instead of a planned one (machine taken): id -> the planned exercise's name */
  swappedFrom: Record<number, string>;
  onPick: (x: PickedExercise) => void;
  onChange: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const finished = day.exercises.filter((x) => done(x.exercise_id) >= x.sets).length;
  return (
    <View style={{ marginTop: space.lg }}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
            {day.custom_name && day.title.includes(" at ") ? tr("today.today").toLocaleUpperCase() : WEEKDAYS_SHORT[day.weekday_index].toLocaleUpperCase()} · {day.title.toLocaleUpperCase()}
          </Txt>
          <Txt variant="small">
            {tr("workouts.exercisesDone", { done: finished, total: day.exercises.length })}
          </Txt>
        </View>
        <Button title={tr("common.change")} kind="ghost" small onPress={onChange} style={{ borderColor: "transparent" }} accessibilityLabel={tr("workouts.followOther")} />
      </Row>
      <View style={{ marginTop: space.sm }}>
        {day.exercises.map((x, i) => {
          const n = done(x.exercise_id);
          const complete = n >= x.sets;
          const next = x.exercise_id === upNextId;
          const icon: IconName = complete ? "checkmark-circle" : n > 0 ? "contrast" : "ellipse-outline";
          return (
            <Pressable
              key={x.exercise_id}
              onPress={() => onPick({ id: x.exercise_id, name: x.name })}
              accessibilityRole="button"
              accessibilityLabel={tr(next ? "workouts.checkLabelNext" : "workouts.checkLabel", { name: x.name, done: n, sets: x.sets })}
              style={({ pressed }) => [
                styles.checkRow,
                {
                  borderTopColor: t.border,
                  borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                  backgroundColor: next ? t.accentSoft : "transparent",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Icon name={icon} size={22} color={complete ? t.good : n > 0 ? t.accent : t.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt
                  style={{ fontWeight: next ? "600" : "400", color: complete ? t.text2 : t.text }}
                  numberOfLines={1}
                >
                  {x.name}
                </Txt>
                <Txt variant="tiny" numberOfLines={1}>
                  {tr("workouts.setsReps", { done: n, sets: x.sets, reps: x.reps })}
                  {swappedFrom[x.exercise_id] ? tr("workouts.insteadOf", { name: swappedFrom[x.exercise_id] }) : ""}
                </Txt>
              </View>
              {next ? <Badge label={tr("workouts.upNext")} tone="info" /> : null}
              <Icon name="chevron-forward" size={18} color={t.muted} />
            </Pressable>
          );
        })}
        {day.cardio_minutes ? (
          <Row gap={space.md} style={[styles.checkRow, { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Icon name="bicycle-outline" size={22} color={t.muted} />
            <Txt variant="small" style={{ flex: 1 }}>
              {tr("workouts.finishCardio", { n: day.cardio_minutes })}
            </Txt>
          </Row>
        ) : null}
      </View>
    </View>
  );
}

/** The week's plan: a strip of days, then each training day's exercises. */
function WeekPlan({
  routine,
  openDay,
  onToggleDay,
  canLog,
  onLog,
  onInfo,
  onEdit,
}: {
  routine: Routine;
  openDay: number | null;
  onToggleDay: (d: number | null) => void;
  canLog: boolean;
  onLog: (x: PickedExercise) => void;
  onInfo: (x: PickedExercise) => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  return (
    <>
      <Section title={tr("workouts.yourWeek")} action={tr("workouts.editPlan")} onAction={onEdit} />
      <Card>
        <WeekStrip routine={routine} />
        <Txt variant="small" style={{ marginTop: space.md }}>
          {tr("workouts.perSession", { count: tn("workouts.exerciseCount", routine.exercises_per_day), min: routine.minutes_per_session })}
        </Txt>
        {routine.warnings.map((w) => (
          <Row key={w} gap={6} style={{ marginTop: space.xs, alignItems: "flex-start" }}>
            <Icon name="warning" size={14} color={t.warnInk} style={{ marginTop: 2 }} />
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
                onPress={() => onToggleDay(open ? -1 : d.weekday_index)}
                accessibilityRole="button"
                aria-expanded={open}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, opacity: pressed ? 0.6 : 1 })}
              >
                <View style={{ width: 40 }}>
                  <Txt variant="tiny" style={{ ...typeScale.overline, color: isToday ? t.accent : t.muted }}>
                    {WEEKDAYS_SHORT[d.weekday_index].toLocaleUpperCase()}
                  </Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontWeight: "600" }} numberOfLines={1}>
                    {d.title}
                  </Txt>
                  <Txt variant="tiny" numberOfLines={1}>
                    {d.custom_exercises ? tr("workouts.ownExercises") : d.custom_name ? `${d.focus_label} · ` : ""}
                    {tn("workouts.exerciseCount", d.exercises.length)}
                    {d.cardio_minutes ? tr("workouts.cardioSuffix", { n: d.cardio_minutes }) : ""}
                  </Txt>
                </View>
                {isToday ? <Badge label={tr("today.today")} tone="info" /> : null}
                <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
              </Pressable>
              {open ? (
                <View style={{ paddingBottom: space.md, paddingStart: 40 + space.md }}>
                  {d.exercises.map((x) => (
                    <Row key={x.exercise_id} gap={space.sm} style={{ minHeight: 44 }}>
                      <Pressable
                        onPress={() => onLog({ id: x.exercise_id, name: x.name })}
                        accessibilityRole="button"
                        accessibilityLabel={tr("workouts.logExercise", { name: x.name })}
                        style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.5 : 1, paddingVertical: space.xs })}
                      >
                        <Txt style={{ color: canLog ? t.accent : t.text }} numberOfLines={2}>
                          {x.name}
                        </Txt>
                        <Txt variant="tiny">
                          {x.sets} × {x.reps}
                        </Txt>
                      </Pressable>
                      <IconButton
                        icon="information-circle-outline"
                        label={tr("workouts.howToLabel", { name: x.name })}
                        onPress={() => onInfo({ id: x.exercise_id, name: x.name })}
                      />
                    </Row>
                  ))}
                  {d.custom_exercises ? <CustomDayNote day={d} /> : null}
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
  );
}

/** A day with the user's own exercises: switch back to the suggested ones. */
function CustomDayNote({ day }: { day: RoutineDay }) {
  const toast = useToast();
  const { t: tr } = useI18n();
  const weekday = WEEKDAYS[day.weekday_index];
  const restore = async () => {
    const ok = await confirm(
      tr("workouts.useSuggestedTitle", { day: weekday }),
      tr("workouts.useSuggestedText", { title: day.title }),
      tr("workouts.useSuggestedConfirm"),
      false,
    );
    if (!ok) return;
    try {
      await removeCustomDay(day.weekday_index);
      toast(tr("workouts.suggestedAgain", { day: weekday }));
    } catch (e) {
      toast(errorMessage(e) ?? tr("workouts.couldntChangeDay"));
    }
  };
  return (
    <View style={{ marginTop: space.sm, gap: space.xs }}>
      <Txt variant="tiny">{tr("workouts.chosenYourself")}</Txt>
      <LinkButton title={tr("workouts.useSuggestedInstead")} onPress={restore} />
    </View>
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
  const { t: tr } = useI18n();
  const today = weekdayIndex();
  const titles = new Map(routine.days.map((d) => [d.weekday_index, d.title]));
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={tr("workouts.trainingDaysLabel", { days: routine.days.map((d) => WEEKDAYS[d.weekday_index]).join(tr("list.separator")) })}>
      {WEEKDAYS_MIN.map((label, d) => {
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
              <Icon name={title ? "barbell" : "remove"} size={14} color={title ? (isToday ? t.inkText : t.accent) : t.muted} />
            </View>
            <Txt variant="tiny" style={{ color: title ? t.text2 : t.muted, fontSize: 10, lineHeight: 12, textAlign: "center" }} numberOfLines={2}>
              {title ?? tr("workouts.rest")}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
});
