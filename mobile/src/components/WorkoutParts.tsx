import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { cap, duration, longDateTime, plural, round, units } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { Exercise, Workout, WorkoutSet } from "@/lib/types";

import { RestTimerPanel, type RestTimer } from "./RestTimer";
import { Badge, Button, Chips, ErrorText, Field, IconButton, LinkButton, ListRow, Row, Txt } from "./ui";

export type PickedExercise = { id: number; name: string };

// ---------- list of sets, grouped by exercise ----------

export function SetsList({
  sets,
  onAddSet,
  onDelete,
}: {
  sets: WorkoutSet[];
  onAddSet?: (e: PickedExercise) => void;
  onDelete?: (s: WorkoutSet) => void;
}) {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const groups: { id: number; name: string; sets: WorkoutSet[] }[] = [];
  for (const s of sets) {
    let g = groups.find((x) => x.id === s.exercise_id);
    if (!g) groups.push((g = { id: s.exercise_id, name: s.exercise_name, sets: [] }));
    g.sets.push(s);
  }
  if (!groups.length) return <Txt variant="muted">No sets yet.</Txt>;
  return (
    <View style={{ gap: 10 }}>
      {groups.map((g) => (
        <View key={g.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt style={{ fontWeight: "700", flex: 1 }}>{g.name}</Txt>
            {onAddSet ? <Button title="+ Set" kind="soft" small onPress={() => onAddSet({ id: g.id, name: g.name })} /> : null}
          </Row>
          {g.sets.map((s) => (
            <Row key={s.id} style={{ paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.border, marginTop: 4 }}>
              <Txt variant="tiny" style={{ width: 18 }}>
                {s.set_number}
              </Txt>
              <Txt style={{ flex: 1 }}>
                {s.reps} reps × {u.weight(s.weight_kg)}
                {s.rpe ? ` · RPE ${s.rpe}` : ""}
                {s.notes ? <Txt variant="muted"> · {s.notes}</Txt> : null}
              </Txt>
              {s.added_via === "qr" ? <Badge label="QR" /> : null}
              {onDelete ? <IconButton icon="close" label="Delete set" onPress={() => onDelete(s)} /> : null}
            </Row>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------- find an exercise by name ----------

export function ExerciseSearch({ onPick }: { onPick: (e: PickedExercise) => void }) {
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
      <Field label="Machine or exercise name" value={query} onChangeText={setQuery} placeholder="e.g. lat pulldown" autoFocus autoCorrect={false} />
      <View style={{ marginTop: 8 }}>
        {results.length ? (
          results.map((x, i) => (
            <ListRow
              key={x.id}
              first={i === 0}
              title={x.name}
              subtitle={`${cap(x.muscle_group)} · ${x.category}`}
              onPress={() => onPick({ id: x.id, name: x.name })}
            />
          ))
        ) : (
          <Txt variant="muted">No match. Try another name, e.g. “chest press”.</Txt>
        )}
      </View>
    </View>
  );
}

// ---------- scan the QR sticker on a machine ----------

export function QrScanner({ onFound }: { onFound: (e: Exercise) => void }) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const lastFailed = useRef<string | null>(null);

  const lookup = async (text: string) => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      onFound(await api<Exercise>(`/exercises/qr/${encodeURIComponent(text.trim())}`));
    } catch (e) {
      lastFailed.current = text;
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  };

  return (
    <View>
      {permission?.granted ? (
        <View style={{ height: 300, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
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
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: t.surface2, gap: 10 }}>
          <Txt variant="small">
            {permission && !permission.canAskAgain
              ? "Camera access is turned off for this app. Allow it in your phone's settings, or type the code below."
              : "Allow the camera to scan the QR sticker on the machine."}
          </Txt>
          {!permission || permission.canAskAgain ? <Button title="Allow camera" icon="camera" onPress={async () => { await requestPermission(); }} /> : null}
        </View>
      )}
      <Txt variant="small" style={{ marginTop: 10 }}>
        Point the camera at the sticker, or type the code printed under it:
      </Txt>
      <Row>
        <Field value={code} onChangeText={setCode} placeholder="e.g. leg-press" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, marginTop: 6 }} accessibilityLabel="Machine code" onSubmitEditing={() => lookup(code)} />
        <Button title="Find" onPress={() => lookup(code)} style={{ marginTop: 6 }} />
      </Row>
      <ErrorText message={error} />
    </View>
  );
}

// ---------- log a set ----------

export function SetForm({
  workoutId,
  exercise,
  addedVia,
  timer,
  onSaved,
  onInfo,
}: {
  workoutId: number;
  exercise: PickedExercise;
  addedVia: "name" | "qr";
  /** The workout screen's single rest timer: it starts by itself after each saved set. */
  timer: RestTimer;
  onSaved: (msg: string) => void;
  /** Open the how-to and alternatives for this exercise. */
  onInfo: () => void;
}) {
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [previous, setPrevious] = useState<WorkoutSet[]>([]);
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<string>(u.w);
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Show this exercise's earlier sets and pre-fill the form from the last one
  const applyPrevious = useCallback(
    (w: Workout) => {
      const mine = w.sets.filter((s) => s.exercise_id === exercise.id);
      setPrevious(mine);
      const last = mine.at(-1);
      if (last) {
        setReps(String(last.reps));
        setWeight(String(round(units(profile.unit_system).fromKg(last.weight_kg), 1)));
        setRpe(last.rpe ? String(last.rpe) : "");
      }
    },
    [exercise.id, profile.unit_system],
  );
  useEffect(() => {
    api<Workout>(`/workouts/${workoutId}`).then(applyPrevious).catch(() => {});
  }, [workoutId, applyPrevious]);

  const save = async () => {
    setError(null);
    try {
      await api(`/workouts/${workoutId}/sets`, {
        method: "POST",
        body: {
          exercise_id: exercise.id,
          reps: Number(reps) || 0,
          weight: Number(weight.replace(",", ".")) || 0,
          unit,
          rpe: rpe ? Number(rpe) : null,
          notes,
          added_via: addedVia,
        },
      });
      setNotes("");
      timer.dispatch({ type: "start", now: Date.now() });
      onSaved(`Set saved: ${reps} × ${weight || 0} ${unit}`);
      applyPrevious(await api<Workout>(`/workouts/${workoutId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View>
      <View style={{ marginBottom: 10 }}>
        <LinkButton title="How to do it · alternatives" onPress={onInfo} />
      </View>
      <RestTimerPanel timer={timer} />
      <View style={{ height: 12 }} />
      {previous.length ? (
        <>
          <Txt variant="small" style={{ marginBottom: 4 }}>
            This workout
          </Txt>
          <SetsList sets={previous} />
        </>
      ) : (
        <Txt variant="small">{addedVia === "qr" ? "Found by QR code. " : ""}Log your first set.</Txt>
      )}
      <Row>
        <Field label="Reps" value={reps} onChangeText={setReps} keyboardType="number-pad" style={{ flex: 1 }} />
        <Field label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
      </Row>
      <Chips value={unit} onChange={setUnit} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
      <Field label="RPE 1–10 (optional)" value={rpe} onChangeText={setRpe} keyboardType="decimal-pad" />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="e.g. seat at 4, felt easy" />
      <ErrorText message={error} />
      <Button title={`Add set ${previous.length + 1}`} onPress={save} style={{ marginTop: 14 }} />
    </View>
  );
}

// ---------- a finished workout ----------

export function WorkoutDetail({ workoutId, onDeleted }: { workoutId: number; onDeleted: () => void }) {
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [w, setW] = useState<Workout | null>(null);
  useEffect(() => {
    api<Workout>(`/workouts/${workoutId}`).then(setW).catch(() => {});
  }, [workoutId]);
  if (!w) return <Txt variant="muted">Loading…</Txt>;
  return (
    <View>
      <Txt variant="small">
        {longDateTime(w.started_at)} · {plural(w.set_count, "set")} · {u.weight(w.volume_kg, 0)} volume
        {w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}
      </Txt>
      {w.notes ? <Txt style={{ marginTop: 8 }}>{w.notes}</Txt> : null}
      <View style={{ marginTop: 12 }}>
        <SetsList sets={w.sets} />
      </View>
      <Button
        title="Delete workout"
        kind="danger"
        style={{ marginTop: 16 }}
        onPress={async () => {
          await api(`/workouts/${w.id}`, { method: "DELETE" });
          onDeleted();
        }}
      />
    </View>
  );
}
