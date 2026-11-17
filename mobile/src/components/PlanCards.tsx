import { Pressable, View } from "react-native";

import { api } from "@/lib/api";
import { useAuth, useProfile } from "@/lib/auth";
import { cap, fmt, todayISO, units } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { trOr } from "@/lib/i18n/current";
import { profilePayload } from "@/lib/profile";
import { derivedKeys, invalidate, qk } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { DietOption, Plan } from "@/lib/types";

import { Badge, Card, Icon, Row, Section, Stat, Txt, useToast } from "./ui";

const BMI_BADGE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" } as const;
const SCALE_MIN = 15;
const SCALE_MAX = 40;

/** Your plan: BMI and daily calories, and how fast to lose or gain. Shown on Progress → Body. */
export function PlanCards() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const { refresh } = useAuth();
  const { profile, plan } = useProfile();
  const u = units(profile.unit_system);
  const change = plan.weight_change_kg;

  const pickDiet = async (o: DietOption) => {
    if (o.selected || o.option === "maintain") return;
    await api("/me/profile", { method: "PUT", body: profilePayload(profile, { diet_option: o.option }) });
    await refresh();
    invalidate(qk.foodDay(todayISO()), ...derivedKeys);
    toast(tr("plan.switched", { option: dietName(o.option).toLocaleLowerCase() }));
  };

  return (
    <>
      <Section title={tr("home.yourPlan")} />
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">{tr("plan.bmiTitle")}</Txt>
          <Badge label={tr(`bmi.${plan.bmi_category}`)} tone={BMI_BADGE[plan.bmi_category]} />
        </Row>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: space.sm }}>
          <Txt variant="big">{fmt(plan.bmi, 1)}</Txt>
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="small">
              {u.weight(profile.weight_kg)} · {u.length(profile.height_cm, u.imperial ? 1 : 0)}
            </Txt>
            <Txt variant="small">{tr("plan.age", { n: plan.age })}</Txt>
          </View>
        </Row>
        <BmiScale bmi={plan.bmi} />
        <Txt variant="small" style={{ marginTop: space.md, color: t.text }}>
          {plan.direction === "maintain" ? (
            tr("plan.inRange")
          ) : (
            <>
              {tr(change < 0 ? "plan.loseVerb" : "plan.gainVerb")}
              <Txt variant="small" style={{ fontWeight: "700", color: t.text }}>
                {u.weight(Math.abs(change))}
              </Txt>
              {tr("plan.toOptimal")}
              <Txt variant="small" style={{ fontWeight: "700", color: t.text }}>
                {u.weight(plan.optimal_weight_kg)}
              </Txt>
              ).
            </>
          )}
        </Txt>
        <Txt variant="tiny" style={{ marginTop: space.xs }}>
          {tr("plan.healthyWeight", { min: u.weight(plan.healthy_weight_min_kg), max: u.weight(plan.healthy_weight_max_kg) })}
          {plan.change_to_healthy_range_kg !== 0 ? tr("plan.smallestStep", { delta: u.weightDelta(plan.change_to_healthy_range_kg) }) : ""}
        </Txt>
      </Card>

      <Card>
        <Txt variant="h3">{tr("plan.dailyCalories")}</Txt>
        <Row style={{ marginTop: space.md }}>
          <Stat label={tr("plan.bmr")} value={fmt(plan.bmr)} />
          <Stat label={tr("plan.maintenance")} value={fmt(plan.tdee)} />
          <Stat label={tr("plan.yourTarget")} value={fmt(plan.target_calories)} />
        </Row>
        <Txt variant="small" style={{ marginTop: space.lg, marginBottom: space.sm }}>
          {plan.direction === "maintain"
            ? tr("plan.eatMaintenance")
            : tr(plan.direction === "gain" ? "plan.howFastGain" : "plan.howFastLose")}
        </Txt>
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
          {plan.options.map((o) => (
            <DietOptionRow key={o.option} option={o} plan={plan} onPress={() => pickDiet(o)} />
          ))}
        </View>
        <Txt variant="tiny" style={{ marginTop: space.md }}>
          {plan.disclaimer}
          {tr("plan.kcalRule")}
        </Txt>
      </Card>
    </>
  );
}

function BmiScale({ bmi }: { bmi: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  // status colours: under / healthy / over / obese, each labelled by the badge and the numbers below
  const zones = [
    { from: 15, to: 18.5, color: t.series[0] },
    { from: 18.5, to: 25, color: t.good },
    { from: 25, to: 30, color: t.warn },
    { from: 30, to: 40, color: t.critical },
  ];
  const pos = (v: number) => ((Math.min(Math.max(v, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return (
    // A number line (15 → 40), kept left-to-right in Arabic too: its marker and numbers are placed by `left`
    <View style={{ marginTop: space.lg, direction: "ltr" }} accessibilityLabel={tr("plan.scaleLabel", { bmi: fmt(bmi, 1) })}>
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

/** "Light", "Normal", "Extreme" (or "Maintain") in the current language. */
const dietName = (option: string) => trOr(option === "maintain" ? "goal.maintain" : `diet.${option}`, cap(option));

function DietOptionRow({ option: o, plan, onPress }: { option: DietOption; plan: Plan; onPress: () => void }) {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
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
          <Txt style={{ fontWeight: "600" }}>{dietName(o.option)}</Txt>
          <Txt style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{tr("food.kcal", { n: fmt(o.calories) })}</Txt>
        </Row>
        <Txt variant="small" style={{ marginTop: 2 }}>
          {o.option === "maintain"
            ? tr("plan.sameAsMaintenance")
            : tr(plan.direction === "gain" ? "plan.perDayGain" : "plan.perDayLose", {
                diff: `${sign}${fmt(Math.abs(o.difference))}`,
                weekly: u.weight(Math.abs(o.weekly_change_kg), 2),
              }) + (o.weeks_to_target != null ? tr("plan.goalIn", { weeks: tn("plan.weeks", Math.round(o.weeks_to_target)) }) : "")}
        </Txt>
        {o.warning ? (
          <Row gap={6} style={{ marginTop: space.xs, alignItems: "flex-start" }}>
            <Icon name="warning" size={14} color={t.warnInk} style={{ marginTop: 2 }} />
            <Txt variant="small" style={{ color: t.warnInk, flex: 1 }}>
              {o.warning}
            </Txt>
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}
