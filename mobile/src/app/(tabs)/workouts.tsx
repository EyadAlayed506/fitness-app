import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { Badge, Button, Card, CardHead, Field, LinkButton, ListRow, Row, Screen, Section, Sheet, Txt, useToast } from "@/components/ui";
import { ExerciseSearch, QrScanner, SetForm, SetsList, WorkoutDetail, type PickedExercise } from "@/components/WorkoutParts";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { WEEKDAYS_SHORT, duration, longDateTime, plural, timeOf, units, weekdayIndex } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { Routine, Workout } from "@/lib/types";

type SheetState =
  | { kind: "search" }
  | { kind: "scan" }
  | { kind: "set"; exercise: PickedExercise; via: "name" | "qr" }
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

  const load = useCallback(async () => {
    const [list, r] = await Promise.all([api<Workout[]>("/workouts?limit=15"), api<Routine>("/me/routine")]);
    setRoutine(r);
    setHistory(list.filter((w) => w.ended_at));
    const current = list.find((w) => !w.ended_at);
    const full = current ? await api<Workout>(`/workouts/${current.id}`) : null;
    setActive(full);
    setNotes(full?.notes ?? "");
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const closeSheet = () => {
    setSheet(null);
    load().catch(() => {});
  };
  const logExercise = (exercise: PickedExercise, via: "name" | "qr") => {
    if (!active) {
      toast("Start a workout first, then tap an exercise to log it");
      return;
    }
    setSheet({ kind: "set", exercise, via });
  };

  return (
    <Screen title="Workouts" subtitle={routine ? `${routine.split} · ${routine.days_per_week} days a week` : undefined}>
      {active ? (
        <Card>
          <CardHead title="Workout in progress" right={<Badge label={`Started ${timeOf(active.started_at)}`} tone="info" />} />
          <Txt variant="small">
            {plural(active.set_count, "set")} · {u.weight(active.volume_kg, 0)} volume
          </Txt>
          <Row style={{ marginTop: 12 }}>
            <Button title="Type exercise" icon="search" onPress={() => setSheet({ kind: "search" })} style={{ flex: 1 }} />
            <Button title="Scan QR" icon="qr-code" kind="soft" onPress={() => setSheet({ kind: "scan" })} style={{ flex: 1 }} />
          </Row>
          <View style={{ marginTop: 14 }}>
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
          <Row style={{ marginTop: 14 }}>
            <Button
              title="Discard"
              kind="danger"
              onPress={async () => {
                await api(`/workouts/${active.id}`, { method: "DELETE" });
                await load();
              }}
            />
            <Button
              title="Finish workout"
              style={{ flex: 1 }}
              onPress={async () => {
                await api(`/workouts/${active.id}`, { method: "PATCH", body: { finish: true, notes } });
                toast("Workout saved. Nice work!");
                await load();
              }}
            />
          </Row>
        </Card>
      ) : (
        <Card>
          <Txt variant="small" style={{ textAlign: "center", marginBottom: 12 }}>
            Ready to train? Start a workout and add exercises by name or by scanning the machine’s QR code.
          </Txt>
          <Button
            title="Start workout"
            icon="play"
            onPress={async () => {
              await api("/workouts", { method: "POST", body: {} });
              await load();
            }}
          />
        </Card>
      )}

      <Section title="Your routine" />
      {routine ? (
        <Card>
          <WeekStrip routine={routine} />
          <Txt variant="small" style={{ marginTop: 10 }}>
            {routine.split}: {routine.split_reason}
          </Txt>
          <Txt variant="small" style={{ marginTop: 4, marginBottom: 4 }}>
            {routine.exercises_per_day} exercises per session · {routine.minutes_per_session} min. Change your days in Profile.
          </Txt>
          {routine.days.map((d, i) => {
            const shown = openDay ?? nextTrainingDay(routine);
            const open = shown === d.weekday_index;
            const isToday = d.weekday_index === weekdayIndex();
            return (
            <View key={d.weekday} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: t.border, paddingVertical: 10 }}>
              <Pressable
                onPress={() => setOpenDay(open ? -1 : d.weekday_index)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
              >
                <Row gap={6}>
                  <Txt>
                    <Txt style={{ fontWeight: "700" }}>{d.weekday}</Txt> · {d.title}
                  </Txt>
                  {isToday ? <Badge label="Today" tone="info" /> : null}
                </Row>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
              </Pressable>
              {open ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {d.exercises.map((x, k) => (
                    <Row key={x.exercise_id} gap={6}>
                      <Txt variant="muted" style={{ width: 18 }}>
                        {k + 1}.
                      </Txt>
                      <LinkButton title={x.name} onPress={() => logExercise({ id: x.exercise_id, name: x.name }, "name")} />
                      <Txt variant="tiny">
                        {x.sets} × {x.reps}
                      </Txt>
                    </Row>
                  ))}
                  {d.cardio_minutes ? <Txt variant="muted">+ {d.cardio_minutes} min cardio</Txt> : null}
                </View>
              ) : null}
            </View>
            );
          })}
          <View style={{ marginTop: 6, gap: 3 }}>
            {routine.notes.map((n) => (
              <Txt key={n} variant="small">
                • {n}
              </Txt>
            ))}
          </View>
        </Card>
      ) : null}

      <Section title="History" />
      <Card>
        {history.length ? (
          history.map((w, i) => (
            <ListRow
              key={w.id}
              first={i === 0}
              title={longDateTime(w.started_at)}
              subtitle={`${plural(w.set_count, "set")} · ${u.weight(w.volume_kg, 0)} volume${w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}`}
              onPress={() => setSheet({ kind: "history", id: w.id })}
            />
          ))
        ) : (
          <Txt variant="muted" style={{ textAlign: "center" }}>
            No finished workouts yet.
          </Txt>
        )}
      </Card>
      <Row style={{ justifyContent: "center" }}>
        <LinkButton title="Print QR stickers for the machines" onPress={() => router.push("/qr-stickers")} />
      </Row>

      <Sheet visible={sheet?.kind === "search"} title="Add exercise" onClose={closeSheet}>
        <ExerciseSearch onPick={(e) => setSheet({ kind: "set", exercise: e, via: "name" })} />
      </Sheet>
      <Sheet visible={sheet?.kind === "scan"} title="Scan machine QR code" onClose={closeSheet}>
        {sheet?.kind === "scan" ? (
          <QrScanner onFound={(e) => setSheet({ kind: "set", exercise: { id: e.id, name: e.name }, via: "qr" })} />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "set"} title={sheet?.kind === "set" ? sheet.exercise.name : ""} onClose={closeSheet}>
        {sheet?.kind === "set" && active ? (
          <SetForm workoutId={active.id} exercise={sheet.exercise} addedVia={sheet.via} onSaved={toast} />
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
    <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }} accessibilityLabel={`Training days: ${routine.days.map((d) => d.weekday).join(", ")}`}>
      {WEEKDAYS_SHORT.map((label, d) => {
        const title = titles.get(d);
        const isToday = d === today;
        return (
          <View
            key={label}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: title ? t.accentSoft : t.surface2,
              borderWidth: isToday ? 2 : 0,
              borderColor: t.accent,
            }}
          >
            <Txt variant="tiny" style={{ color: isToday ? t.accent : t.text2, fontWeight: isToday ? "700" : "500" }}>
              {label}
            </Txt>
            <Txt variant="tiny" style={{ color: title ? t.accent : t.muted, fontWeight: "600", textAlign: "center" }} numberOfLines={2}>
              {title ? title.replace("Full body", "Full") : "Rest"}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}
