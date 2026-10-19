import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FirstWeek } from "@/components/FirstWeek";
import { MacroBars } from "@/components/MacroBars";
import { PointsCard } from "@/components/PointsParts";
import { goalHours } from "@/components/SleepDashboard";
import { SleepForm, qualityLabel, rangeBadge, trackerSummary } from "@/components/SleepParts";
import { TodayCard } from "@/components/TodayCard";
import {
  Badge,
  Button,
  Card,
  ErrorText,
  FadeIn,
  Field,
  ProgressRing,
  Row,
  Screen,
  Section,
  Sheet,
  Skeleton,
  Stat,
  Txt,
  useToast,
  type IconName,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useProfile } from "@/lib/auth";
import {
  useFoodDay,
  useGettingStarted,
  usePoints,
  useRecommendations,
  useSleepAnalytics,
  useSleepList,
  useWhoopAutoSync,
  useWhoopStatus,
} from "@/lib/data";
import { cap, clockOf, fmt, hoursMinutes, shortDate, todayISO, trackerName, units } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useHealthConnectAutoSync, useHealthConnectStatus } from "@/lib/healthConnect";
import { profilePayload } from "@/lib/profile";
import { derivedKeys, errorMessage, invalidate, qk, useRefreshOnFocus } from "@/lib/query";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { DietOption, Plan } from "@/lib/types";

const BMI_BADGE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" } as const;
const SCALE_MIN = 15;
const SCALE_MAX = 40;

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const t = useTheme();
  const toast = useToast();
  const { refresh, user } = useAuth();
  const { profile, plan } = useProfile();
  const u = units(profile.unit_system);
  const foodDay = useFoodDay(todayISO());
  const sleepList = useSleepList(1);
  const sleepStatsQuery = useSleepAnalytics(7);
  const recommendations = useRecommendations();
  const pointsQuery = usePoints();
  const whoop = useWhoopStatus();
  const gettingStarted = useGettingStarted();
  const healthConnect = useHealthConnectStatus();
  useRefreshOnFocus([qk.foodDay(todayISO()), qk.sleep, qk.recommendations, qk.points, qk.whoop, qk.gettingStarted]);
  useWhoopAutoSync(!!whoop.data?.connected, 30);
  useHealthConnectAutoSync(!!healthConnect.data?.connected, 30);
  const [loggingSleep, setLoggingSleep] = useState(false);
  const [weight, setWeight] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const day = foodDay.data ?? null;
  const lastSleep = sleepList.data?.[0] ?? null;
  const sleepStats = sleepStatsQuery.data ?? null;
  const today = recommendations.data ?? null;
  const points = pointsQuery.data ?? null;
  const trackerConnected = !!whoop.data?.connected || !!healthConnect.data?.connected;
  const loaded = !foodDay.isPending && !sleepList.isPending;
  const error = errorMessage(foodDay.error ?? sleepList.error);
  const load = async () => {
    await Promise.all([foodDay.refetch(), sleepList.refetch(), sleepStatsQuery.refetch(), recommendations.refetch(), pointsQuery.refetch(), gettingStarted.refetch()]);
  };
  // A new user sees a short checklist instead of cards with nothing in them yet
  const start = gettingStarted.data;
  const checklist = start && start.days_since_signup < 14 && !(start.weighed_in && start.logged_food && start.finished_workout && start.sleep_goal_set) ? start : null;

  const pickDiet = async (o: DietOption) => {
    if (o.selected || o.option === "maintain") return;
    await api("/me/profile", { method: "PUT", body: profilePayload(profile, { diet_option: o.option }) });
    await refresh();
    invalidate(qk.foodDay(todayISO()), ...derivedKeys);
    toast(`Switched to the ${o.option} diet`);
  };

  const saveWeight = async () => {
    const v = Number(weight.replace(",", "."));
    if (!v) return;
    await api("/me/weight", { method: "POST", body: { weight: v, unit: u.w } });
    setWeight("");
    await refresh();
    invalidate(...derivedKeys);
    haptics.success();
    toast("Weight saved");
  };

  const eaten = day?.totals.calories ?? 0;
  const target = plan.target_calories;
  const change = plan.weight_change_kg;
  const left = target - eaten;
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <Screen
      title={greeting()}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}
      right={
        <Pressable
          onPress={() => router.push("/profile")}
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          hitSlop={4}
          style={({ pressed }) => [
            { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: t.ink, alignItems: "center", justifyContent: "center" },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={[typeScale.bodyStrong, { color: t.inkText }]}>{initial}</Text>
        </Pressable>
      }
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await Promise.all([refresh(), load()]).catch(() => {});
        setRefreshing(false);
      }}
    >
      {error ? (
        <Card>
          <ErrorText message={error} />
          <Button title="Try again" kind="soft" small onPress={load} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
        </Card>
      ) : null}

      {!loaded ? (
        <HomeSkeleton />
      ) : (
        <FadeIn>
          {today ? <TodayCard data={today} /> : null}
          {checklist ? <FirstWeek data={checklist} /> : null}

          {/* Calories: a ring for the headline number, macros beside it */}
          <Card onPress={() => router.push("/food")}>
            <Row style={{ justifyContent: "space-between", marginBottom: space.md }}>
              <Txt variant="h3">Calories</Txt>
              <Ionicons name="chevron-forward" size={18} color={t.muted} />
            </Row>
            <Row gap={space.lg + 4} style={{ alignItems: "center" }}>
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
                {day ? <MacroBars totals={day.totals} targetKcal={target} stacked /> : null}
                <Txt variant="tiny" style={{ marginTop: space.md }}>
                  {fmt(eaten)} eaten · {fmt(target)} target
                </Txt>
              </View>
            </Row>
          </Card>

          {/* Sleep (new users without any nights see the checklist instead) */}
          {checklist && !lastSleep ? null : (
            <Card>
              <Pressable onPress={() => router.push("/sleep")} accessibilityRole="button" accessibilityLabel="Open sleep">
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt variant="h3">Sleep</Txt>
                  <Ionicons name="chevron-forward" size={18} color={t.muted} />
                </Row>
                {lastSleep ? (
                  <>
                    <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: space.sm, flexWrap: "wrap" }}>
                      <Txt>
                        <Txt variant="big">{hoursMinutes(lastSleep.duration_minutes)}</Txt>
                        <Txt variant="small">
                          {"  "}
                          {lastSleep.date === todayISO() ? "last night" : `night to ${shortDate(lastSleep.date)}`}
                        </Txt>
                      </Txt>
                      <Row gap={6}>
                        {lastSleep.source !== "manual" ? <Badge label={trackerName(lastSleep.source) ?? ""} tone="info" /> : null}
                        {lastSleep.quality ? <Badge label={qualityLabel(lastSleep.quality) ?? ""} /> : null}
                      </Row>
                    </Row>
                    <Txt variant="small" style={{ marginTop: 2 }}>
                      {clockOf(lastSleep.bedtime)} → {clockOf(lastSleep.wake_time)}
                      {lastSleep.source !== "manual" && trackerSummary(lastSleep) ? ` · ${trackerSummary(lastSleep)}` : ""}
                    </Txt>
                    {sleepStats?.average_hours_7d != null ? (
                      <Row style={{ justifyContent: "space-between", marginTop: space.md, gap: space.sm }}>
                        <Txt variant="tiny" style={{ flex: 1 }}>
                          7-day average {hoursMinutes(sleepStats.average_hours_7d * 60)} · goal {goalHours(sleepStats.goal_minutes)}
                        </Txt>
                        {rangeBadge(sleepStats.average_hours_7d, sleepStats.recommended_hours)}
                      </Row>
                    ) : null}
                  </>
                ) : (
                  <Txt variant="small" style={{ marginTop: space.sm }}>
                    No sleep logged yet. Add last night by hand, or connect a tracker to import it automatically.
                  </Txt>
                )}
              </Pressable>
              {trackerConnected ? null : (
                <Row style={{ marginTop: space.lg }}>
                  <Button title="Log sleep" icon="moon" kind="soft" small onPress={() => setLoggingSleep(true)} style={{ flex: 1 }} />
                  <Button title="Connect a tracker" kind="ghost" small onPress={() => router.push("/sleep")} style={{ flex: 1 }} />
                </Row>
              )}
            </Card>
          )}
          <Sheet visible={loggingSleep} title="Log sleep" onClose={() => setLoggingSleep(false)}>
            {loggingSleep ? (
              <SleepForm
                onSaved={async (message) => {
                  setLoggingSleep(false);
                  toast(message);
                  invalidate(qk.sleep, ...derivedKeys);
                }}
              />
            ) : null}
          </Sheet>

          {points && !(checklist && points.total === 0) ? <PointsCard data={points} /> : null}

          <Shortcut
            icon="chatbubble-ellipses"
            title="Ask your coach"
            text="Questions, or “log a banana for breakfast”"
            onPress={() => router.push("/coach")}
          />

          <Section title="Weigh-in" />
          <Card>
            <Row style={{ alignItems: "flex-end" }}>
              <Field
                label={`Today's weight · last ${u.weight(profile.weight_kg)}`}
                placeholder={u.w === "kg" ? "e.g. 72.5" : "e.g. 160"}
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                suffix={u.w}
                style={{ flex: 1, marginTop: 0 }}
                accessibilityLabel="Today's weight"
                onSubmitEditing={saveWeight}
              />
              <Button title="Save" onPress={saveWeight} disabled={!weight.trim()} />
            </Row>
          </Card>

          <Section title="Your plan" />
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="h3">Body mass index</Txt>
              <Badge label={cap(plan.bmi_category)} tone={BMI_BADGE[plan.bmi_category]} />
            </Row>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: space.sm }}>
              <Txt variant="big">{plan.bmi.toFixed(1)}</Txt>
              <View style={{ alignItems: "flex-end" }}>
                <Txt variant="small">
                  {u.weight(profile.weight_kg)} · {u.length(profile.height_cm, u.imperial ? 1 : 0)}
                </Txt>
                <Txt variant="small">Age {plan.age}</Txt>
              </View>
            </Row>
            <BmiScale bmi={plan.bmi} />
            <Txt variant="small" style={{ marginTop: space.md, color: t.text }}>
              {plan.direction === "maintain" ? (
                "You are in the healthy range. Your plan keeps your weight steady."
              ) : (
                <>
                  {change < 0 ? "Lose " : "Gain "}
                  <Txt variant="small" style={{ fontWeight: "700", color: t.text }}>
                    {u.weight(Math.abs(change))}
                  </Txt>{" "}
                  to reach the optimal BMI of 22 (
                  <Txt variant="small" style={{ fontWeight: "700", color: t.text }}>
                    {u.weight(plan.optimal_weight_kg)}
                  </Txt>
                  ).
                </>
              )}
            </Txt>
            <Txt variant="tiny" style={{ marginTop: space.xs }}>
              Healthy weight for your height: {u.weight(plan.healthy_weight_min_kg)} – {u.weight(plan.healthy_weight_max_kg)}
              {plan.change_to_healthy_range_kg !== 0
                ? ` · smallest step into the range: ${u.weightDelta(plan.change_to_healthy_range_kg)}`
                : ""}
            </Txt>
          </Card>

          <Card>
            <Txt variant="h3">Daily calories</Txt>
            <Row style={{ marginTop: space.md }}>
              <Stat label="Resting (BMR)" value={fmt(plan.bmr)} />
              <Stat label="Maintenance" value={fmt(plan.tdee)} />
              <Stat label="Your target" value={fmt(plan.target_calories)} />
            </Row>
            <Txt variant="small" style={{ marginTop: space.lg, marginBottom: space.sm }}>
              {plan.direction === "maintain"
                ? "Eat about your maintenance calories to keep your weight."
                : `How fast do you want to ${plan.direction} weight? Eating exactly this many calories a day:`}
            </Txt>
            <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
              {plan.options.map((o) => (
                <DietOptionRow key={o.option} option={o} plan={plan} onPress={() => pickDiet(o)} />
              ))}
            </View>
            <Txt variant="tiny" style={{ marginTop: space.md }}>
              {plan.disclaimer} 1 kg of body fat ≈ 7,700 kcal.
            </Txt>
          </Card>
        </FadeIn>
      )}
    </Screen>
  );
}

function HomeSkeleton() {
  return (
    <View accessibilityLabel="Loading today">
      <Card>
        <Row gap={space.md}>
          <Skeleton width={40} height={40} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="30%" height={10} />
            <Skeleton width="65%" height={18} />
          </View>
        </Row>
        <Skeleton height={12} style={{ marginTop: space.lg }} />
        <Skeleton height={50} style={{ marginTop: space.lg, borderRadius: radius.md }} />
      </Card>
      <Card>
        <Row gap={space.lg}>
          <Skeleton width={112} height={112} style={{ borderRadius: radius.pill }} />
          <View style={{ flex: 1, gap: space.lg }}>
            <Skeleton height={8} />
            <Skeleton height={8} />
            <Skeleton height={8} />
          </View>
        </Row>
      </Card>
      <Card>
        <Skeleton width="25%" height={14} />
        <Skeleton width="45%" height={26} style={{ marginTop: space.md }} />
      </Card>
    </View>
  );
}

function Shortcut({ icon, title, text, onPress }: { icon: IconName; title: string; text: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card onPress={onPress}>
      <Row gap={space.md}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={19} color={t.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontWeight: "600" }}>{title}</Txt>
          <Txt variant="small" numberOfLines={1}>
            {text}
          </Txt>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Row>
    </Card>
  );
}

function BmiScale({ bmi }: { bmi: number }) {
  const t = useTheme();
  // status colours: under / healthy / over / obese, each labelled by the badge and the numbers below
  const zones = [
    { from: 15, to: 18.5, color: t.series[0] },
    { from: 18.5, to: 25, color: t.good },
    { from: 25, to: 30, color: t.warn },
    { from: 30, to: 40, color: t.critical },
  ];
  const pos = (v: number) => ((Math.min(Math.max(v, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return (
    <View style={{ marginTop: space.lg }} accessibilityLabel={`BMI scale, your BMI is ${bmi}`}>
      <View style={{ flexDirection: "row", height: 6, borderRadius: 99, overflow: "hidden", gap: 2 }}>
        {zones.map((z) => (
          <View key={z.from} style={{ flex: z.to - z.from, backgroundColor: z.color, opacity: 0.85 }} />
        ))}
      </View>
      <View
        style={{
          position: "absolute",
          top: -5,
          left: `${pos(bmi)}%`,
          width: 16,
          height: 16,
          marginLeft: -8,
          borderRadius: 8,
          backgroundColor: t.surface,
          borderWidth: 3,
          borderColor: t.text,
        }}
      />
      <View style={{ height: 16, marginTop: 8 }}>
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

function DietOptionRow({ option: o, plan, onPress }: { option: DietOption; plan: Plan; onPress: () => void }) {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const selected = o.option === "maintain" || o.selected;
  const sign = o.difference > 0 ? "+" : "−";
  return (
    <Pressable
      onPress={onPress}
      disabled={o.option === "maintain"}
      accessibilityRole="radio"
      aria-checked={selected}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        borderWidth: 1.5,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: selected ? t.accentSoft : "transparent",
        borderRadius: radius.md,
        padding: space.md,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          marginTop: 2,
          borderWidth: selected ? 5 : 1.5,
          borderColor: selected ? t.accent : t.muted,
          backgroundColor: t.surface,
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt style={{ fontWeight: "600" }}>{cap(o.option)}</Txt>
          <Txt style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{fmt(o.calories)} kcal</Txt>
        </Row>
        <Txt variant="small" style={{ marginTop: 2 }}>
          {o.option === "maintain"
            ? "Same as your maintenance calories"
            : `${sign}${fmt(Math.abs(o.difference))} kcal/day · ${plan.direction} ~${u.weight(Math.abs(o.weekly_change_kg), 2)}/week${
                o.weeks_to_target != null ? ` · goal in ~${fmt(o.weeks_to_target)} weeks` : ""
              }`}
        </Txt>
        {o.warning ? (
          <Row gap={6} style={{ marginTop: space.xs, alignItems: "flex-start" }}>
            <Ionicons name="warning" size={14} color={t.warnInk} style={{ marginTop: 2 }} />
            <Txt variant="small" style={{ color: t.warnInk, flex: 1 }}>
              {o.warning}
            </Txt>
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}
