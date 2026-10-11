import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { CustomFoodForm, FoodDetail, FoodSearch, MEALS } from "@/components/FoodParts";
import { MacroBars } from "@/components/MacroBars";
import { Button, Card, IconButton, ListRow, Meter, Row, Screen, Sheet, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { addDays, cap, fmt, longDate, todayISO, unitLabel } from "@/lib/format";
import type { Food, FoodDay, Meal } from "@/lib/types";

type SheetState = { kind: "search"; meal: Meal } | { kind: "detail"; food: Food; meal: Meal } | { kind: "custom"; meal: Meal } | null;

export default function FoodLog() {
  const toast = useToast();
  const { plan } = useProfile();
  const [date, setDate] = useState(todayISO());
  const [day, setDay] = useState<FoodDay | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  const load = useCallback(async (d: string) => setDay(await api<FoodDay>(`/food-logs?date=${d}`)), []);
  useFocusEffect(
    useCallback(() => {
      load(date).catch(() => {});
    }, [load, date]),
  );

  const isToday = date === todayISO();
  const target = day?.target_calories ?? plan.target_calories;
  const eaten = day?.totals.calories ?? 0;

  return (
    <Screen title="Food log" subtitle={isToday ? "Today" : longDate(date)}>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <IconButton icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
          <Txt style={{ fontWeight: "700" }}>{isToday ? "Today" : longDate(date)}</Txt>
          {isToday ? <View style={{ width: 30 }} /> : <IconButton icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} />}
        </Row>
        <Row style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 12, marginBottom: 8 }}>
          <Txt>
            <Txt variant="big">{fmt(eaten)}</Txt>
            <Txt variant="muted"> / {fmt(target)} kcal</Txt>
          </Txt>
          <Txt variant="small">{eaten <= target ? `${fmt(target - eaten)} left` : `${fmt(eaten - target)} over`}</Txt>
        </Row>
        <Meter value={eaten} max={target} />
        {day ? <MacroBars totals={day.totals} targetKcal={target} /> : null}
      </Card>

      {MEALS.map((meal) => {
        const items = day?.entries.filter((e) => e.meal === meal) ?? [];
        const kcal = items.reduce((a, b) => a + b.calories, 0);
        return (
          <Card key={meal}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="h3">
                {cap(meal)} {items.length ? <Txt variant="small">· {fmt(kcal)} kcal</Txt> : null}
              </Txt>
              <Button title="+ Add" kind="soft" small onPress={() => setSheet({ kind: "search", meal })} accessibilityLabel={`Add food to ${meal}`} />
            </Row>
            {items.map((e, i) => (
              <ListRow
                key={e.id}
                first={i === 0}
                title={e.food_name}
                subtitle={`${fmt(e.quantity, 2)} ${unitLabel(e.unit)} · P ${fmt(e.protein_g)} · C ${fmt(e.carbs_g)} · F ${fmt(e.fat_g)} g`}
                right={
                  <Row>
                    <Txt style={{ fontWeight: "700" }}>{fmt(e.calories)}</Txt>
                    <IconButton
                      icon="close"
                      label={`Remove ${e.food_name}`}
                      onPress={async () => {
                        await api(`/food-logs/${e.id}`, { method: "DELETE" });
                        await load(date);
                      }}
                    />
                  </Row>
                }
              />
            ))}
          </Card>
        );
      })}
      <Button title="Create a custom food" kind="ghost" onPress={() => setSheet({ kind: "custom", meal: "snack" })} />

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
