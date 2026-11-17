import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useAlternatives, useGymInventory, useGyms, useMachineSetting, usePhotoStatus } from "@/lib/data";
import { idLabel } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { trOr } from "@/lib/i18n/current";
import { haptics } from "@/lib/haptics";
import { errorMessage, invalidate, qk, queryClient } from "@/lib/query";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Exercise, Gym, GymScan, GymSession, MachineSetting, PhotoMatchStatus, RoutineDay } from "@/lib/types";

import { Badge, Button, Checkbox, Chips, ErrorText, Field, Icon, LinkButton, ListRow, Meter, Row, Skeleton, Txt, useToast } from "./ui";
import type { PickedExercise } from "./WorkoutParts";

const SETTING_FIELDS: { key: keyof Pick<MachineSetting, "seat" | "pins" | "back_pad" | "handle">; label: MessageKey; short: MessageKey; hint: MessageKey }[] = [
  { key: "seat", label: "setting.seatLong", short: "setting.seat", hint: "setting.seatHint" },
  { key: "pins", label: "setting.pinsLong", short: "setting.pins", hint: "setting.pinsHint" },
  { key: "back_pad", label: "setting.back_padLong", short: "setting.back_pad", hint: "setting.back_padHint" },
  { key: "handle", label: "setting.handleLong", short: "setting.handle", hint: "setting.handleHint" },
];

// ---------- machine settings ----------

/** How the user sets up this machine at this gym: shown when it's picked, editable in place. */
export function MachineSettingsCard({ gym, exercise }: { gym: Gym | null; exercise: PickedExercise }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const setting = useMachineSetting(gym?.id ?? null, exercise.id);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!gym || !setting.data) return null;
  const s = setting.data;
  const parts = SETTING_FIELDS.filter((f) => s[f.key]).map((f) => tr("setting.value", { label: tr(f.short), value: s[f.key] }));

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      const saved = await api<MachineSetting>(`/gyms/${gym.id}/machines/${exercise.id}`, { method: "PUT", body: editing });
      queryClient.setQueryData(qk.machineSetting(gym.id, exercise.id), saved);
      invalidate(qk.gyms, qk.gymInventory(gym.id));
      setEditing(null);
      haptics.success();
      toast(tr(saved.saved ? "setting.saved" : "setting.cleared"));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (editing) {
    return (
      <View style={[styles.box, { backgroundColor: t.surface2 }]}>
        <Txt variant="label">{tr("setting.yourSetup", { gym: gym.name })}</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.sm }}>
          {SETTING_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={tr(f.label)}
              value={editing[f.key] ?? ""}
              onChangeText={(v) => setEditing({ ...editing, [f.key]: v })}
              placeholder={tr(f.hint)}
              maxLength={f.key === "handle" ? 60 : 40}
              style={{ width: "48%", flexGrow: 1 }}
            />
          ))}
        </View>
        <Field label={tr("workouts.notes")} value={editing.notes ?? ""} onChangeText={(v) => setEditing({ ...editing, notes: v })} placeholder={tr("setting.notesPlaceholder")} maxLength={300} />
        <ErrorText message={error} />
        <Row style={{ marginTop: space.md }}>
          <Button title={tr("common.cancel")} kind="ghost" small onPress={() => setEditing(null)} style={{ flex: 1 }} />
          <Button title={tr("common.save")} icon="checkmark" small onPress={save} style={{ flex: 1 }} />
        </Row>
      </View>
    );
  }
  const start = () =>
    setEditing({ seat: s.seat, pins: s.pins, back_pad: s.back_pad, handle: s.handle, notes: s.notes });
  if (!s.saved)
    return (
      <Pressable onPress={start} accessibilityRole="button" style={({ pressed }) => [styles.add, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon name="options-outline" size={16} color={t.accent} />
        <Txt variant="label" style={{ color: t.accent }}>
          {tr("setting.addPrompt")}
        </Txt>
      </Pressable>
    );
  return (
    <Pressable
      onPress={start}
      accessibilityRole="button"
      accessibilityLabel={tr("setting.editLabel", { gym: gym.name, settings: [...parts, s.notes].filter(Boolean).join(tr("list.separator")) })}
      style={({ pressed }) => [styles.box, { backgroundColor: t.accentSoft, opacity: pressed ? 0.7 : 1 }]}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="tiny" style={{ ...typeScale.overline, color: t.accent }}>
          {tr("setting.overline", { gym: gym.name }).toLocaleUpperCase()}
        </Txt>
        <Icon name="create-outline" size={16} color={t.accent} />
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
  const { t: tr } = useI18n();
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
      subtitle={[tr(a.match === "similar" ? "taken.similar" : "taken.different"), ...a.reasons.slice(0, 1)].join(" · ")}
      onPress={() => {
        haptics.selection();
        onSwap({ id: a.exercise.id, name: a.exercise.name });
      }}
      right={<Badge label={tr(a.match === "similar" ? "taken.similarShort" : "taken.differentShort")} tone={a.match === "similar" ? "good" : "warn"} />}
    />
  );
  return (
    <View>
      <Txt variant="small">
        {tr(swapsPlan ? "taken.introPlan" : "taken.intro")}
      </Txt>
      {here.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">{tr("taken.atGym", { gym: gym?.name ?? tr("taken.thisGym") })}</Txt>
          {here.map(row)}
        </View>
      ) : null}
      {elsewhere.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">{tr(here.length ? "taken.other" : "taken.notSeen")}</Txt>
          {elsewhere.map(row)}
        </View>
      ) : null}
      {!list.length ? (
        <Txt variant="small" style={{ marginTop: space.md, color: t.muted }}>
          {tr("taken.none")}
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
  const { t: tr } = useI18n();
  const status = usePhotoStatus();
  const [error, setError] = useState<string | null>(null);
  const s = status.data;
  if (!s) return null;
  if (s.ready)
    return compact ? null : (
      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        <Icon name="checkmark-circle" size={16} color={t.good} />
        <Txt variant="small">{tr("match.ready")}</Txt>
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
      <Txt variant="label">{tr(s.downloading ? "match.preparing" : "match.faster")}</Txt>
      <Txt variant="small">
        {s.downloading
          ? tr("match.downloading", { done: Math.round(s.downloaded_mb), total: Math.round(s.size_mb) })
          : tr("match.explain", { size: Math.round(s.size_mb) })}
      </Txt>
      {s.downloading ? (
        <View style={{ marginTop: space.sm }}>
          <Meter value={s.downloaded_mb} max={s.size_mb} height={4} />
        </View>
      ) : (
        <Button title={tr("match.download", { size: Math.round(s.size_mb) })} icon="download-outline" kind="soft" small onPress={start} style={{ marginTop: space.sm, alignSelf: "flex-start" }} />
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
  const { t: tr } = useI18n();
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
  // the equipment IDs, shown in the app's language (the server's English names for any new ones)
  const choices: Record<string, string> = Object.fromEntries(
    Object.entries(scan?.equipment_choices ?? { dumbbells: "", barbell: "", cable_station: "", pull_up_bar: "" }).map(([key, label]) => [
      key,
      trOr(`equip.${key}`, label || key),
    ]),
  );

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
      setProblem(tr("scan.problem", { error: errorMessage(e) ?? "" }));
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
          {tr("scan.today", { gym: gym.name }).toLocaleUpperCase()}
        </Txt>
        <Txt variant="h2" style={{ marginTop: 2 }}>
          {session.day.title}
        </Txt>
        <Txt variant="small" style={{ marginTop: space.xs }}>
          {session.note}
        </Txt>
        <View style={{ marginTop: space.md }}>
          {session.day.exercises.map((x, i) => (
            <ListRow key={x.exercise_id} first={i === 0} title={x.name} subtitle={`${x.sets} × ${x.reps} · ${idLabel("muscle", x.muscle_group)}`} />
          ))}
          {session.day.cardio_minutes ? <Txt variant="small">{tr("scan.cardio", { n: session.day.cardio_minutes })}</Txt> : null}
        </View>
        <Button title={tr("scan.start")} icon="play" onPress={() => onStart(session.day, gym)} style={{ marginTop: space.lg }} />
        <LinkButton title={tr("scan.change")} onPress={() => setSession(null)} />
      </View>
    );

  const detected = new Map(scan?.machines.map((m) => [m.exercise.id, m.confidence]) ?? []);
  const machineList = (machinesQuery.data ?? []).filter((m) => showAll || detected.has(m.id) || machines.has(m.id));
  return (
    <View>
      <Txt variant="small">
        {tr("scan.intro")}
      </Txt>
      <Row style={{ marginTop: space.md }} gap={space.md}>
        {photo ? <Image source={{ uri: photo }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: t.surface2 }} accessibilityLabel={tr("scan.photoLabel")} /> : null}
        <View style={{ flex: 1 }}>
          {busy ? (
            <Row gap={space.sm}>
              <ActivityIndicator size="small" color={t.muted} />
              <Txt variant="small" style={{ flex: 1 }}>
                {tr("scan.looking")}
              </Txt>
            </Row>
          ) : (
            <Button title={tr(photo ? "scan.another" : "scan.choose")} icon="image-outline" kind={photo ? "soft" : "primary"} small={!!photo} onPress={() => pick().catch((e) => setError(errorMessage(e)))} />
          )}
          {scan?.seen ? <Txt variant="tiny" style={{ marginTop: space.xs }}>{tr("menu.seen", { seen: scan.seen })}</Txt> : null}
        </View>
      </Row>
      {problem ? <ErrorText message={problem} /> : null}

      {scan || problem || gym.machines.length || gym.equipment.length ? (
        <>
          <Txt variant="label" style={{ marginTop: space.lg }}>
            {tr("scan.equipment")}
          </Txt>
          {Object.entries(choices).map(([key, label]) => (
            <Checkbox
              key={key}
              checked={equipment.has(key)}
              onChange={(on) => setEquipment((e) => (on ? new Set([...e, key]) : new Set([...e].filter((k) => k !== key))))}
              label={scan && scan.equipment.some((x) => x.key === key) ? tr("scan.seen", { label }) : label}
            />
          ))}
          <Txt variant="label" style={{ marginTop: space.lg }}>
            {tr("scan.machines")}
          </Txt>
          {machineList.length ? (
            machineList.map((m) => (
              <Checkbox
                key={m.id}
                checked={machines.has(m.id)}
                onChange={(on) => setMachines((s) => (on ? new Set([...s, m.id]) : new Set([...s].filter((x) => x !== m.id))))}
                label={detected.has(m.id) ? tr("scan.seenPercent", { label: m.name, percent: Math.round((detected.get(m.id) ?? 0) * 100) }) : m.name}
              />
            ))
          ) : (
            <Txt variant="small" style={{ marginTop: space.xs }}>
              {tr("scan.noMachines")}
            </Txt>
          )}
          {!showAll ? <LinkButton title={tr("scan.showAll")} onPress={() => setShowAll(true)} /> : null}
          <Txt variant="tiny" style={{ marginTop: space.md }}>
            {tr("scan.bodyweight")}
          </Txt>
          <ErrorText message={error} />
          <Button title={tr("scan.build")} icon="sparkles-outline" onPress={() => build().catch(() => toast(tr("scan.couldntBuild")))} style={{ marginTop: space.lg }} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, marginBottom: space.md, gap: 2 },
  add: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space.md, minHeight: 32 },
});
