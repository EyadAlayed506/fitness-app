import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";

import { logMenuDish } from "@/lib/data";
import { cap, fmt, shortDate, todayISO, tzOffset } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { choosePhoto, sendPhoto, type Photo } from "@/lib/photo";
import { errorMessage } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { FoodLogEntry, Meal, MenuDish, MenuScan } from "@/lib/types";

import { MEALS } from "./FoodParts";
import { MacroText } from "./MacroBars";
import { Badge, Button, Chips, ErrorText, LinkButton, Row, Txt } from "./ui";

/** Snap and say: the menu scanner. */

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
