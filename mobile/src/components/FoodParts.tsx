import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "@/lib/api";
import { addFood, deleteFood, updateFood, useRecentFoods } from "@/lib/data";
import { MASS_TO_G, VOLUME_TO_ML, cap, fmt, unitLabel } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { errorMessage } from "@/lib/query";
import { space, useTheme } from "@/lib/theme";
import type { Food, FoodCandidate, FoodLogEntry, FoodSearch as SearchResult, Meal, RecentFood } from "@/lib/types";

import { Badge, Button, Checkbox, Chips, ErrorText, Field, IconButton, ListRow, Row, Skeleton, Stat, Stepper, Txt } from "./ui";

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

const SOURCE_LABEL: Record<string, string> = { usda: "USDA", off: "Open Food Facts", manual: "Mine", builtin: "" };

const SUB_NUTRIENTS: [keyof Food, string, string][] = [
  ["fiber_g", "Fiber", "g"],
  ["sugar_g", "Sugars", "g"],
  ["added_sugar_g", "Added sugars", "g"],
  ["saturated_fat_g", "Saturated fat", "g"],
  ["trans_fat_g", "Trans fat", "g"],
  ["cholesterol_mg", "Cholesterol", "mg"],
  ["sodium_mg", "Sodium", "mg"],
  ["potassium_mg", "Potassium", "mg"],
];

export function baseAmount(food: Food, quantity: number, unit: string): number | null {
  if (unit === "serving") {
    if (!food.serving_size || !food.serving_unit) return null;
    const one = baseAmount(food, food.serving_size, food.serving_unit);
    return one == null ? null : quantity * one;
  }
  const table = food.is_liquid ? VOLUME_TO_ML : MASS_TO_G;
  return table[unit] ? quantity * table[unit] : null;
}

// ---------- search ----------

/** Calories of a portion of a food (per-100 values × amount), or null if the unit doesn't fit. */
export function portionCalories(food: Food, quantity: number, unit: string): number | null {
  const amount = baseAmount(food, quantity, unit);
  return amount == null ? null : (food.calories * amount) / 100;
}

export function FoodSearch({
  onPick,
  onCustom,
  onQuickAdd,
}: {
  onPick: (food: Food, portion?: { quantity: number; unit: string }) => void;
  onCustom: () => void;
  /** log a recent food again with last time's amount, in one tap */
  onQuickAdd?: (item: RecentFood) => void;
}) {
  const recentFoods = useRecentFoods();
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState<Food[]>([]);
  const [online, setOnline] = useState<FoodCandidate[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searchingOnline, setSearchingOnline] = useState(false);
  const latest = useRef("");

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) return;
    const id = setTimeout(async () => {
      try {
        // Local results are instant; the online databases can take a few seconds
        const quick = await api<SearchResult>(`/foods/search?online=false&q=${encodeURIComponent(q)}`);
        if (latest.current !== q) return;
        setLocal(quick.local);
        setOnline(null);
        setSearchingOnline(true);
        const full = await api<SearchResult>(`/foods/search?online=true&q=${encodeURIComponent(q)}`);
        if (latest.current !== q) return;
        setOnline(full.online);
        setWarnings(full.warnings);
      } catch {
        // keep whatever we have
      } finally {
        if (latest.current === q) setSearchingOnline(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const [importError, setImportError] = useState<string | null>(null);
  const pickOnline = async (c: FoodCandidate) => {
    setImportError(null);
    try {
      onPick(await api<Food>("/foods/import", { method: "POST", body: c }));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Couldn't add that food. Try another result.");
    }
  };

  // With an empty search box, hide the results of the previous search
  const searching = query.trim() !== "";

  const subtitle = (f: Food | FoodCandidate) =>
    `${f.brand ? `${f.brand} · ` : ""}${fmt(f.calories)} kcal per ${f.is_liquid ? "100 ml" : "100 g"}`;

  // With an empty box: what the user logs most, so a repeat is one or two taps
  const recent = recentFoods.data?.recent.slice(0, 6) ?? [];
  const shownIds = new Set(recent.map((r) => r.food.id));
  const frequent = recentFoods.data?.frequent.filter((r) => !shownIds.has(r.food.id)).slice(0, 6) ?? [];
  const recentRow = (r: RecentFood, i: number) => {
    const kcal = portionCalories(r.food, r.quantity, r.unit);
    return (
      <ListRow
        key={`${r.food.id}`}
        first={i === 0}
        title={r.food.name}
        subtitle={`${fmt(r.quantity, 2)} ${unitLabel(r.unit)}${kcal != null ? ` · ${fmt(kcal)} kcal` : ""}${r.times > 1 ? ` · ${r.times}×` : ""}`}
        onPress={() => onPick(r.food, { quantity: r.quantity, unit: r.unit })}
        right={
          onQuickAdd ? (
            <IconButton icon="add" label={`Add ${r.food.name}, ${fmt(r.quantity, 2)} ${unitLabel(r.unit)}`} onPress={() => onQuickAdd(r)} />
          ) : undefined
        }
      />
    );
  };

  return (
    <View>
      <Field label="Search food" value={query} onChangeText={setQuery} placeholder="e.g. banana, chicken breast, nutella" autoFocus autoCorrect={false} />
      {!searching && recentFoods.isPending ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      ) : null}
      {!searching && recent.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">Recent</Txt>
          {recent.map(recentRow)}
        </View>
      ) : null}
      {!searching && frequent.length ? (
        <View style={{ marginTop: space.md }}>
          <Txt variant="label">Frequent</Txt>
          {frequent.map(recentRow)}
        </View>
      ) : null}
      {searching && local.length ? (
        <View style={{ marginTop: 10 }}>
          <Txt variant="label">In the app</Txt>
          {local.map((f, i) => (
            <ListRow
              key={`l${f.id}`}
              first={i === 0}
              title={f.name}
              subtitle={subtitle(f)}
              right={SOURCE_LABEL[f.source] ? <Badge label={SOURCE_LABEL[f.source]} /> : undefined}
              onPress={() => onPick(f)}
            />
          ))}
        </View>
      ) : null}
      {searching && searchingOnline ? (
        <Txt variant="muted" style={{ marginTop: 10 }}>
          Searching USDA and Open Food Facts…
        </Txt>
      ) : null}
      {searching && online?.length ? (
        <View style={{ marginTop: 10 }}>
          <Txt variant="label">Online databases</Txt>
          {online.map((f, i) => (
            <ListRow
              key={`o${f.source}${f.external_id}`}
              first={i === 0}
              title={f.name}
              subtitle={subtitle(f)}
              right={<Badge label={SOURCE_LABEL[f.source]} />}
              onPress={() => pickOnline(f)}
            />
          ))}
        </View>
      ) : null}
      <ErrorText message={importError} />
      {(searching ? warnings : []).map((w) => (
        <Txt key={w} variant="muted" style={{ marginTop: 6, fontSize: 13 }}>
          {w}
        </Txt>
      ))}
      {searching && online && !online.length && !local.length && !warnings.length ? (
        <Txt variant="muted" style={{ marginTop: 10 }}>
          Nothing found.
        </Txt>
      ) : null}
      <Button title="Not found? Create a custom food" kind="ghost" onPress={onCustom} style={{ marginTop: 16 }} />
    </View>
  );
}

// ---------- amount, unit and meal for one food ----------

/** How much one tap of − / + changes the amount, per unit. */
const STEP: Record<string, number> = {
  g: 10, ml: 25, serving: 0.5, oz: 0.5, lb: 0.1, kg: 0.05, l: 0.1,
  cup: 0.25, tbsp: 1, tsp: 1, fl_oz: 1, pint: 0.25, quart: 0.25, gallon: 0.1,
};

/**
 * Amount, unit and meal for a food, with what it adds up to. Adds a new entry, or, with `entry`,
 * edits that logged entry (and can delete it).
 */
export function FoodDetail({
  food,
  meal: initialMeal,
  date,
  portion,
  entry,
  onAdded,
  onSaved,
  onDeleted,
}: {
  food: Food;
  meal: Meal;
  date: string;
  /** start with this amount (e.g. last time's) */
  portion?: { quantity: number; unit: string };
  /** editing a logged entry */
  entry?: FoodLogEntry;
  onAdded?: (entry: FoodLogEntry) => void;
  onSaved?: (entry: FoodLogEntry) => void;
  onDeleted?: (entry: FoodLogEntry) => void;
}) {
  const t = useTheme();
  const start = entry ? { quantity: entry.quantity, unit: entry.unit } : portion;
  const [units, setUnits] = useState<string[]>([]);
  const [unit, setUnit] = useState(start?.unit ?? "g");
  const [qty, setQty] = useState(start ? String(start.quantity) : "100");
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? initialMeal);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<string[]>(`/foods/${food.id}/units`)
      .then((list) => {
        setUnits(list);
        if (start && list.includes(start.unit)) return; // keep the amount we started with
        setUnit(list[0]);
        setQty(list[0] === "serving" ? "1" : food.is_liquid ? "250" : "100");
      })
      .catch(() => {});
    // only when the food changes; `start` is the first amount shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [food.id, food.is_liquid]);

  const quantity = Number(qty.replace(",", ".")) || 0;
  const amount = baseAmount(food, quantity, unit) ?? 0;
  const f = amount / 100;
  const subs = SUB_NUTRIENTS.filter(([k]) => food[k] != null);

  const add = async () => {
    setError(null);
    try {
      const saved = await addFood(
        { food_id: food.id, date, meal, quantity, unit },
        {
          food_id: food.id,
          food_name: food.name,
          date,
          meal,
          quantity,
          unit,
          amount_base: amount,
          calories: food.calories * f,
          protein_g: food.protein_g * f,
          carbs_g: food.carbs_g * f,
          fat_g: food.fat_g * f,
        },
      );
      haptics.success();
      onAdded?.(saved);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const save = async () => {
    if (!entry) return;
    setError(null);
    try {
      const saved = await updateFood(entry, { quantity, unit, meal });
      haptics.success();
      onSaved?.(saved);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!entry) return;
    setError(null);
    try {
      await deleteFood(entry);
      onDeleted?.(entry);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const row = (label: string, value: string, indent = false) => (
    <Row key={label} style={{ justifyContent: "space-between", paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
      <Text style={{ color: indent ? t.text2 : t.text, paddingLeft: indent ? 12 : 0, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 14, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </Row>
  );

  return (
    <View>
      <Txt variant="small">
        {food.brand ? `${food.brand} · ` : ""}
        {food.is_liquid ? "Drink / liquid" : "Solid"}
        {food.serving_size && food.serving_unit ? ` · 1 serving = ${fmt(food.serving_size, 1)} ${unitLabel(food.serving_unit)}` : ""}
      </Txt>
      <Stepper label="Amount" value={qty} onChange={setQty} step={STEP[unit] ?? 1} min={0} max={100000} decimals={2} suffix={unitLabel(unit)} />
      {units.length ? <Chips label="Unit" value={unit} onChange={setUnit} options={units.map((u) => ({ value: u, label: unitLabel(u) }))} /> : null}
      <Chips label="Meal" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: cap(m) }))} />
      <Row style={{ marginTop: 12 }} gap={6}>
        <Stat label="kcal" value={fmt(food.calories * f)} />
        <Stat label="Protein g" value={fmt(food.protein_g * f, 1)} />
        <Stat label="Carbs g" value={fmt(food.carbs_g * f, 1)} />
        <Stat label="Fat g" value={fmt(food.fat_g * f, 1)} />
      </Row>
      <ErrorText message={error} />
      {entry ? (
        <>
          <Button title="Save changes" icon="checkmark" onPress={save} disabled={quantity <= 0} style={{ marginTop: 14 }} />
          <Button title="Remove from log" icon="trash-outline" kind="danger" onPress={remove} style={{ marginTop: space.sm, borderColor: "transparent" }} />
        </>
      ) : (
        <Button title="Add to log" icon="add" onPress={add} disabled={quantity <= 0} style={{ marginTop: 14 }} />
      )}

      <Txt variant="h3" style={{ marginTop: 18, marginBottom: 4 }}>
        Per {food.is_liquid ? "100 ml" : "100 g"}
      </Txt>
      {row("Calories", `${fmt(food.calories)} kcal`)}
      {row("Protein", `${fmt(food.protein_g, 1)} g`)}
      {row("Carbohydrates", `${fmt(food.carbs_g, 1)} g`)}
      {row("Fat", `${fmt(food.fat_g, 1)} g`)}
      {subs.map(([k, label, u]) => row(label, `${fmt(food[k] as number, 1)} ${u}`, true))}
    </View>
  );
}

// ---------- manual custom food ----------

export function CustomFoodForm({ onCreated }: { onCreated: (food: Food) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [liquid, setLiquid] = useState(false);
  const [servingSize, setServingSize] = useState("100");
  const [servingUnit, setServingUnit] = useState("g");
  const [per, setPer] = useState<"serving" | "100">("serving");
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSubs, setShowSubs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOptions = Object.keys(liquid ? VOLUME_TO_ML : MASS_TO_G).map((u) => ({ value: u, label: unitLabel(u) }));
  const set = (k: string) => (v: string) => setValues((old) => ({ ...old, [k]: v }));
  const num = (v: string | undefined) => (v == null || v.trim() === "" ? null : Number(v.replace(",", ".")));

  const save = async () => {
    setError(null);
    const body: Record<string, unknown> = {
      name,
      brand,
      is_liquid: liquid,
      serving_size: num(servingSize),
      serving_unit: servingUnit,
      values_per: per,
    };
    for (const k of ["calories", "protein_g", "carbs_g", "fat_g", ...SUB_NUTRIENTS.map(([k]) => k as string)]) body[k] = num(values[k]);
    if (!name.trim() || [body.calories, body.protein_g, body.carbs_g, body.fat_g].some((v) => v == null)) {
      setError("Enter a name, calories, protein, carbs and fat.");
      return;
    }
    try {
      onCreated(await api<Food>("/foods", { method: "POST", body }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Mom's lentil soup" />
      <Field label="Brand (optional)" value={brand} onChangeText={setBrand} />
      <Checkbox
        checked={liquid}
        onChange={(v) => {
          setLiquid(v);
          setServingUnit(v ? "ml" : "g");
        }}
        label="It's a drink / liquid (measured in ml)"
      />
      <Field label="Serving size" value={servingSize} onChangeText={setServingSize} keyboardType="decimal-pad" />
      <Chips value={servingUnit} onChange={setServingUnit} options={unitOptions} />
      <Chips
        label="The values below are for"
        value={per}
        onChange={setPer}
        options={[
          { value: "serving", label: "1 serving" },
          { value: "100", label: "100 g / ml" },
        ]}
      />
      <Row>
        <Field label="Calories (kcal)" value={values.calories ?? ""} onChangeText={set("calories")} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Protein (g)" value={values.protein_g ?? ""} onChangeText={set("protein_g")} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Row>
        <Field label="Carbs (g)" value={values.carbs_g ?? ""} onChangeText={set("carbs_g")} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Fat (g)" value={values.fat_g ?? ""} onChangeText={set("fat_g")} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Button title={showSubs ? "Hide sub-macros" : "Add sub-macros (optional)"} kind="ghost" small onPress={() => setShowSubs(!showSubs)} style={{ marginTop: 12, alignSelf: "flex-start" }} />
      {showSubs ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8 }}>
          {SUB_NUTRIENTS.map(([k, label, u]) => (
            <Field key={k} label={`${label} (${u})`} value={values[k] ?? ""} onChangeText={set(k)} keyboardType="decimal-pad" style={{ width: "48%" }} />
          ))}
        </View>
      ) : null}
      <ErrorText message={error} />
      <Button title="Save and log it" onPress={save} style={{ marginTop: 16 }} />
    </View>
  );
}
