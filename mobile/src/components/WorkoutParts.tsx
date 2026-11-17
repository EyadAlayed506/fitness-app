import { useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { addSet, deleteSet, deleteWorkout, restoreSet, updateSet, useExerciseHistory, useRoutine } from "@/lib/data";
import { KG_PER_LB, duration, idLabel, longDateTime, shortDate, units } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { tr } from "@/lib/i18n/current";
import { betterBest, bestOf, isNewBest, parseRepRange, suggestNext, type Best } from "@/lib/progression";
import { errorMessage, qk } from "@/lib/query";
import { spokenWeight } from "@/lib/speech";
import { radius, space, useTheme } from "@/lib/theme";
import type { Exercise, ExerciseHistory, Gym, Workout, WorkoutSet } from "@/lib/types";
import type { SpokenSet } from "@/lib/voiceSet";

import { MachineSettingsCard } from "./GymParts";
import { RestTimerPanel } from "./RestTimer";
import { HandsFreeMic, WeightFromPhoto } from "./SetHelpers";
import { useWorkoutSession } from "./WorkoutSession";
import {
  Badge,
  Button,
  Chips,
  EmptyState,
  ErrorText,
  Field,
  Icon,
  IconButton,
  LinkButton,
  ListRow,
  Row,
  Skeleton,
  Stat,
  Stepper,
  Txt,
  useReducedMotion,
  useToast,
} from "./ui";

export type PickedExercise = { id: number; name: string };

/** A weight in kg shown in the chosen unit, rounded to 0.1. */
const inUnit = (kg: number, unit: string) => Math.round((unit === "lb" ? kg / KG_PER_LB : kg) * 10) / 10;
/** The unit as the user reads it ("kg" / "كغ"); the ID itself is what the API gets. */
const unitLabel = (unit: string) => tr(unit === "lb" ? "unit.lb" : "unit.kg");
const weightText = (kg: number, unit: string) => (kg > 0 ? `${inUnit(kg, unit)} ${unitLabel(unit)}` : tr("sets.bodyweight"));
const RPE_CHOICES = [6, 7, 8, 9, 10];

// ---------- list of sets, grouped by exercise ----------

/** Sets grouped by exercise. Numbers follow the order they were done in. Tap a set to edit it. */
export function SetsList({
  sets,
  onAddSet,
  onEdit,
  onDelete,
}: {
  sets: WorkoutSet[];
  onAddSet?: (e: PickedExercise) => void;
  onEdit?: (s: WorkoutSet) => void;
  onDelete?: (s: WorkoutSet) => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { profile } = useProfile();
  const unit = units(profile.unit_system).w;
  const groups: { id: number; name: string; sets: WorkoutSet[] }[] = [];
  for (const s of sets) {
    let g = groups.find((x) => x.id === s.exercise_id);
    if (!g) groups.push((g = { id: s.exercise_id, name: s.exercise_name, sets: [] }));
    g.sets.push(s);
  }
  if (!groups.length) return <Txt variant="small">{tr("sets.none")}</Txt>;
  return (
    <View style={{ gap: space.lg }}>
      {groups.map((g) => (
        <View key={g.id}>
          <Row style={{ justifyContent: "space-between", marginBottom: space.xs }}>
            <Txt style={{ fontWeight: "600", flex: 1 }}>{g.name}</Txt>
            {onAddSet ? (
              <Button
                title={tr("sets.set")}
                icon="add"
                kind="soft"
                small
                onPress={() => onAddSet({ id: g.id, name: g.name })}
                accessibilityLabel={tr("sets.addSetOf", { name: g.name })}
              />
            ) : null}
          </Row>
          {g.sets.map((s, i) => {
            const saving = s.id < 0; // shown straight away, still being saved
            const content = (
              <>
                <View style={[styles.setNumber, { backgroundColor: t.surface2 }]}>
                  <Txt variant="tiny" style={{ color: t.text2, fontWeight: "600" }}>
                    {i + 1}
                  </Txt>
                </View>
                <Txt style={{ flex: 1, fontVariant: ["tabular-nums"] }}>
                  {s.reps} × {weightText(s.weight_kg, unit)}
                  {s.rpe ? <Txt variant="small"> · RPE {s.rpe}</Txt> : null}
                  {s.notes ? <Txt variant="small"> · {s.notes}</Txt> : null}
                </Txt>
                {s.added_via === "qr" ? <Badge label="QR" /> : s.added_via === "photo" ? <Badge label={tr("sets.photo")} /> : null}
                {onEdit && !saving ? <Icon name="create-outline" size={16} color={t.muted} /> : null}
              </>
            );
            return (
              <Row key={s.id} gap={space.md} style={[styles.setRow, { borderTopColor: t.border, opacity: saving ? 0.55 : 1 }]}>
                {onEdit && !saving ? (
                  <Pressable
                    onPress={() => onEdit(s)}
                    accessibilityRole="button"
                    accessibilityLabel={tr("sets.editLabel", { n: i + 1, name: g.name, reps: s.reps, weight: weightText(s.weight_kg, unit) })}
                    style={({ pressed }) => [styles.setEdit, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View style={styles.setEdit}>{content}</View>
                )}
                {onDelete && !saving ? <IconButton icon="close" label={tr("sets.deleteLabel", { n: i + 1, name: g.name })} onPress={() => onDelete(s)} /> : null}
              </Row>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------- find an exercise by name ----------

export function ExerciseSearch({ onPick }: { onPick: (e: PickedExercise) => void }) {
  const { t: tr } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Exercise[]>([]);
  useEffect(() => {
    const id = setTimeout(() => {
      api<Exercise[]>(`/exercises?limit=8&search=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [query]);
  return (
    <View>
      <Field label={tr("search.label")} value={query} onChangeText={setQuery} placeholder={tr("search.placeholder")} autoFocus autoCorrect={false} />
      <View style={{ marginTop: space.sm }}>
        {results.length ? (
          results.map((x, i) => (
            <ListRow
              key={x.id}
              first={i === 0}
              title={x.name}
              subtitle={`${idLabel("muscle", x.muscle_group)} · ${idLabel("category", x.category)}`}
              onPress={() => onPick({ id: x.id, name: x.name })}
            />
          ))
        ) : (
          <EmptyState icon="search" title={tr("search.noMatch")} text={tr("search.noMatchText")} />
        )}
      </View>
    </View>
  );
}

// ---------- scan the QR sticker on a machine ----------

export function QrScanner({ onFound }: { onFound: (e: Exercise) => void }) {
  const t = useTheme();
  const { t: tr, errorText } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const lastFailed = useRef<string | null>(null);

  const lookup = async (text: string) => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      onFound(await api<Exercise>(`/exercises/qr/${encodeURIComponent(text.trim())}`));
    } catch (e) {
      lastFailed.current = text;
      setError(e);
    } finally {
      busy.current = false;
    }
  };

  return (
    <View>
      {permission?.granted ? (
        <View style={{ height: 300, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (data !== lastFailed.current) lookup(data);
            }}
          />
        </View>
      ) : (
        <View style={{ padding: space.lg, borderRadius: radius.lg, backgroundColor: t.surface2, gap: space.md }}>
          <Txt variant="small">
            {permission && !permission.canAskAgain
              ? tr("qr.cameraOff")
              : tr("qr.allowHint")}
          </Txt>
          {!permission || permission.canAskAgain ? <Button title={tr("qr.allow")} icon="camera" onPress={async () => { await requestPermission(); }} /> : null}
        </View>
      )}
      <Txt variant="small" style={{ marginTop: 10 }}>
        {tr("qr.pointOrType")}
      </Txt>
      <Row style={{ alignItems: "flex-end" }}>
        <Field value={code} onChangeText={setCode} placeholder={tr("qr.codePlaceholder")} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, marginTop: 6 }} accessibilityLabel={tr("qr.codeLabel")} onSubmitEditing={() => lookup(code)} />
        <Button title={tr("qr.find")} onPress={() => lookup(code)} style={{ marginTop: 6 }} />
      </Row>
      <ErrorText message={error == null ? null : errorText(error)} />
    </View>
  );
}


// ---------- log a set ----------

export interface SetFormProps {
  /** the workout in progress (from the cache, so sets logged here show at once) */
  workout: Workout;
  exercise: PickedExercise;
  addedVia: "name" | "qr" | "photo";
  /** the plan's target when this exercise is part of the session being followed */
  target?: { sets: number; reps: string } | null;
  /** the next planned exercise, for the "Next" button */
  next?: PickedExercise | null;
  onNext?: () => void;
  /** open the how-to and alternatives */
  onInfo: () => void;
  onEditSet: (s: WorkoutSet) => void;
  /** the gym the workout is at (for machine settings) */
  gym?: Gym | null;
  /** "machine taken": pick another exercise */
  onTaken?: () => void;
}

/** Waits for the exercise's history (usually cached) so the form can start with last time's numbers. */
export function SetForm(props: SetFormProps) {
  const history = useExerciseHistory(props.exercise.id, props.workout.id);
  const routine = useRoutine();
  if (history.isPending)
    return (
      <View style={{ gap: space.md }} accessibilityLabel={tr("common.loading")}>
        <Skeleton height={64} />
        <Skeleton height={56} />
        <Skeleton height={50} />
      </View>
    );
  return <SetFormBody key={props.exercise.id} {...props} history={history.data ?? null} planReps={routine.data?.reps ?? null} />;
}

function SetFormBody({
  workout,
  exercise,
  addedVia,
  target,
  next,
  onNext,
  onInfo,
  onEditSet,
  gym,
  onTaken,
  history,
  planReps,
}: SetFormProps & { history: ExerciseHistory | null; planReps: string | null }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const { profile } = useProfile();
  const { timer, announceAfterRest } = useWorkoutSession();
  const imperial = units(profile.unit_system).imperial;
  const mine = workout.sets.filter((s) => s.exercise_id === exercise.id);
  const lastHere = mine.at(-1) ?? null;
  const lastTime = history?.last ?? null;
  const range = parseRepRange(target?.reps ?? planReps);

  const [unit, setUnit] = useState<string>(imperial ? "lb" : "kg");
  const [reps, setReps] = useState(() => String(lastHere?.reps ?? lastTime?.sets[0]?.reps ?? range?.[0] ?? 10));
  const [weight, setWeight] = useState(() => {
    const kg = lastHere?.weight_kg ?? lastTime?.sets[0]?.weight_kg ?? 0;
    return String(inUnit(kg, imperial ? "lb" : "kg"));
  });
  const [rpe, setRpe] = useState<number | null>(lastHere?.rpe ?? null);
  const [notes, setNotes] = useState("");
  // effort and a note are optional, so they stay folded away (open if an effort is already filled in)
  const [showMore, setShowMore] = useState(rpe != null);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<{ text: string; n: number } | null>(null);
  const [snapWeight, setSnapWeight] = useState(false);

  const suggestion = lastTime
    ? suggestNext(
        lastTime.sets.map((s) => ({ reps: s.reps, weight: inUnit(s.weight_kg, unit) })),
        range,
        unit === "lb",
      )
    : null;

  const save = async (values: { reps: number; weight: number; unit: string; rpe: number | null; notes: string }): Promise<WorkoutSet | null> => {
    setError(null);
    // the best so far: from earlier workouts, and from this one
    const before: Best | null = mine.reduce<Best | null>((b, s) => betterBest(b, bestOf(s.weight_kg, s.reps)), history?.best ?? null);
    timer.dispatch({ type: "start", now: Date.now() }); // the rest starts as soon as the set is logged
    announceAfterRest(null); // only a spoken set is answered out loud (saveSpoken sets the next one)
    haptics.success();
    try {
      const saved = await addSet(workout.id, { exercise_id: exercise.id, exercise_name: exercise.name, added_via: addedVia, ...values });
      const label = `${weightText(saved.weight_kg, values.unit)} × ${saved.reps}`;
      const undo = { label: tr("common.undo"), onPress: () => void deleteSet(workout.id, saved).catch(() => {}) };
      if (isNewBest(saved, before)) {
        setRecord((r) => ({ text: tr("sets.newBest", { set: label }), n: (r?.n ?? 0) + 1 }));
        toast(tr("sets.newBest", { set: label }), { action: undo });
      } else {
        toast(tr("sets.saved", { set: label }), { action: undo });
      }
      setNotes("");
      return saved;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  };
  const fromForm = () => ({
    reps: Math.max(0, Math.round(Number(reps.replace(",", ".")) || 0)),
    weight: Math.max(0, Number(weight.replace(",", ".")) || 0),
    unit,
    rpe,
    notes: notes.trim(),
  });
  const sameAsLast = () => {
    if (!lastHere) return;
    setReps(String(lastHere.reps));
    setWeight(String(inUnit(lastHere.weight_kg, unit)));
    setRpe(lastHere.rpe);
    return save({ reps: lastHere.reps, weight: inUnit(lastHere.weight_kg, unit), unit, rpe: lastHere.rpe, notes: "" });
  };
  const targetDone = target ? mine.length >= target.sets : false;

  /** Hands-free: a spoken set is saved like a tapped one; the reply and the next set are said out loud. */
  const saveSpoken = async (spoken: SpokenSet): Promise<{ said: string } | { error: string }> => {
    let values: { reps: number; weight: number; unit: string } | null;
    if (spoken.kind === "same") {
      if (!lastHere) return { error: "There's no set to repeat yet. Say one like “8 reps at 60”." };
      values = { reps: lastHere.reps, weight: inUnit(lastHere.weight_kg, unit), unit };
    } else {
      const spokenUnit = spoken.unit ?? unit;
      const formWeight = Number(weight.replace(",", ".")) || 0;
      // no weight said: keep the one in the form ("12 reps")
      const w = spoken.weight ?? (spokenUnit === unit ? formWeight : inUnit(unit === "lb" ? formWeight * KG_PER_LB : formWeight, spokenUnit));
      values = { reps: spoken.reps, weight: w, unit: spokenUnit };
    }
    if (values.reps <= 0 || values.reps > 200) return { error: "That doesn't sound like a number of reps. Try again." };
    setReps(String(values.reps));
    setUnit(values.unit);
    setWeight(String(values.weight));
    const saved = await save({ ...values, rpe, notes: "" });
    if (!saved) return { error: "Couldn't save the set. Check the connection to your PC." };
    const done = mine.length + 1;
    const said = `Saved: ${values.reps} reps at ${spokenWeight(values.weight, values.unit)}.`;
    announceAfterRest(
      target && done >= target.sets
        ? next
          ? `Next: ${next.name}.`
          : `That's all ${target.sets} sets of ${exercise.name}.`
        : `Next: set ${done + 1}${target ? ` of ${target.sets}` : ""}, ${values.reps} reps at ${spokenWeight(values.weight, values.unit)}.`,
    );
    return { said };
  };

  return (
    <View>
      <Row style={{ justifyContent: "space-between", marginBottom: space.md, flexWrap: "wrap" }} gap={space.sm}>
        <Row gap={space.lg} style={{ flexWrap: "wrap" }}>
          <LinkButton title={tr("sets.howTo")} onPress={onInfo} />
          {onTaken ? <LinkButton title={tr("sets.taken")} onPress={onTaken} /> : null}
        </Row>
        {target ? (
          <Txt variant="small" style={{ color: targetDone ? t.goodInk : t.text2, fontWeight: "600" }}>
            {targetDone ? tr("sets.allDone", { n: target.sets }) : tr("sets.progress", { n: mine.length + 1, total: target.sets, reps: target.reps })}
          </Txt>
        ) : null}
      </Row>
      <MachineSettingsCard gym={gym ?? null} exercise={exercise} />

      {record ? <RecordBanner key={record.n} text={record.text} /> : null}

      {lastTime ? (
        <View style={[styles.lastTime, { backgroundColor: t.surface2 }]}>
          <Txt variant="small" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={2}>
            {tr("sets.lastTime", { date: shortDate(lastTime.started_at.slice(0, 10)) })}
            <Txt variant="small" style={{ color: t.text }}>
              {lastSessionText(lastTime.sets, unit)}
            </Txt>
          </Txt>
          {suggestion ? (
            <Row gap={space.sm} style={{ marginTop: 4 }}>
              <Icon name={suggestion.kind === "weight" ? "trending-up" : "add-circle-outline"} size={16} color={t.goodInk} />
              <Txt variant="small" style={{ flex: 1, fontWeight: "600", color: t.text }} numberOfLines={1}>
                {tr("sets.try", { set: `${suggestion.weight > 0 ? `${suggestion.weight} ${unitLabel(unit)}` : tr("sets.bodyweight")} × ${suggestion.reps}` })}
              </Txt>
              <LinkButton
                title={tr("sets.use")}
                onPress={() => {
                  setReps(String(suggestion.reps));
                  setWeight(String(suggestion.weight));
                  haptics.selection();
                }}
              />
            </Row>
          ) : null}
        </View>
      ) : (
        <Txt variant="small" style={{ marginBottom: space.xs }}>
          {addedVia === "qr" ? tr("sets.foundQr") : addedVia === "photo" ? tr("sets.fromPhoto") : ""}
          {tr("sets.firstTime", { range: range ? `${range[0]}–${range[1]}` : "10" })}
        </Txt>
      )}

      <Row gap={space.md} style={{ alignItems: "flex-start" }}>
        <Stepper label={tr("sets.reps")} value={reps} onChange={setReps} step={1} min={0} max={200} decimals={0} compact style={{ flex: 1 }} />
        <Stepper
          label={tr("profile.weight")}
          value={weight}
          onChange={setWeight}
          step={unit === "lb" ? 5 : 2.5}
          min={0}
          max={1000}
          suffix={unitLabel(unit)}
          compact
          style={{ flex: 1.15 }}
        />
      </Row>
      <Row style={{ marginTop: space.sm, flexWrap: "wrap" }} gap={space.lg}>
        <LinkButton
          title={tr(unit === "kg" ? "sets.useLb" : "sets.useKg")}
          onPress={() => {
            // keep the same weight, shown in the other unit
            const u = unit === "kg" ? "lb" : "kg";
            const n = Number(weight.replace(",", ".")) || 0;
            setWeight(String(Math.round((u === "lb" ? n / KG_PER_LB : n * KG_PER_LB) * 10) / 10));
            setUnit(u);
          }}
        />
        {!snapWeight ? <LinkButton title={tr("sets.weightFromPhoto")} onPress={() => setSnapWeight(true)} /> : null}
        {!showMore ? <LinkButton title={tr("sets.effortOrNote")} onPress={() => setShowMore(true)} /> : null}
      </Row>
      {snapWeight ? (
        <WeightFromPhoto
          onClose={() => setSnapWeight(false)}
          onUse={(w, u) => {
            if (u && u !== unit) setUnit(u);
            setWeight(String(w));
            setSnapWeight(false);
          }}
        />
      ) : null}
      {showMore ? (
        <>
          <Chips<number>
            label={tr("sets.effort")}
            value={rpe ?? 0}
            onChange={(v) => setRpe(v === 0 ? null : v)}
            options={[
              { value: 0, label: "–" },
              ...[...new Set([...RPE_CHOICES, ...(rpe && !RPE_CHOICES.includes(rpe) ? [rpe] : [])])]
                .sort((a, b) => a - b)
                .map((v) => ({ value: v, label: String(v) })),
            ]}
          />
          <Field label={tr("sets.noteOptional")} value={notes} onChangeText={setNotes} placeholder={tr("sets.notePlaceholder")} />
        </>
      ) : null}
      <ErrorText message={error} />

      <Button
        title={tr("sets.add", { n: mine.length + 1 })}
        icon="checkmark"
        kind={targetDone && next ? "soft" : "primary"}
        onPress={async () => {
          await save(fromForm());
        }}
        style={{ marginTop: space.md }}
      />
      <RestTimerPanel timer={timer} />
      {lastHere || (next && onNext) ? (
        <Row style={{ marginTop: space.sm, flexWrap: "wrap" }} gap={space.sm}>
          {lastHere ? (
            <Button
              title={tr("sets.same", { set: `${lastHere.reps} × ${weightText(lastHere.weight_kg, unit)}` })}
              icon="copy-outline"
              kind="soft"
              small
              onPress={async () => {
                await sameAsLast();
              }}
              style={{ flexGrow: 1 }}
            />
          ) : null}
          {next && onNext ? (
            <Button
              title={tr("sets.next", { name: next.name })}
              icon="arrow-forward"
              kind={targetDone ? "primary" : "ghost"}
              small
              onPress={onNext}
              style={{ flexGrow: 1 }}
            />
          ) : null}
        </Row>
      ) : null}
      <HandsFreeMic onSet={saveSpoken} />

      {mine.length ? (
        <View style={{ marginTop: space.xl }}>
          <Txt variant="label" style={{ marginBottom: space.sm }}>
            {tr("sets.thisWorkout")}
          </Txt>
          <SetsList
            sets={mine}
            onEdit={onEditSet}
            onDelete={async (s) => {
              try {
                await deleteSet(workout.id, s);
                toast(tr("sets.deleted"), {
                  action: { label: tr("common.undo"), onPress: () => void restoreSet(workout.id, s).catch(() => {}) },
                });
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function lastSessionText(sets: { reps: number; weight_kg: number }[], unit: string): string {
  // "100 kg × 12, 12, 11" when the weight stayed the same; otherwise each set
  const weights = new Set(sets.map((s) => s.weight_kg));
  if (weights.size === 1) return `${weightText(sets[0].weight_kg, unit)} × ${sets.map((s) => s.reps).join(", ")}`;
  return sets.map((s) => `${weightText(s.weight_kg, unit)} × ${s.reps}`).join(" · ");
}

/** "New best: 105 kg × 8", with a small pop (none with reduce motion). */
function RecordBanner({ text }: { text: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(0.9));
  useEffect(() => {
    if (reduced) scale.setValue(1);
    else Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: Platform.OS !== "web" }).start();
  }, [reduced, scale]);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.record, { backgroundColor: t.warnSoft, transform: [{ scale }] }]}
    >
      <Icon name="trophy" size={20} color={t.warnInk} />
      <Txt style={{ fontWeight: "700", color: t.warnInk, flex: 1 }}>{text}</Txt>
    </Animated.View>
  );
}

// ---------- edit a logged set ----------

export function SetEditForm({
  workoutId,
  set,
  onDone,
  onDeleted,
}: {
  workoutId: number;
  set: WorkoutSet;
  onDone: () => void;
  onDeleted: (s: WorkoutSet) => void;
}) {
  const toast = useToast();
  const { t: tr } = useI18n();
  const { profile } = useProfile();
  const imperial = units(profile.unit_system).imperial;
  const [unit, setUnit] = useState<string>(imperial ? "lb" : "kg");
  const [reps, setReps] = useState(String(set.reps));
  const [weight, setWeight] = useState(String(inUnit(set.weight_kg, imperial ? "lb" : "kg")));
  const [rpe, setRpe] = useState<number | null>(set.rpe);
  const [notes, setNotes] = useState(set.notes);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await updateSet(workoutId, set, {
        reps: Math.max(0, Math.round(Number(reps.replace(",", ".")) || 0)),
        weight: Math.max(0, Number(weight.replace(",", ".")) || 0),
        unit,
        rpe,
        notes: notes.trim(),
      });
      haptics.success();
      toast(tr("sets.updated"));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await deleteSet(workoutId, set);
      onDeleted(set);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View>
      <Row gap={space.md} style={{ alignItems: "flex-start" }}>
        <Stepper label={tr("sets.reps")} value={reps} onChange={setReps} step={1} min={0} max={200} decimals={0} style={{ flex: 1 }} />
        <Stepper
          label={tr("profile.weight")}
          value={weight}
          onChange={setWeight}
          step={unit === "lb" ? 5 : 2.5}
          suffix={unitLabel(unit)}
          max={1000}
          style={{ flex: 1.15 }}
        />
      </Row>
      <Chips
        value={unit}
        onChange={(u) => {
          const n = Number(weight.replace(",", ".")) || 0;
          setWeight(String(Math.round((u === "lb" ? n / KG_PER_LB : n * KG_PER_LB) * 10) / 10));
          setUnit(u);
        }}
        options={[
          { value: "kg", label: tr("unit.kg") },
          { value: "lb", label: tr("unit.lb") },
        ]}
        style={{ marginTop: space.sm }}
      />
      <Chips<number>
        label={tr("sets.effort")}
        value={rpe ?? 0}
        onChange={(v) => setRpe(v === 0 ? null : v)}
        options={[
          { value: 0, label: "–" },
          ...[...new Set([...RPE_CHOICES, ...(rpe && !RPE_CHOICES.includes(rpe) ? [rpe] : [])])]
            .sort((a, b) => a - b)
            .map((v) => ({ value: v, label: String(v) })),
        ]}
      />
      <Field label={tr("sets.note")} value={notes} onChangeText={setNotes} placeholder={tr("sets.notePlaceholder")} />
      <ErrorText message={error} />
      <Button title={tr("profile.saveChanges")} icon="checkmark" onPress={save} style={{ marginTop: space.lg }} />
      <Button title={tr("sets.delete")} icon="trash-outline" kind="danger" onPress={remove} style={{ marginTop: space.sm, borderColor: "transparent" }} />
    </View>
  );
}

// ---------- a finished workout ----------

export function WorkoutDetail({
  workoutId,
  onDeleted,
  onEditSet,
}: {
  workoutId: number;
  onDeleted: () => void;
  onEditSet: (s: WorkoutSet) => void;
}) {
  const { profile } = useProfile();
  const { t: tr } = useI18n();
  const u = units(profile.unit_system);
  const toast = useToast();
  const { data: w, error } = useQuery({ queryKey: qk.workout(workoutId), queryFn: () => api<Workout>(`/workouts/${workoutId}`) });
  if (!w && error) return <ErrorText message={errorMessage(error)} />;
  if (!w)
    return (
      <View style={{ gap: space.md }} accessibilityLabel={tr("workouts.loading")}>
        <Skeleton width="60%" />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </View>
    );
  return (
    <View>
      <Txt variant="small">{longDateTime(w.started_at)}</Txt>
      <Row style={{ marginTop: space.md }}>
        <Stat label={tr("workouts.sets")} value={String(w.set_count)} />
        <Stat label={tr("workouts.volume")} value={u.weight(w.volume_kg, 0)} />
        {w.ended_at ? <Stat label={tr("workouts.duration")} value={duration(w.started_at, w.ended_at)} /> : null}
      </Row>
      {w.notes ? <Txt style={{ marginTop: space.md }}>{w.notes}</Txt> : null}
      <View style={{ marginTop: space.lg }}>
        <SetsList sets={w.sets} onEdit={onEditSet} />
      </View>
      <Button
        title={tr("workouts.delete")}
        kind="danger"
        icon="trash-outline"
        style={{ marginTop: space.xl }}
        onPress={async () => {
          if (!(await confirm(tr("workouts.deleteTitle"), tr("workouts.deleteText"), tr("settings.deleteConfirm")))) return;
          await deleteWorkout(w.id);
          toast(tr("workouts.deleted"));
          onDeleted();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  setNumber: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  setRow: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth },
  setEdit: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 },
  lastTime: { borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, marginBottom: space.xs },
  record: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
});
