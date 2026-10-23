import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useAlternatives, useGymInventory, useGyms, useMachineSetting, usePhotoStatus } from "@/lib/data";
import { cap } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { errorMessage, invalidate, qk, queryClient } from "@/lib/query";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Exercise, Gym, GymScan, GymSession, MachineSetting, PhotoMatchStatus, RoutineDay } from "@/lib/types";

import { Badge, Button, Checkbox, Chips, ErrorText, Field, LinkButton, ListRow, Meter, Row, Skeleton, Txt, useToast } from "./ui";
import type { PickedExercise } from "./WorkoutParts";

const SETTING_FIELDS: { key: keyof Pick<MachineSetting, "seat" | "pins" | "back_pad" | "handle">; label: string; short: string; hint: string }[] = [
  { key: "seat", label: "Seat", short: "Seat", hint: "e.g. 4" },
  { key: "pins", label: "Pins / weight stack", short: "Pins", hint: "e.g. arm at 3" },
  { key: "back_pad", label: "Back pad", short: "Back pad", hint: "e.g. 2" },
  { key: "handle", label: "Handle", short: "Handle", hint: "e.g. wide grip" },
];

// ---------- machine settings ----------

/** How the user sets up this machine at this gym: shown when it's picked, editable in place. */
export function MachineSettingsCard({ gym, exercise }: { gym: Gym | null; exercise: PickedExercise }) {
  const t = useTheme();
  const toast = useToast();
  const setting = useMachineSetting(gym?.id ?? null, exercise.id);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!gym || !setting.data) return null;
  const s = setting.data;
  const parts = SETTING_FIELDS.filter((f) => s[f.key]).map((f) => `${f.short} ${s[f.key]}`);

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      const saved = await api<MachineSetting>(`/gyms/${gym.id}/machines/${exercise.id}`, { method: "PUT", body: editing });
      queryClient.setQueryData(qk.machineSetting(gym.id, exercise.id), saved);
      invalidate(qk.gyms, qk.gymInventory(gym.id));
      setEditing(null);
      haptics.success();
      toast(saved.saved ? "Machine settings saved" : "Machine settings cleared");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (editing) {
    return (
      <View style={[styles.box, { backgroundColor: t.surface2 }]}>
        <Txt variant="label">Your setup at {gym.name}</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.sm }}>
          {SETTING_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={editing[f.key] ?? ""}
              onChangeText={(v) => setEditing({ ...editing, [f.key]: v })}
              placeholder={f.hint}
              maxLength={f.key === "handle" ? 60 : 40}
              style={{ width: "48%", flexGrow: 1 }}
            />
          ))}
        </View>
        <Field label="Notes" value={editing.notes ?? ""} onChangeText={(v) => setEditing({ ...editing, notes: v })} placeholder="e.g. feet high on the platform" maxLength={300} />
        <ErrorText message={error} />
        <Row style={{ marginTop: space.md }}>
          <Button title="Cancel" kind="ghost" small onPress={() => setEditing(null)} style={{ flex: 1 }} />
          <Button title="Save" icon="checkmark" small onPress={save} style={{ flex: 1 }} />
        </Row>
      </View>
    );
  }
  const start = () =>
    setEditing({ seat: s.seat, pins: s.pins, back_pad: s.back_pad, handle: s.handle, notes: s.notes });
  if (!s.saved)
    return (
      <Pressable onPress={start} accessibilityRole="button" style={({ pressed }) => [styles.add, { opacity: pressed ? 0.6 : 1 }]}>
        <Ionicons name="options-outline" size={16} color={t.accent} />
        <Txt variant="label" style={{ color: t.accent }}>
          Save your machine settings (seat, pins…)
        </Txt>
      </Pressable>
    );
  return (
    <Pressable
      onPress={start}
      accessibilityRole="button"
      accessibilityLabel={`Your setup at ${gym.name}: ${parts.join(", ")}${s.notes ? `, ${s.notes}` : ""}. Edit`}
      style={({ pressed }) => [styles.box, { backgroundColor: t.accentSoft, opacity: pressed ? 0.7 : 1 }]}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="tiny" style={{ ...typeScale.overline, color: t.accent }}>
          YOUR SETUP · {gym.name.toUpperCase()}
        </Txt>
        <Ionicons name="create-outline" size={16} color={t.accent} />
      </Row>
      {parts.length ? (
        <Txt style={{ fontWeight: "600", marginTop: 2 }} numberOfLines={2}>
          {parts.join(" · ")}
        </Txt>
      ) : null}
      {s.notes ? <Txt variant="small">{s.notes}</Txt> : null}
    </Pressable>
  );
}

// ---------- machine taken ----------

/**
 * Another exercise for the same muscles. Ones known at this gym come first (done here before, photographed,
 * or seen when the gym was photographed), similar movements before different ones.
 */
export function MachineTaken({
  exercise,
  gym,
  onSwap,
  swapsPlan,
}: {
  exercise: PickedExercise;
  gym: Gym | null;
  onSwap: (to: PickedExercise) => void;
  /** the exercise is part of the session being followed (the swap then shows in its checklist) */
  swapsPlan: boolean;
}) {
  const t = useTheme();
  const alternatives = useAlternatives(exercise.id);
  const inventory = useGymInventory(gym?.id ?? null);
  if (alternatives.isPending)
    return (
      <View style={{ gap: space.sm }}>
        <Skeleton height={52} />
        <Skeleton height={52} />
      </View>
    );
  if (alternatives.error) return <ErrorText message={errorMessage(alternatives.error)} />;
  const known = new Set(inventory.data?.exercise_ids ?? []);
  const list = [...(alternatives.data?.alternatives ?? [])].sort(
    (a, b) => Number(known.has(b.exercise.id)) - Number(known.has(a.exercise.id)) || Number(b.match === "similar") - Number(a.match === "similar"),
  );
  const here = list.filter((a) => known.has(a.exercise.id));
  const elsewhere = list.filter((a) => !known.has(a.exercise.id));
  const row = (a: (typeof list)[number], i: number) => (
    <ListRow
      key={a.exercise.id}
      first={i === 0}
      title={a.exercise.name}
      subtitle={[a.match === "similar" ? "Similar movement" : "Different movement, same muscles", ...a.reasons.slice(0, 1)].join(" · ")}
      onPress={() => {
        haptics.selection();
        onSwap({ id: a.exercise.id, name: a.exercise.name });
      }}
      right={<Badge label={a.match === "similar" ? "Similar" : "Different"} tone={a.match === "similar" ? "good" : "warn"} />}
    />
  );
  return (
    <View>
      <Txt variant="small">
        Someone&apos;s on it? Do one of these instead{swapsPlan ? "; it replaces it in today's checklist for this workout only" : ""}.
      </Txt>
      {here.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">At {gym?.name ?? "this gym"}</Txt>
          {here.map(row)}
        </View>
      ) : null}
      {elsewhere.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">{here.length ? "Other options" : "Options (not yet seen at this gym)"}</Txt>
          {elsewhere.map(row)}
        </View>
      ) : null}
      {!list.length ? (
        <Txt variant="small" style={{ marginTop: space.md, color: t.muted }}>
          No alternatives in the library for this one.
        </Txt>
      ) : null}
    </View>
  );
}

// ---------- which gym ----------

export function GymPicker({ value, onChange }: { value: number | null; onChange: (gym: Gym) => void }) {
  const gyms = useGyms();
  if (!gyms.data) return <Skeleton height={36} width="60%" />;
  return (
    <Chips<number>
      value={value ?? -1}
      onChange={(id) => {
        const g = gyms.data.find((x) => x.id === id);
        if (g) onChange(g);
      }}
      options={gyms.data.map((g) => ({ value: g.id, label: g.name }))}
    />
  );
}

// ---------- photo matching model ----------

/** Whether photos can be matched to earlier ones yet, with the one-time download. */
export function PhotoMatchStatusCard({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  const status = usePhotoStatus();
  const [error, setError] = useState<string | null>(null);
  const s = status.data;
  if (!s) return null;
  if (s.ready)
    return compact ? null : (
      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        <Ionicons name="checkmark-circle" size={16} color={t.good} />
        <Txt variant="small">Photo matching is on: earlier photos are checked first (on this server, in about 0.05 s).</Txt>
      </Row>
    );
  const start = async () => {
    setError(null);
    try {
      queryClient.setQueryData(qk.photoStatus, await api<PhotoMatchStatus>("/photo-memory/download", { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      <Txt variant="label">{s.downloading ? "Getting photo matching ready…" : "Recognise your machines faster"}</Txt>
      <Txt variant="small">
        {s.downloading
          ? `Downloading the photo model: ${Math.round(s.downloaded_mb)} of ${Math.round(s.size_mb)} MB (one time).`
          : `A small model (${Math.round(s.size_mb)} MB, one time) lets the app match a new photo with your earlier ones, so a machine it learned is recognised even if the classifier gets it wrong.`}
      </Txt>
      {s.downloading ? (
        <View style={{ marginTop: space.sm }}>
          <Meter value={s.downloaded_mb} max={s.size_mb} height={4} />
        </View>
      ) : (
        <Button title={`Download (${Math.round(s.size_mb)} MB)`} icon="download-outline" kind="soft" small onPress={start} style={{ marginTop: space.sm, alignSelf: "flex-start" }} />
      )}
      <ErrorText message={error ?? (s.problem && !s.downloading && s.problem.startsWith("Couldn't") ? s.problem : null)} />
    </View>
  );
}

// ---------- photograph a gym ----------

/**
 * A photo of a gym (e.g. a hotel gym): the vision model lists what it sees, the user ticks what's right,
 * and the app builds today's session from only that equipment.
 */
export function GymScanFlow({ gym, onStart }: { gym: Gym; onStart: (day: RoutineDay, gym: Gym) => void }) {
  const t = useTheme();
  const toast = useToast();
  const machinesQuery = useQuery({
    queryKey: ["exercises", "machines"],
    queryFn: async () => (await api<Exercise[]>("/exercises?limit=100")).filter((e) => e.category === "machine"),
  });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<GymScan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [machines, setMachines] = useState<Set<number>>(() => new Set(gym.machines));
  const [equipment, setEquipment] = useState<Set<string>>(() => new Set(gym.equipment));
  const [showAll, setShowAll] = useState(false);
  const [session, setSession] = useState<GymSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choices: Record<string, string> = scan?.equipment_choices ?? {
    dumbbells: "Dumbbells",
    barbell: "Barbell and rack",
    cable_station: "Cable station",
    pull_up_bar: "Pull-up bar",
  };

  const pick = async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    setPhoto(asset.uri);
    setBusy(true);
    setProblem(null);
    try {
      const type = asset.mimeType ?? "image/jpeg";
      const result = await api<GymScan>(`/gyms/${gym.id}/scan`, {
        method: "POST",
        upload: { field: "image", uri: asset.uri, name: `gym.${type.split("/")[1] ?? "jpg"}`, type },
      });
      setScan(result);
      // tick what the model is fairly sure about; the user corrects the rest
      setMachines((m) => new Set([...m, ...result.machines.filter((x) => x.confidence >= 0.5).map((x) => x.exercise.id)]));
      setEquipment((e) => new Set([...e, ...result.equipment.filter((x) => x.confidence >= 0.5).map((x) => x.key)]));
    } catch (e) {
      setProblem(`${errorMessage(e)} Tick what's there yourself instead.`);
      setShowAll(true);
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    setError(null);
    try {
      const body = { machines: [...machines], equipment: [...equipment] };
      await api(`/gyms/${gym.id}/equipment`, { method: "PUT", body });
      invalidate(qk.gyms, qk.gymInventory(gym.id));
      setSession(await api<GymSession>(`/gyms/${gym.id}/session`, { method: "POST", body }));
      haptics.success();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (session)
    return (
      <View>
        <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
          TODAY AT {gym.name.toUpperCase()}
        </Txt>
        <Txt variant="h2" style={{ marginTop: 2 }}>
          {session.day.title}
        </Txt>
        <Txt variant="small" style={{ marginTop: space.xs }}>
          {session.note}
        </Txt>
        <View style={{ marginTop: space.md }}>
          {session.day.exercises.map((x, i) => (
            <ListRow key={x.exercise_id} first={i === 0} title={x.name} subtitle={`${x.sets} × ${x.reps} · ${cap(x.muscle_group)}`} />
          ))}
          {session.day.cardio_minutes ? <Txt variant="small">+ {session.day.cardio_minutes} min cardio</Txt> : null}
        </View>
        <Button title="Start this session" icon="play" onPress={() => onStart(session.day, gym)} style={{ marginTop: space.lg }} />
        <LinkButton title="Change what's there" onPress={() => setSession(null)} />
      </View>
    );

  const detected = new Map(scan?.machines.map((m) => [m.exercise.id, m.confidence]) ?? []);
  const machineList = (machinesQuery.data ?? []).filter((m) => showAll || detected.has(m.id) || machines.has(m.id));
  return (
    <View>
      <Txt variant="small">
        Take or choose a photo of the room. The AI on your PC lists the equipment it sees; tick what&apos;s right and you get today&apos;s session using only that.
      </Txt>
      <Row style={{ marginTop: space.md }} gap={space.md}>
        {photo ? <Image source={{ uri: photo }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: t.surface2 }} accessibilityLabel="Your photo of the gym" /> : null}
        <View style={{ flex: 1 }}>
          {busy ? (
            <Row gap={space.sm}>
              <ActivityIndicator size="small" color={t.muted} />
              <Txt variant="small" style={{ flex: 1 }}>
                Looking at the room… (up to a minute on a PC without a strong graphics card)
              </Txt>
            </Row>
          ) : (
            <Button title={photo ? "Another photo" : "Choose a photo of the gym"} icon="image-outline" kind={photo ? "soft" : "primary"} small={!!photo} onPress={() => pick().catch((e) => setError(errorMessage(e)))} />
          )}
          {scan?.seen ? <Txt variant="tiny" style={{ marginTop: space.xs }}>The AI saw: {scan.seen}</Txt> : null}
        </View>
      </Row>
      {problem ? <ErrorText message={problem} /> : null}

      {scan || problem || gym.machines.length || gym.equipment.length ? (
        <>
          <Txt variant="label" style={{ marginTop: space.lg }}>
            Equipment
          </Txt>
          {Object.entries(choices).map(([key, label]) => (
            <Checkbox
              key={key}
              checked={equipment.has(key)}
              onChange={(on) => setEquipment((e) => (on ? new Set([...e, key]) : new Set([...e].filter((k) => k !== key))))}
              label={scan && scan.equipment.some((x) => x.key === key) ? `${label} (seen)` : label}
            />
          ))}
          <Txt variant="label" style={{ marginTop: space.lg }}>
            Machines
          </Txt>
          {machineList.length ? (
            machineList.map((m) => (
              <Checkbox
                key={m.id}
                checked={machines.has(m.id)}
                onChange={(on) => setMachines((s) => (on ? new Set([...s, m.id]) : new Set([...s].filter((x) => x !== m.id))))}
                label={detected.has(m.id) ? `${m.name} (seen, ${Math.round((detected.get(m.id) ?? 0) * 100)}%)` : m.name}
              />
            ))
          ) : (
            <Txt variant="small" style={{ marginTop: space.xs }}>
              No machines seen.
            </Txt>
          )}
          {!showAll ? <LinkButton title="Show all machines" onPress={() => setShowAll(true)} /> : null}
          <Txt variant="tiny" style={{ marginTop: space.md }}>
            Bodyweight exercises (push-ups, squats, planks…) are always included.
          </Txt>
          <ErrorText message={error} />
          <Button title="Save and plan today" icon="sparkles-outline" onPress={() => build().catch(() => toast("Couldn't build the session"))} style={{ marginTop: space.lg }} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, marginBottom: space.md, gap: 2 },
  add: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space.md, minHeight: 32 },
});
