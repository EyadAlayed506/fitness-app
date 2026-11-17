import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { CustomFoodForm, FoodDetail, FoodSearch, MEALS } from "@/components/FoodParts";
import { MacroBars, MacroText } from "@/components/MacroBars";
import { MenuScanner } from "@/components/SnapParts";
import {
  Button,
  Card,
  ErrorText,
  FadeIn,
  Icon,
  IconButton,
  ListRow,
  ProgressRing,
  Row,
  Screen,
  Sheet,
  Skeleton,
  SkeletonCards,
  Txt,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { addFood, copyMeal, deleteFood, deleteFoods, restoreFood, useFoodDay } from "@/lib/data";
import { addDays, fmt, longDate, shortDate, todayISO, unitLabel } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { errorMessage, qk, useRefreshOnFocus } from "@/lib/query";
import { space, type as typeScale, useTheme } from "@/lib/theme";
import type { Food, FoodLogEntry, Meal, RecentFood } from "@/lib/types";

type SheetState =
  | { kind: "search"; meal: Meal }
  | { kind: "detail"; food: Food; meal: Meal; portion?: { quantity: number; unit: string } }
  | { kind: "custom"; meal: Meal }
  | { kind: "edit"; entry: FoodLogEntry }
  | { kind: "menu" }
  | null;

export default function FoodLog() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const toast = useToast();
  const { plan } = useProfile();
  const [date, setDate] = useState(todayISO());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [refreshing, setRefreshing] = useState(false);
  const previous = addDays(date, -1);
  const dayQuery = useFoodDay(date);
  const previousDay = useFoodDay(previous); // for "Copy yesterday's lunch" (and instant paging back)
  useRefreshOnFocus([qk.foodDay(date), qk.foodRecent]);

  const day = dayQuery.data ?? null;
  const isToday = date === todayISO();
  const target = day?.target_calories ?? plan.target_calories;
  const eaten = day?.totals.calories ?? 0;
  const left = target - eaten;

  const undoable = (message: string, undo: () => Promise<unknown>) =>
    toast(message, { action: { label: tr("common.undo"), onPress: () => void undo().catch(() => {}) } });

  const remove = async (e: FoodLogEntry) => {
    try {
      await deleteFood(e);
      undoable(tr("food.removed", { name: e.food_name }), () => restoreFood(e));
    } catch (err) {
      toast(errorMessage(err) ?? tr("food.couldntRemove"));
    }
  };
  const copy = async (meal: Meal) => {
    try {
      const created = await copyMeal(previous, date, meal);
      haptics.success();
      undoable(tr("food.copied", { count: tn("food.foodCount", created.length), meal: tr(`mealLower.${meal}`) }), () => deleteFoods(created));
    } catch (err) {
      toast(errorMessage(err) ?? tr("food.couldntCopy"));
    }
  };
  const quickAdd = async (item: RecentFood, meal: Meal) => {
    try {
      const saved = await addFood({ food_id: item.food.id, quantity: item.quantity, unit: item.unit, meal, date });
      haptics.success();
      setSheet(null);
      undoable(tr("food.addedTo", { name: item.food.name, meal: tr(`mealLower.${meal}`) }), () => deleteFood(saved));
    } catch (err) {
      toast(errorMessage(err) ?? tr("food.couldntAdd"));
    }
  };

  return (
    <Screen
      title={tr("nav.food")}
      subtitle={(isToday ? tr("today.today") : longDate(date)).toLocaleUpperCase()}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await dayQuery.refetch();
        setRefreshing(false);
      }}
      right={
        <Row gap={space.sm}>
          <IconButton icon="chevron-back" label={tr("food.previousDay")} onPress={() => setDate(previous)} />
          {isToday ? null : <IconButton icon="chevron-forward" label={tr("food.nextDay")} onPress={() => setDate(addDays(date, 1))} />}
        </Row>
      }
    >
      {dayQuery.error && !day ? (
        <Card>
          <ErrorText message={errorMessage(dayQuery.error)} />
          <Button
            title={tr("common.tryAgain")}
            kind="soft"
            small
            onPress={async () => {
              await dayQuery.refetch();
            }}
            style={{ marginTop: space.md, alignSelf: "flex-start" }}
          />
        </Card>
      ) : null}
      {!day && !dayQuery.error ? (
        <SkeletonCards count={3} />
      ) : day ? (
        <FadeIn key={date}>
          <Card>
            <Row gap={space.lg + 4}>
              <ProgressRing
                value={eaten}
                max={target}
                diameter={112}
                stroke={9}
                color={left < 0 ? t.warn : t.accent}
                label={tr("home.ringLabel", { eaten: fmt(eaten), target: fmt(target) })}
              >
                <Txt style={{ ...typeScale.heading, fontSize: 22, lineHeight: 26, fontVariant: ["tabular-nums"] }}>{fmt(Math.abs(left))}</Txt>
                <Txt variant="tiny">{tr(left >= 0 ? "home.kcalLeft" : "home.kcalOver")}</Txt>
              </ProgressRing>
              <View style={{ flex: 1, minWidth: 0 }}>
                <MacroBars totals={day.totals} targetKcal={target} stacked />
                <Txt variant="tiny" style={{ marginTop: space.md }}>
                  {tr("home.eatenTarget", { eaten: fmt(eaten), target: fmt(target) })}
                </Txt>
              </View>
            </Row>
          </Card>

          {MEALS.map((meal) => {
            const items = day.entries.filter((e) => e.meal === meal);
            const kcal = items.reduce((a, b) => a + b.calories, 0);
            const before = previousDay.data?.entries.filter((e) => e.meal === meal) ?? [];
            return (
              <Card key={meal} style={{ paddingBottom: items.length ? space.xs : space.lg }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{tr(`meal.${meal}`)}</Txt>
                    <Txt variant="tiny">{items.length ? tr("food.kcal", { n: fmt(kcal) }) : tr("food.nothingLogged")}</Txt>
                  </View>
                  <Button title={tr("food.add")} icon="add" kind="soft" small onPress={() => setSheet({ kind: "search", meal })} accessibilityLabel={tr("food.addFoodTo", { meal: tr(`mealLower.${meal}`) })} />
                </Row>
                {!items.length && before.length ? (
                  <Button
                    title={tr(isToday ? "food.copyYesterday" : "food.copyFrom", {
                      meal: tr(`mealLower.${meal}`),
                      date: shortDate(previous),
                      kcal: fmt(before.reduce((a, e) => a + e.calories, 0)),
                    })}
                    icon="copy-outline"
                    kind="ghost"
                    small
                    onPress={() => copy(meal)}
                    style={{ marginTop: space.md, alignSelf: "flex-start" }}
                  />
                ) : null}
                {items.length ? <View style={{ marginTop: space.sm }} /> : null}
                {items.map((e, i) => (
                  <ListRow
                    key={e.id}
                    first={i === 0}
                    title={e.food_name}
                    subtitle={
                      <>
                        {fmt(e.quantity, 2)} {unitLabel(e.unit)}
                        <MacroText protein={e.protein_g} carbs={e.carbs_g} fat={e.fat_g} />
                      </>
                    }
                    onPress={e.id > 0 ? () => setSheet({ kind: "edit", entry: e }) : undefined}
                    right={
                      <Row gap={space.sm}>
                        <Txt style={{ fontWeight: "600", fontVariant: ["tabular-nums"], opacity: e.id > 0 ? 1 : 0.5 }}>{fmt(e.calories)}</Txt>
                        {e.id > 0 ? <IconButton icon="close" label={tr("food.removeLabel", { name: e.food_name })} onPress={() => remove(e)} /> : null}
                      </Row>
                    }
                  />
                ))}
              </Card>
            );
          })}
          <Card onPress={() => setSheet({ kind: "menu" })}>
            <Row gap={space.md}>
              <Icon name="restaurant-outline" size={20} color={t.text2} />
              <View style={{ flex: 1 }}>
                <Txt>{tr("food.menuTitle")}</Txt>
                <Txt variant="tiny">{isToday ? tr("food.menuHintToday") : tr("food.menuHintDate", { date: shortDate(date) })}</Txt>
              </View>
              <Icon name="chevron-forward" size={18} color={t.muted} />
            </Row>
          </Card>
          <Card onPress={() => setSheet({ kind: "custom", meal: "snack" })}>
            <Row gap={space.md}>
              <Icon name="create-outline" size={20} color={t.text2} />
              <View style={{ flex: 1 }}>
                <Txt>{tr("food.customTitle")}</Txt>
                <Txt variant="tiny">{tr("food.customHint")}</Txt>
              </View>
              <Icon name="chevron-forward" size={18} color={t.muted} />
            </Row>
          </Card>
        </FadeIn>
      ) : null}

      <Sheet visible={sheet?.kind === "search"} title={sheet?.kind === "search" ? tr("food.addToMeal", { meal: tr(`mealLower.${sheet.meal}`) }) : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "search" ? (
          <FoodSearch
            onPick={(food, portion) => setSheet({ kind: "detail", food, meal: sheet.meal, portion })}
            onCustom={() => setSheet({ kind: "custom", meal: sheet.meal })}
            onQuickAdd={(item) => quickAdd(item, sheet.meal)}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "detail"} title={sheet?.kind === "detail" ? sheet.food.name : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "detail" ? (
          <FoodDetail
            food={sheet.food}
            meal={sheet.meal}
            date={date}
            portion={sheet.portion}
            onAdded={(saved) => {
              setSheet(null);
              undoable(tr("food.added", { name: sheet.food.name }), () => deleteFood(saved));
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "menu"} title={tr("food.scanMenu")} onClose={() => setSheet(null)}>
        {sheet?.kind === "menu" ? (
          <MenuScanner
            date={date}
            onLogged={(entry) => {
              setSheet(null);
              undoable(tr("food.loggedEstimate", { name: entry.food_name, meal: tr(`mealLower.${entry.meal}`) }), () => deleteFood(entry));
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "custom"} title={tr("food.custom")} onClose={() => setSheet(null)}>
        {sheet?.kind === "custom" ? <CustomFoodForm onCreated={(food) => setSheet({ kind: "detail", food, meal: sheet.meal })} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "edit"} title={sheet?.kind === "edit" ? sheet.entry.food_name : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "edit" ? (
          <EditEntry
            entry={sheet.entry}
            onSaved={() => {
              setSheet(null);
              toast(tr("food.updated"));
            }}
            onDeleted={(e) => {
              setSheet(null);
              undoable(tr("food.removed", { name: e.food_name }), () => restoreFood(e));
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** Edit a logged food: loads the food itself (for its units and values), then the usual detail form. */
function EditEntry({
  entry,
  onSaved,
  onDeleted,
}: {
  entry: FoodLogEntry;
  onSaved: () => void;
  onDeleted: (e: FoodLogEntry) => void;
}) {
  const { t: tr } = useI18n();
  const food = useQuery({ queryKey: ["food", entry.food_id], queryFn: () => api<Food>(`/foods/${entry.food_id}`) });
  if (food.error) return <ErrorText message={errorMessage(food.error)} />;
  if (!food.data)
    return (
      <View style={{ gap: space.md }} accessibilityLabel={tr("common.loading")}>
        <Skeleton height={56} />
        <Skeleton height={36} width="70%" />
      </View>
    );
  return <FoodDetail food={food.data} meal={entry.meal} date={entry.date} entry={entry} onSaved={onSaved} onDeleted={onDeleted} />;
}
