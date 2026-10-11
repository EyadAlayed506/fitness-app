import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { MacroBars } from "@/components/MacroBars";
import { SleepForm, qualityLabel, rangeBadge, trackerSummary } from "@/components/SleepParts";
import { TodayCard } from "@/components/TodayCard";
import { Badge, Button, Card, CardHead, Field, LinkButton, Meter, Row, Screen, Section, Sheet, Stat, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useProfile } from "@/lib/auth";
import { cap, clockOf, fmt, hoursMinutes, shortDate, todayISO, tzOffset, units } from "@/lib/format";
import { profilePayload } from "@/lib/profile";
import { useTheme } from "@/lib/theme";
import type { DietOption, FoodDay, Plan, Recommendations, SleepAnalytics, SleepEntry, WhoopStatus } from "@/lib/types";

const BMI_BADGE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" } as const;
const SCALE_MIN = 15;
const SCALE_MAX = 40;

export default function Home() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { profile, plan } = useProfile();
  const u = units(profile.unit_system);
  const [day, setDay] = useState<FoodDay | null>(null);
  const [lastSleep, setLastSleep] = useState<SleepEntry | null>(null);
  const [sleepStats, setSleepStats] = useState<SleepAnalytics | null>(null);
  const [today, setToday] = useState<Recommendations | null>(null);
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [loggingSleep, setLoggingSleep] = useState(false);
  const [weight, setWeight] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const whoop = await api<WhoopStatus>("/whoop").catch(() => null);
    setWhoopConnected(!!whoop?.connected);
    if (whoop?.connected) {
      // bring in last night's WHOOP sleep (at most every 30 minutes); failures just show older data
      await api("/whoop/sync?stale_minutes=30", { method: "POST" }).catch(() => null);
    }
    const [food, sleeps, stats, recs] = await Promise.all([
      api<FoodDay>(`/food-logs?date=${todayISO()}`),
      api<SleepEntry[]>("/sleep?limit=1"),
      api<SleepAnalytics>("/analytics/sleep?days=7"),
      api<Recommendations>(`/me/recommendations?tz_offset=${tzOffset()}`).catch(() => null),
    ]);
    setToday(recs);
    setDay(food);
    setLastSleep(sleeps[0] ?? null);
    setSleepStats(stats);
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const pickDiet = async (o: DietOption) => {
    if (o.selected || o.option === "maintain") return;
    await api("/me/profile", { method: "PUT", body: profilePayload(profile, { diet_option: o.option }) });
    await refresh();
    await load();
    toast(`Switched to the ${o.option} diet`);
  };

  const saveWeight = async () => {
    const v = Number(weight.replace(",", "."));
    if (!v) return;
    await api("/me/weight", { method: "POST", body: { weight: v, unit: u.w } });
    setWeight("");
    await refresh();
    toast("Weight saved");
  };

  const eaten = day?.totals.calories ?? 0;
  const target = plan.target_calories;
  const change = plan.weight_change_kg;

  return (
    <Screen
      title="Hi there"
      subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await Promise.all([refresh(), load()]).catch(() => {});
        setRefreshing(false);
      }}
    >
      {today ? <TodayCard data={today} /> : null}

      <Card>
        <CardHead title="Body mass index" right={<Badge label={cap(plan.bmi_category)} tone={BMI_BADGE[plan.bmi_category]} />} />
        <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <Txt variant="hero">{plan.bmi.toFixed(1)}</Txt>
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="small">
              {u.weight(profile.weight_kg)} · {u.length(profile.height_cm, u.imperial ? 1 : 0)}
            </Txt>
            <Txt variant="small">Age {plan.age}</Txt>
          </View>
        </Row>
        <BmiScale bmi={plan.bmi} />
        <Txt style={{ marginTop: 12 }}>
          {plan.direction === "maintain" ? (
            "You are in the healthy range. Your plan keeps your weight steady."
          ) : (
            <>
              {change < 0 ? "Lose " : "Gain "}
              <Txt style={{ fontWeight: "700" }}>{u.weight(Math.abs(change))}</Txt> to reach the optimal BMI of 22 (
              <Txt style={{ fontWeight: "700" }}>{u.weight(plan.optimal_weight_kg)}</Txt>).
            </>
          )}
        </Txt>
        <Txt variant="small" style={{ marginTop: 6 }}>
          Healthy weight for your height: {u.weight(plan.healthy_weight_min_kg)} – {u.weight(plan.healthy_weight_max_kg)}
        </Txt>
        {plan.change_to_healthy_range_kg !== 0 ? (
          <Txt variant="small" style={{ marginTop: 4 }}>
            Smallest step into the healthy range: {u.weightDelta(plan.change_to_healthy_range_kg)}
          </Txt>
        ) : null}
      </Card>

      <Card>
        <CardHead title="Today's calories" right={<LinkButton title="Food log ›" onPress={() => router.push("/food")} />} />
        <Row style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <Txt>
            <Txt variant="big">{fmt(eaten)}</Txt>
            <Txt variant="muted"> / {fmt(target)} kcal</Txt>
          </Txt>
          <Txt variant="small">{eaten <= target ? `${fmt(target - eaten)} left` : `${fmt(eaten - target)} over`}</Txt>
        </Row>
        <Meter value={eaten} max={target} />
        {day ? <MacroBars totals={day.totals} targetKcal={target} /> : null}
      </Card>

      <Card>
        <CardHead title="Sleep" right={<LinkButton title="Details ›" onPress={() => router.push("/sleep")} />} />
        {lastSleep ? (
          <>
            <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <Txt>
                <Txt variant="big">{hoursMinutes(lastSleep.duration_minutes)}</Txt>
                <Txt variant="muted"> {lastSleep.date === todayISO() ? "last night" : `night to ${shortDate(lastSleep.date)}`}</Txt>
              </Txt>
              <Row gap={6}>
                {lastSleep.source === "whoop" ? <Badge label="WHOOP" tone="info" /> : null}
                {lastSleep.quality ? <Badge label={qualityLabel(lastSleep.quality) ?? ""} /> : null}
              </Row>
            </Row>
            <Txt variant="small" style={{ marginTop: 2 }}>
              {clockOf(lastSleep.bedtime)} → {clockOf(lastSleep.wake_time)}
              {lastSleep.source !== "manual" && trackerSummary(lastSleep) ? ` · ${trackerSummary(lastSleep)}` : ""}
            </Txt>
            {sleepStats?.average_hours_7d != null ? (
              <Row style={{ justifyContent: "space-between", marginTop: 8 }}>
                <Txt variant="small">
                  7-day average {hoursMinutes(sleepStats.average_hours_7d * 60)} · aim for {sleepStats.recommended_hours[0]}–
                  {sleepStats.recommended_hours[1]} h
                </Txt>
                {rangeBadge(sleepStats.average_hours_7d, sleepStats.recommended_hours)}
              </Row>
            ) : null}
          </>
        ) : (
          <Txt variant="small">
            No sleep yet. Log last night by hand, or connect WHOOP on the Sleep screen to import it automatically.
          </Txt>
        )}
        {whoopConnected ? (
          <Button title="Open sleep" icon="moon" kind="soft" onPress={() => router.push("/sleep")} style={{ marginTop: 12 }} />
        ) : (
          <Row style={{ marginTop: 12 }}>
            <Button title="Log sleep" icon="moon" kind="soft" onPress={() => setLoggingSleep(true)} style={{ flex: 1 }} />
            <Button title="Connect WHOOP" kind="ghost" onPress={() => router.push("/sleep")} />
          </Row>
        )}
      </Card>
      <Sheet visible={loggingSleep} title="Log sleep" onClose={() => setLoggingSleep(false)}>
        {loggingSleep ? (
          <SleepForm
            onSaved={async (message) => {
              setLoggingSleep(false);
              toast(message);
              await load();
            }}
          />
        ) : null}
      </Sheet>

      <Section title="Daily calories" />
      <Card>
        <Row>
          <Stat label="Resting (BMR)" value={fmt(plan.bmr)} />
          <Stat label="Maintenance" value={fmt(plan.tdee)} />
          <Stat label="Your target" value={fmt(plan.target_calories)} />
        </Row>
        <Txt variant="small" style={{ marginTop: 12, marginBottom: 8 }}>
          {plan.direction === "maintain"
            ? "Eat about your maintenance calories to keep your weight."
            : `Pick how fast you want to ${plan.direction} weight. Eating exactly this many calories a day:`}
        </Txt>
        <View style={{ gap: 8 }}>
          {plan.options.map((o) => (
            <DietCard key={o.option} option={o} plan={plan} onPress={() => pickDiet(o)} />
          ))}
        </View>
        <Txt variant="tiny" style={{ marginTop: 10 }}>
          {plan.disclaimer} 1 kg of body fat ≈ 7,700 kcal.
        </Txt>
      </Card>

      <Section title="Log your weight" />
      <Card>
        <Row>
          <Field
            placeholder={`Today's weight (${u.w})`}
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            style={{ flex: 1, marginTop: 0 }}
            accessibilityLabel="Today's weight"
            onSubmitEditing={saveWeight}
          />
          <Button title="Save" onPress={saveWeight} />
        </Row>
      </Card>
    </Screen>
  );
}

function BmiScale({ bmi }: { bmi: number }) {
  const t = useTheme();
  const zones = [
    { from: 15, to: 18.5, color: t.series[0] },
    { from: 18.5, to: 25, color: t.good },
    { from: 25, to: 30, color: t.warn },
    { from: 30, to: 40, color: t.critical },
  ];
  const pos = (v: number) => ((Math.min(Math.max(v, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return (
    <View style={{ marginTop: 14 }} accessibilityLabel={`BMI scale, your BMI is ${bmi}`}>
      <View style={{ flexDirection: "row", height: 10, borderRadius: 99, overflow: "hidden", gap: 2 }}>
        {zones.map((z) => (
          <View key={z.from} style={{ flex: z.to - z.from, backgroundColor: z.color }} />
        ))}
      </View>
      <View
        style={{
          position: "absolute",
          top: -4,
          left: `${pos(bmi)}%`,
          width: 4,
          height: 18,
          marginLeft: -2,
          borderRadius: 2,
          backgroundColor: t.text,
          borderWidth: 1,
          borderColor: t.surface,
        }}
      />
      <View style={{ height: 16, marginTop: 4 }}>
        {[15, 18.5, 25, 30, 40].map((v, i, all) => (
          <Txt
            key={v}
            variant="tiny"
            style={{
              position: "absolute",
              left: `${pos(v)}%`,
              transform: [{ translateX: i === 0 ? 0 : i === all.length - 1 ? -16 : -10 }],
            }}
          >
            {v}
          </Txt>
        ))}
      </View>
    </View>
  );
}

function DietCard({ option: o, plan, onPress }: { option: DietOption; plan: Plan; onPress: () => void }) {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  if (o.option === "maintain") {
    return (
      <View style={{ borderWidth: 1.5, borderColor: t.accent, backgroundColor: t.accentSoft, borderRadius: 12, padding: 12 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt style={{ fontWeight: "700" }}>Maintain</Txt>
          <Txt style={{ fontWeight: "700", fontSize: 18 }}>{fmt(o.calories)} kcal</Txt>
        </Row>
        <Txt variant="small">Same as your maintenance calories</Txt>
      </View>
    );
  }
  const sign = o.difference > 0 ? "+" : "−";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: o.selected }}
      style={({ pressed }) => ({
        borderWidth: 1.5,
        borderColor: o.selected ? t.accent : t.border,
        backgroundColor: o.selected ? t.accentSoft : t.surface,
        borderRadius: 12,
        padding: 12,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Row gap={6}>
          <Txt style={{ fontWeight: "700" }}>{cap(o.option)}</Txt>
          {o.selected ? <Badge label="Current" tone="info" /> : null}
        </Row>
        <Txt style={{ fontWeight: "700", fontSize: 18 }}>{fmt(o.calories)} kcal</Txt>
      </Row>
      <Txt variant="small" style={{ marginTop: 2 }}>
        {sign}
        {fmt(Math.abs(o.difference))} kcal/day · {plan.direction} ~{u.weight(Math.abs(o.weekly_change_kg), 2)}/week
        {o.weeks_to_target != null ? ` · goal in ~${fmt(o.weeks_to_target)} weeks` : ""}
      </Txt>
      {o.warning ? (
        <Txt variant="small" style={{ color: t.warnInk, marginTop: 4 }}>
          ⚠ {o.warning}
        </Txt>
      ) : null}
    </Pressable>
  );
}
