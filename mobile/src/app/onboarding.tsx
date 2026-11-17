import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AboutFields, BodyFields, GoalFields, TrainingFields, saveProfile, useProblemText, useProfileDraft, type SaveProblem } from "@/components/ProfileForm";
import { Badge, Button, Card, ErrorText, LinkButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEEKDAYS_SHORT, fmt, units } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { radius, space, useTheme } from "@/lib/theme";
import type { PlanPreview } from "@/lib/types";

const STEPS = [
  { key: "about", title: "onboarding.about", text: "onboarding.aboutText" },
  { key: "body", title: "onboarding.body", text: "onboarding.bodyText" },
  { key: "goal", title: "onboarding.goal", text: "onboarding.goalText" },
  { key: "training", title: "onboarding.training", text: "onboarding.trainingText" },
] as const satisfies readonly { key: string; title: MessageKey; text: MessageKey }[];

const BMI_TONE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" } as const;

/** Setting up the profile in four short steps, with the plan updating live as you answer. */
export default function Onboarding() {
  const t = useTheme();
  const { token, logout, refresh } = useAuth();
  const { t: tr } = useI18n();
  const problemText = useProblemText();
  const draft = useProfileDraft(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<SaveProblem | null>(null);

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
      setError({ key: problem });
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
    <Screen
      title={tr(current.title)}
      subtitle={tr("onboarding.step", { n: step + 1, total: STEPS.length }).toLocaleUpperCase()}
      right={<LinkButton title={tr("common.logout")} onPress={logout} />}
    >
      <View style={{ flexDirection: "row", gap: 4, marginTop: -space.sm, marginBottom: space.md }} accessibilityLabel={tr("onboarding.step", { n: step + 1, total: STEPS.length })}>
        {STEPS.map((s, i) => (
          <View key={s.key} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: i <= step ? t.ink : t.surface2 }} />
        ))}
      </View>
      <Txt variant="small" style={{ marginBottom: space.md }}>
        {tr(current.text)}
      </Txt>

      <Card>
        {current.key === "about" ? <AboutFields draft={draft} /> : null}
        {current.key === "body" ? <BodyFields draft={draft} /> : null}
        {current.key === "goal" ? <GoalFields draft={draft} /> : null}
        {current.key === "training" ? <TrainingFields draft={draft} /> : null}
      </Card>

      {step > 0 && ready ? <PlanPreviewCard data={preview.data ?? null} loading={preview.isFetching} showRoutine={current.key === "training" && draft.days.length > 0} imperial={draft.imperial} /> : null}

      <ErrorText message={problemText(error)} />
      <Row style={{ marginTop: space.lg }}>
        {step > 0 ? (
          <Button
            title={tr("common.back")}
            kind="soft"
            icon="chevron-back"
            onPress={() => {
              setError(null);
              setStep(step - 1);
            }}
          />
        ) : null}
        <Button
          title={tr(step < STEPS.length - 1 ? "common.next" : "onboarding.seePlan")}
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
  const { t: tr, tn } = useI18n();
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
      <Txt variant="label">{tr("plan.soFar")}</Txt>
      <Row style={{ alignItems: "baseline", marginTop: space.xs, flexWrap: "wrap" }} gap={space.sm}>
        <Txt variant="big">{fmt(plan.target_calories)}</Txt>
        <Txt variant="small">{tr("plan.kcalPerDay")}</Txt>
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
        <Txt variant="small">{tr("plan.bmi", { value: fmt(plan.bmi, 1) })}</Txt>
        <Badge label={tr(`bmi.${plan.bmi_category}`)} tone={BMI_TONE[plan.bmi_category]} />
      </Row>
      <Txt variant="small" style={{ marginTop: space.xs }}>
        {plan.direction === "maintain"
          ? tr("plan.maintain")
          : tr(plan.direction === "lose" ? "plan.lose" : "plan.gain", { weight: u.weight(Math.abs(plan.weight_change_kg)) })}
      </Txt>
      {showRoutine ? (
        <View style={{ marginTop: space.md }}>
          <Txt style={{ fontWeight: "600" }}>
            {/* split and day titles come from the server, in English for now */}
            {routine.split} · {tn("plan.daysPerWeek", routine.days_per_week)}
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
