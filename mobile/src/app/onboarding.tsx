import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AboutFields, BodyFields, GoalFields, TrainingFields, saveProfile, useProfileDraft } from "@/components/ProfileForm";
import { Badge, Button, Card, ErrorText, LinkButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEEKDAYS_SHORT, cap, fmt, units } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { PlanPreview } from "@/lib/types";

const STEPS = [
  { key: "about", title: "About you", text: "Your age and sex set your resting calories." },
  { key: "body", title: "Your body", text: "Height and weight give your BMI; activity sets your daily calories." },
  { key: "goal", title: "Your goal", text: "Lose, keep or gain weight, and how fast." },
  { key: "training", title: "Training", text: "The days you can train shape your weekly plan." },
] as const;

const BMI_TONE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" } as const;

/** Setting up the profile in four short steps, with the plan updating live as you answer. */
export default function Onboarding() {
  const t = useTheme();
  const { token, logout, refresh } = useAuth();
  const draft = useProfileDraft(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // the plan preview: only once the numbers it needs are filled in, and not on every keystroke
  const ready = !draft.problems.about && !draft.problems.body;
  const body = useDebounced(ready ? JSON.stringify(draft.payload()) : null, 350);
  const preview = useQuery({
    queryKey: ["plan-preview", body],
    queryFn: () => api<PlanPreview>("/me/plan/preview", { method: "POST", body: JSON.parse(body!) }),
    enabled: !!token && body != null,
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (!token) return <Redirect href="/login" />;

  const current = STEPS[step];
  const problem = draft.problems[current.key];
  const next = async () => {
    setError(null);
    if (problem) {
      setError(problem);
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    const failed = await saveProfile(draft, refresh);
    if (failed) setError(failed);
    else router.replace("/home");
  };

  return (
    <Screen title={current.title} subtitle={`STEP ${step + 1} OF ${STEPS.length}`} right={<LinkButton title="Log out" onPress={logout} />}>
      <View style={{ flexDirection: "row", gap: 4, marginTop: -space.sm, marginBottom: space.md }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <View key={s.key} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: i <= step ? t.ink : t.surface2 }} />
        ))}
      </View>
      <Txt variant="small" style={{ marginBottom: space.md }}>
        {current.text}
      </Txt>

      <Card>
        {current.key === "about" ? <AboutFields draft={draft} /> : null}
        {current.key === "body" ? <BodyFields draft={draft} /> : null}
        {current.key === "goal" ? <GoalFields draft={draft} /> : null}
        {current.key === "training" ? <TrainingFields draft={draft} /> : null}
      </Card>

      {step > 0 && ready ? <PlanPreviewCard data={preview.data ?? null} loading={preview.isFetching} showRoutine={current.key === "training" && draft.days.length > 0} imperial={draft.imperial} /> : null}

      <ErrorText message={error} />
      <Row style={{ marginTop: space.lg }}>
        {step > 0 ? (
          <Button
            title="Back"
            kind="soft"
            icon="chevron-back"
            onPress={() => {
              setError(null);
              setStep(step - 1);
            }}
          />
        ) : null}
        <Button
          title={step < STEPS.length - 1 ? "Next" : "See my plan"}
          icon={step < STEPS.length - 1 ? "arrow-forward" : "checkmark"}
          onPress={next}
          style={{ flex: 1 }}
        />
      </Row>
    </Screen>
  );
}

/** "≈ 2,436 kcal a day · BMI 28.4": what the answers so far add up to. */
function PlanPreviewCard({
  data,
  loading,
  showRoutine,
  imperial,
}: {
  data: PlanPreview | null;
  loading: boolean;
  showRoutine: boolean;
  imperial: boolean;
}) {
  const t = useTheme();
  const u = units(imperial ? "imperial" : "metric");
  if (!data)
    return (
      <Card style={{ gap: space.sm }}>
        <Skeleton width="35%" height={12} />
        <Skeleton width="60%" height={26} />
      </Card>
    );
  const { plan, routine } = data;
  return (
    <Card style={{ backgroundColor: t.surface2, shadowOpacity: 0, opacity: loading ? 0.7 : 1 }}>
      <Txt variant="label">Your plan so far</Txt>
      <Row style={{ alignItems: "baseline", marginTop: space.xs, flexWrap: "wrap" }} gap={space.sm}>
        <Txt variant="big">{fmt(plan.target_calories)}</Txt>
        <Txt variant="small">kcal a day</Txt>
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
        <Txt variant="small">BMI {plan.bmi.toFixed(1)}</Txt>
        <Badge label={cap(plan.bmi_category)} tone={BMI_TONE[plan.bmi_category]} />
      </Row>
      <Txt variant="small" style={{ marginTop: space.xs }}>
        {plan.direction === "maintain"
          ? "In the healthy range: the plan keeps your weight steady."
          : `${plan.direction === "lose" ? "Lose" : "Gain"} ${u.weight(Math.abs(plan.weight_change_kg))} to reach a BMI of 22.`}
      </Txt>
      {showRoutine ? (
        <View style={{ marginTop: space.md }}>
          <Txt style={{ fontWeight: "600" }}>
            {routine.split} · {routine.days_per_week} {routine.days_per_week === 1 ? "day" : "days"} a week
          </Txt>
          <Txt variant="small">{routine.days.map((d) => `${WEEKDAYS_SHORT[d.weekday_index]} ${d.title}`).join(" · ")}</Txt>
        </View>
      ) : null}
      <Txt variant="tiny" style={{ marginTop: space.sm }}>
        {plan.disclaimer}
      </Txt>
    </Card>
  );
}

/** The value, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
