import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { CustomFoodForm, FoodDetail, FoodSearch, MEALS } from "@/components/FoodParts";
import { MacroBars } from "@/components/MacroBars";
import {
  Button,
  Card,
  ErrorText,
  FadeIn,
  IconButton,
  ListRow,
  ProgressRing,
  Row,
  Screen,
  Sheet,
  SkeletonCards,
  Txt,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { addDays, cap, fmt, longDate, todayISO, unitLabel } from "@/lib/format";
import { space, type as typeScale, useTheme } from "@/lib/theme";
import type { Food, FoodDay, Meal } from "@/lib/types";

type SheetState = { kind: "search"; meal: Meal } | { kind: "detail"; food: Food; meal: Meal } | { kind: "custom"; meal: Meal } | null;

export default function FoodLog() {
  const t = useTheme();
  const toast = useToast();
  const { plan } = useProfile();
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState<FoodDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (d: string) => {
    try {
      setDay(await api<FoodDay>(`/food-logs?date=${d}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the food log.");
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const isToday = date === todayISO();
  const target = day?.target_calories ?? plan.target_calories;
  const eaten = day?.totals.calories ?? 0;
  const left = target - eaten;
  // the shown day only matches `date` once its data has arrived
  const current = day && day.date === date ? day : null;

  return (
    <Screen
      title="Food"
      subtitle={isToday ? "TODAY" : longDate(date).toUpperCase()}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load(date);
        setRefreshing(false);
      }}
      right={
        <Row gap={space.sm}>
          <IconButton icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
          {isToday ? null : <IconButton icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} />}
        </Row>
      }
    >
      {error ? (
        <Card>
          <ErrorText message={error} />
          <Button title="Try again" kind="soft" small onPress={() => load(date)} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
        </Card>
      ) : null}
      {!current && !error ? (
        <SkeletonCards count={3} />
      ) : current ? (
        <FadeIn key={date}>
          <Card>
            <Row gap={space.lg + 4}>
              <ProgressRing
                value={eaten}
                max={target}
                diameter={112}
                stroke={9}
                color={left < 0 ? t.warn : t.accent}
                label={`${fmt(eaten)} of ${fmt(target)} calories eaten`}
              >
                <Txt style={{ ...typeScale.heading, fontSize: 22, lineHeight: 26, fontVariant: ["tabular-nums"] }}>{fmt(Math.abs(left))}</Txt>
                <Txt variant="tiny">{left >= 0 ? "kcal left" : "kcal over"}</Txt>
              </ProgressRing>
              <View style={{ flex: 1, minWidth: 0 }}>
                <MacroBars totals={current.totals} targetKcal={target} stacked />
                <Txt variant="tiny" style={{ marginTop: space.md }}>
                  {fmt(eaten)} eaten · {fmt(target)} target
                </Txt>
              </View>
            </Row>
          </Card>

          {MEALS.map((meal) => {
            const items = current.entries.filter((e) => e.meal === meal);
            const kcal = items.reduce((a, b) => a + b.calories, 0);
            return (
              <Card key={meal} style={{ paddingBottom: items.length ? space.xs : space.lg }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{cap(meal)}</Txt>
                    <Txt variant="tiny">{items.length ? `${fmt(kcal)} kcal` : "Nothing logged"}</Txt>
                  </View>
                  <Button title="Add" icon="add" kind="soft" small onPress={() => setSheet({ kind: "search", meal })} accessibilityLabel={`Add food to ${meal}`} />
                </Row>
                {items.length ? <View style={{ marginTop: space.sm }} /> : null}
                {items.map((e, i) => (
                  <ListRow
                    key={e.id}
                    first={i === 0}
                    title={e.food_name}
                    subtitle={`${fmt(e.quantity, 2)} ${unitLabel(e.unit)} · P ${fmt(e.protein_g)} · C ${fmt(e.carbs_g)} · F ${fmt(e.fat_g)} g`}
                    right={
                      <Row gap={space.sm}>
                        <Txt style={{ fontWeight: "600", fontVariant: ["tabular-nums"] }}>{fmt(e.calories)}</Txt>
                        <IconButton
                          icon="close"
                          label={`Remove ${e.food_name}`}
                          onPress={async () => {
                            await api(`/food-logs/${e.id}`, { method: "DELETE" });
                            await load(date);
                            toast(`${e.food_name} removed`);
                          }}
                        />
                      </Row>
                    }
                  />
                ))}
              </Card>
            );
          })}
          <Card onPress={() => setSheet({ kind: "custom", meal: "snack" })}>
            <Row gap={space.md}>
              <Ionicons name="create-outline" size={20} color={t.text2} />
              <View style={{ flex: 1 }}>
                <Txt>Create a custom food</Txt>
                <Txt variant="tiny">For recipes or labels the search doesn’t know</Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.muted} />
            </Row>
          </Card>
        </FadeIn>
      ) : null}

      <Sheet visible={sheet?.kind === "search"} title={sheet?.kind === "search" ? `Add to ${sheet.meal}` : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "search" ? (
          <FoodSearch
            onPick={(food) => setSheet({ kind: "detail", food, meal: sheet.meal })}
            onCustom={() => setSheet({ kind: "custom", meal: sheet.meal })}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "detail"} title={sheet?.kind === "detail" ? sheet.food.name : ""} onClose={() => setSheet(null)}>
        {sheet?.kind === "detail" ? (
          <FoodDetail
            food={sheet.food}
            meal={sheet.meal}
            date={date}
            onAdded={async () => {
              toast(`${sheet.food.name} added`);
              setSheet(null);
              await load(date);
            }}
          />
        ) : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "custom"} title="Custom food" onClose={() => setSheet(null)}>
        {sheet?.kind === "custom" ? <CustomFoodForm onCreated={(food) => setSheet({ kind: "detail", food, meal: sheet.meal })} /> : null}
      </Sheet>
    </Screen>
  );
}
