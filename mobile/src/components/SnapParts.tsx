import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import { logMenuDish, removeCustomDay, saveCustomDay } from "@/lib/data";
import { WEEKDAYS, WEEKDAYS_SHORT, cap, fmt, shortDate, todayISO, tzOffset, weekdayIndex } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { choosePhoto, sendPhoto, type Photo } from "@/lib/photo";
import { errorMessage } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { FoodLogEntry, Meal, MenuDish, MenuScan, Routine, RoutineDay, ScreenshotRoutine } from "@/lib/types";

import { MEALS } from "./FoodParts";
import { MacroText } from "./MacroBars";
import { Badge, Button, Chips, ErrorText, Field, IconButton, LinkButton, Row, Stepper, Txt, useToast } from "./ui";
import { ExerciseSearch } from "./WorkoutParts";

/** Snap and say: a workout from a screenshot, and the menu scanner. */

// ---------- screenshot to routine ----------

interface ImportItem {
  key: number;
  /** as written in the screenshot */
  text: string;
  exercise: { id: number; name: string; muscle_group: string } | null;
  sets: string;
  reps: string;
  confidence: number;
}

/** Today if it's a training day, otherwise the next one. */
function nextTrainingDay(days: number[]): number | null {
  const today = weekdayIndex();
  for (let k = 0; k < 7; k++) if (days.includes((today + k) % 7)) return (today + k) % 7;
  return null;
}

/**
 * A workout from a screenshot (Instagram, TikTok, a coach's PDF): the AI on the PC reads the exercises,
 * sets and reps; the user checks them, then starts it now or saves it as a day of their plan.
 */
export function ScreenshotImport({
  routine,
  onStart,
  onSaved,
}: {
  routine: Routine;
  onStart: (day: RoutineDay) => Promise<void>;
  onSaved: (weekday: number) => void;
}) {
  const t = useTheme();
  const toast = useToast();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [read, setRead] = useState<ScreenshotRoutine | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [title, setTitle] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekday, setWeekday] = useState<number | null>(() => nextTrainingDay(routine.training_days));

  const choose = async () => {
    setError(null);
    try {
      const p = await choosePhoto("library");
      if (!p) return;
      setPhoto(p);
      setRead(null);
      const r = await sendPhoto<ScreenshotRoutine>("/snap/workout-screenshot", p);
      setRead(r);
      setTitle(r.title || "Imported workout");
      setItems(
        r.items.map((x, i) => ({
          key: i,
          text: x.text,
          exercise: x.exercise ? { id: x.exercise.id, name: x.exercise.name, muscle_group: x.exercise.muscle_group } : null,
          sets: String(x.sets),
          reps: x.reps,
          confidence: x.confidence,
        })),
      );
      setPicking(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const update = (key: number, change: Partial<ImportItem>) =>
    setItems((list) => list.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const unmatched = items.filter((x) => !x.exercise).length;
  const ready = items.length > 0 && unmatched === 0;
  const exercises = () =>
    items.map((x) => ({
      exercise_id: x.exercise!.id,
      sets: Math.min(10, Math.max(1, Math.round(Number(x.sets) || 3))),
      reps: x.reps.trim().slice(0, 12) || routine.reps,
    }));

  const start = async () => {
    const today = weekdayIndex();
    const list = exercises();
    await onStart({
      weekday: WEEKDAYS[today],
      weekday_index: today,
      title: title.trim() || "Imported workout",
      focus: "custom",
      focus_label: "Your own",
      recommended_focus: "",
      custom_name: true,
      custom_exercises: true,
      cardio_minutes: 0,
      exercises: list.map((x, i) => ({
        ...x,
        name: items[i].exercise!.name,
        muscle_group: items[i].exercise!.muscle_group,
        rest_seconds: routine.reps === "10-15" ? 60 : 90,
      })),
    });
  };

  const save = async () => {
    if (weekday == null) return;
    setError(null);
    const before = routine.days.find((d) => d.weekday_index === weekday);
    try {
      await saveCustomDay(weekday, { title: title.trim() || "Imported workout", exercises: exercises() });
      haptics.success();
      const undo = () =>
        void (before?.custom_exercises
          ? saveCustomDay(weekday, {
              title: before.title,
              exercises: before.exercises.map((x) => ({ exercise_id: x.exercise_id, sets: x.sets, reps: x.reps })),
            })
          : removeCustomDay(weekday)
        ).catch(() => toast("Couldn't undo"));
      toast(`Saved as ${WEEKDAYS[weekday]}'s workout`, { action: { label: "Undo", onPress: undo } });
      onSaved(weekday);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!photo)
    return (
      <View>
        <Txt variant="small">
          Saw a workout on Instagram or TikTok? Screenshot it and choose the picture here. The AI on your PC reads the exercises, sets and reps, and you check them before anything is saved.
        </Txt>
        <Button title="Choose a screenshot" icon="image-outline" onPress={choose} style={{ marginTop: space.lg }} />
        <ErrorText message={error} />
      </View>
    );

  if (!read)
    return (
      <View>
        <Row gap={space.md}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel="Your screenshot" />
          {error ? null : (
            <Row gap={space.sm} style={{ flex: 1 }}>
              <ActivityIndicator size="small" color={t.muted} />
              <Txt variant="small" style={{ flex: 1 }}>
                Reading the workout… (up to a minute on a PC without a strong graphics card)
              </Txt>
            </Row>
          )}
        </Row>
        <ErrorText message={error} />
        {error ? <Button title="Try another picture" kind="soft" icon="image-outline" onPress={choose} style={{ marginTop: space.md }} /> : null}
      </View>
    );

  if (!read.items.length)
    return (
      <View>
        <Txt variant="small">No exercises found in that picture. Try a clearer screenshot of the list of exercises.</Txt>
        <Button title="Choose another" kind="soft" icon="image-outline" onPress={choose} style={{ marginTop: space.md }} />
      </View>
    );

  const trainingDays = [...routine.training_days].sort((a, b) => a - b);
  const replaced = weekday != null ? routine.days.find((d) => d.weekday_index === weekday) : null;
  return (
    <View>
      <Row gap={space.md}>
        <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel="Your screenshot" />
        <Txt variant="small" style={{ flex: 1 }}>
          Found {items.length} {items.length === 1 ? "exercise" : "exercises"}. Check each one: the AI can misread names and numbers.
        </Txt>
      </Row>
      <Field label="Name" value={title} onChangeText={setTitle} maxLength={60} />
      <View style={{ marginTop: space.md }}>
        {items.map((x) => (
          <View key={x.key} style={[styles.item, { borderColor: x.exercise ? t.border : t.warn, backgroundColor: t.surface }]}>
            <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="tiny" numberOfLines={1}>
                  In the picture: “{x.text}”
                </Txt>
                {x.exercise ? (
                  <Row gap={space.sm} style={{ marginTop: 2, flexWrap: "wrap" }}>
                    <Txt style={{ fontWeight: "700" }}>{x.exercise.name}</Txt>
                    {x.confidence < 0.5 ? <Badge label="Check this" tone="warn" /> : null}
                  </Row>
                ) : (
                  <Txt style={{ fontWeight: "700", marginTop: 2, color: t.warnInk }}>Not in the exercise list: pick one</Txt>
                )}
              </View>
              <IconButton icon="trash-outline" label={`Remove ${x.exercise?.name ?? x.text}`} onPress={() => setItems((l) => l.filter((y) => y.key !== x.key))} />
            </Row>
            {picking === x.key ? (
              <View>
                <ExerciseSearch
                  onPick={(e) => {
                    update(x.key, { exercise: { id: e.id, name: e.name, muscle_group: "" }, confidence: 1 });
                    setPicking(null);
                  }}
                />
                <LinkButton title="Cancel" onPress={() => setPicking(null)} />
              </View>
            ) : (
              <>
                <Row gap={space.md} style={{ alignItems: "flex-end" }}>
                  <Stepper label="Sets" value={x.sets} onChange={(v) => update(x.key, { sets: v })} step={1} min={1} max={10} decimals={0} style={{ flex: 1 }} />
                  <Field label="Reps" value={x.reps} onChangeText={(v) => update(x.key, { reps: v })} maxLength={12} style={{ flex: 1 }} />
                </Row>
                <View style={{ marginTop: space.sm }}>
                  <LinkButton title={x.exercise ? "Change exercise" : "Pick the exercise"} onPress={() => setPicking(x.key)} />
                </View>
              </>
            )}
          </View>
        ))}
      </View>
      {unmatched ? (
        <Txt variant="small" style={{ color: t.warnInk, marginTop: space.sm }}>
          Pick an exercise for {unmatched === 1 ? "1 item" : `${unmatched} items`}, or remove {unmatched === 1 ? "it" : "them"}.
        </Txt>
      ) : null}
      <ErrorText message={error} />

      <Button title="Start it now" icon="play" disabled={!ready} onPress={start} style={{ marginTop: space.lg }} />

      <Txt variant="label" style={{ marginTop: space.xl }}>
        Or save it as a day of your plan
      </Txt>
      {trainingDays.length ? (
        <>
          <Chips<number>
            value={weekday ?? -1}
            onChange={setWeekday}
            options={trainingDays.map((d) => ({ value: d, label: WEEKDAYS_SHORT[d] }))}
          />
          {replaced ? (
            <Txt variant="tiny" style={{ marginTop: space.xs }}>
              Replaces the exercises of {replaced.weekday}&apos;s “{replaced.title}”. You can switch back to the suggested ones any time.
            </Txt>
          ) : null}
          <Button
            title={weekday != null ? `Save as ${WEEKDAYS[weekday]}'s workout` : "Pick a day"}
            kind="soft"
            icon="calendar-outline"
            disabled={!ready || weekday == null}
            onPress={save}
            style={{ marginTop: space.md }}
          />
        </>
      ) : (
        <Txt variant="small">Choose your training days in Edit plan first.</Txt>
      )}
      <View style={{ marginTop: space.lg }}>
        <LinkButton title="Use another picture" onPress={choose} />
      </View>
    </View>
  );
}

// ---------- menu scanner ----------

/** The meal it probably is, from the time of day. */
function mealNow(): Meal {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack";
}

const fitLabel = (fit: number) =>
  fit >= 0.7 ? { label: "Good fit", tone: "good" as const } : fit >= 0.45 ? { label: "OK", tone: "neutral" as const } : { label: "Poor fit", tone: "warn" as const };

/**
 * Photograph a restaurant menu: each dish gets estimated calories and macros, ranked by how well it fits
 * what's left of today's plan. Everything is labelled as an estimate; logging one is a tap.
 */
const PORTIONS = [
  { value: 0.5, label: "½" },
  { value: 1, label: "1" },
  { value: 1.5, label: "1½" },
  { value: 2, label: "2" },
];

export function MenuScanner({ date, onLogged }: { date: string; onLogged: (entry: FoodLogEntry) => void }) {
  const t = useTheme();
  const isToday = date === todayISO();
  const dayText = isToday ? "today" : `on ${shortDate(date)}`;
  const [servings, setServings] = useState(1);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [scan, setScan] = useState<MenuScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [meal, setMeal] = useState<Meal>(mealNow);

  const take = async (source: "camera" | "library") => {
    setError(null);
    try {
      const p = await choosePhoto(source);
      if (!p) return;
      setPhoto(p);
      setScan(null);
      setChosen(null);
      setScan(await sendPhoto<MenuScan>(`/snap/menu?tz_offset=${tzOffset()}&date=${date}`, p));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const log = async (d: MenuDish) => {
    setError(null);
    try {
      const entry = await logMenuDish({
        name: d.name,
        calories: d.calories,
        protein_g: d.protein_g,
        carbs_g: d.carbs_g,
        fat_g: d.fat_g,
        meal,
        date,
        servings,
        portion_g: d.portion_g,
      });
      haptics.success();
      onLogged(entry);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!photo)
    return (
      <View>
        <Txt variant="small">
          At a restaurant? Photograph the menu. The AI on your PC estimates each dish and ranks them by how well they fit what&apos;s left {dayText}.
        </Txt>
        <Row gap={space.sm} style={{ marginTop: space.lg, flexWrap: "wrap" }}>
          <Button title="Take a photo" icon="camera-outline" onPress={() => take("camera")} />
          <Button title="Choose one" icon="image-outline" kind="ghost" onPress={() => take("library")} />
        </Row>
        <ErrorText message={error} />
      </View>
    );

  if (!scan)
    return (
      <View>
        <Row gap={space.md}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel="Your photo of the menu" />
          {error ? null : (
            <Row gap={space.sm} style={{ flex: 1 }}>
              <ActivityIndicator size="small" color={t.muted} />
              <Txt variant="small" style={{ flex: 1 }}>
                Reading the menu… (up to a minute or two for a long menu)
              </Txt>
            </Row>
          )}
        </Row>
        <ErrorText message={error} />
        {error ? <Button title="Try another photo" kind="soft" icon="image-outline" onPress={() => take("library")} style={{ marginTop: space.md }} /> : null}
      </View>
    );

  const left = scan.remaining_calories;
  return (
    <View>
      <View style={[styles.estimate, { backgroundColor: t.warnSoft }]}>
        <Ionicons name="information-circle" size={18} color={t.warnInk} />
        <Txt variant="small" style={{ color: t.warnInk, flex: 1 }}>
          {scan.note}
        </Txt>
      </View>
      <Txt style={{ marginTop: space.md, fontWeight: "600" }}>
        {left > 0
          ? `Left ${dayText}: about ${fmt(left)} kcal and ${fmt(scan.remaining_protein_g)} g protein`
          : `You're at the target ${dayText} (${fmt(-left)} kcal over)`}
      </Txt>
      {scan.seen ? <Txt variant="tiny">The AI saw: {scan.seen}</Txt> : null}
      {!scan.dishes.length ? (
        <Txt variant="small" style={{ marginTop: space.md }}>
          No dishes found. Try a closer, sharper photo of one page.
        </Txt>
      ) : null}
      <View style={{ marginTop: space.md }}>
        {scan.dishes.map((d, i) => {
          const f = fitLabel(d.fit);
          const open = chosen === d.name;
          return (
            <View key={`${d.name}-${i}`} style={[styles.item, { borderColor: open ? t.accent : t.border, backgroundColor: t.surface }]}>
              <Pressable
                onPress={() => {
                  setChosen(open ? null : d.name);
                  setServings(1);
                }}
                accessibilityRole="button"
                aria-expanded={open}
                accessibilityLabel={`${d.name}, about ${fmt(d.calories)} calories, ${f.label}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Row gap={space.sm} style={{ alignItems: "flex-start" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontWeight: "700" }}>{d.name}</Txt>
                    {d.description ? (
                      <Txt variant="tiny" numberOfLines={2}>
                        {d.description}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {i === 0 && d.fit >= 0.45 ? <Badge label="Best fit" tone="info" /> : null}
                    <Badge label={f.label} tone={f.tone} />
                  </View>
                </Row>
                <Txt variant="small" style={{ marginTop: space.xs, fontVariant: ["tabular-nums"] }}>
                  ≈ {fmt(d.calories)} kcal (estimate{d.portion_g ? `, about ${fmt(d.portion_g)} g` : ""})
                  <MacroText protein={d.protein_g} carbs={d.carbs_g} fat={d.fat_g} />
                </Txt>
                <Txt variant="tiny">{d.verdict}</Txt>
              </Pressable>
              {open ? (
                <View style={{ marginTop: space.sm }}>
                  <Chips<number> label="How much did you eat? (portions)" value={servings} onChange={setServings} options={PORTIONS} />
                  <Chips<Meal> label="Log to" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: cap(m) }))} />
                  <Button
                    title={`Log ≈ ${fmt(d.calories * servings)} kcal (estimate)`}
                    icon="add"
                    small
                    onPress={() => log(d)}
                    style={{ marginTop: space.md, alignSelf: "flex-start" }}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <ErrorText message={error} />
      <View style={{ marginTop: space.md }}>
        <LinkButton title="Scan another menu" onPress={() => take("camera")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  item: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  estimate: { flexDirection: "row", gap: space.sm, alignItems: "flex-start", borderRadius: radius.md, padding: space.md },
});
