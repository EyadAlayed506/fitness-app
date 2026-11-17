import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CM_PER_IN, KG_PER_LB, dayList, round } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/lib/theme";
import type { Profile, UnitSystem } from "@/lib/types";

import { DayPicker } from "./DayPicker";

import { Button, Card, Chips, ErrorText, Field, Row, Txt, type Choice } from "./ui";

// Option labels are dictionary keys; useOptions() turns them into text when shown.
type Option<T extends string | number> = { value: T; label: MessageKey; hint?: MessageKey };
const ACTIVITY: Option<string>[] = [
  { value: "sedentary", label: "activity.sedentary", hint: "activity.sedentaryHint" },
  { value: "light", label: "activity.light", hint: "activity.lightHint" },
  { value: "moderate", label: "activity.moderate", hint: "activity.moderateHint" },
  { value: "active", label: "activity.active", hint: "activity.activeHint" },
  { value: "very_active", label: "activity.veryActive", hint: "activity.veryActiveHint" },
];
const GOALS: Option<string>[] = [
  { value: "auto", label: "goal.auto" },
  { value: "lose", label: "goal.lose" },
  { value: "maintain", label: "goal.maintain" },
  { value: "gain", label: "goal.gain" },
];
const DIETS: Option<string>[] = [
  { value: "light", label: "diet.light", hint: "diet.lightHint" },
  { value: "normal", label: "diet.normal", hint: "diet.normalHint" },
  { value: "extreme", label: "diet.extreme", hint: "diet.extremeHint" },
];
// 0 = no single time: each exercise uses its own suggestion
const REST: Option<number>[] = [
  { value: 0, label: "rest.suggested", hint: "rest.suggestedHint" },
  { value: 60, label: "rest.60" },
  { value: 90, label: "rest.90" },
  { value: 120, label: "rest.120" },
  { value: 180, label: "rest.180" },
];
const EQUIPMENT: Option<string>[] = [
  { value: "gym", label: "equipment.gym", hint: "equipment.gymHint" },
  { value: "home", label: "equipment.home", hint: "equipment.homeHint" },
  { value: "bodyweight", label: "equipment.bodyweight", hint: "equipment.bodyweightHint" },
];

function useOptions() {
  const { t } = useI18n();
  return <T extends string | number>(list: Option<T>[]): Choice<T>[] =>
    list.map((o) => ({ value: o.value, label: t(o.label), hint: o.hint ? t(o.hint) : undefined }));
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

/** The profile being filled in, shared by the Profile screen (all at once) and the setup steps (one part at a time). */
export function useProfileDraft(profile: Profile | null) {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(profile?.unit_system ?? "metric");
  const imperial = unitSystem === "imperial";
  const [birth] = useState(() => (profile?.birth_date ?? "").split("-"));
  const [year, setYear] = useState(birth[0] ?? "");
  const [month, setMonth] = useState(birth[1] ? String(Number(birth[1])) : "");
  const [day, setDay] = useState(birth[2] ? String(Number(birth[2])) : "");
  const [sex, setSex] = useState<string>(profile?.sex ?? "male");
  const [height, setHeight] = useState(profile ? String(round(imperial ? profile.height_cm / CM_PER_IN : profile.height_cm, 1)) : "");
  const [weight, setWeight] = useState(profile ? String(round(imperial ? profile.weight_kg / KG_PER_LB : profile.weight_kg, 1)) : "");
  const [activity, setActivity] = useState(profile?.activity_level ?? "moderate");
  const [goal, setGoal] = useState(profile?.goal ?? "auto");
  const [diet, setDiet] = useState(profile?.diet_option ?? "normal");
  // New users start with no days picked, so the plan never assumes a schedule they didn't choose
  const [days, setDays] = useState<number[]>(profile?.training_days_chosen ? profile.training_days : []);
  const [minutes, setMinutes] = useState(profile?.minutes_per_session ?? 45);
  const [equipment, setEquipment] = useState(profile?.equipment ?? "gym");
  const [rest, setRest] = useState(profile?.rest_seconds ?? 0);

  const switchUnits = (next: UnitSystem) => {
    if (next === unitSystem) return;
    const h = num(height);
    const w = num(weight);
    const toImperial = next === "imperial";
    if (!Number.isNaN(h)) setHeight(String(round(toImperial ? h / CM_PER_IN : h * CM_PER_IN, 1)));
    if (!Number.isNaN(w)) setWeight(String(round(toImperial ? w / KG_PER_LB : w * KG_PER_LB, 1)));
    setUnitSystem(next);
  };

  /** What's wrong with each part (a message key), or null when it's fine. */
  const problems = {
    about: (() => {
      const y = Number(year);
      const m = Number(month);
      const d = Number(day);
      const date = new Date(y, m - 1, d);
      if (!y || !m || !d || date.getMonth() !== m - 1 || date.getDate() !== d || year.length !== 4)
        return "profile.badBirthDate";
      return null;
    })() as MessageKey | null,
    body: (Number.isNaN(num(height)) || Number.isNaN(num(weight)) ? "profile.needBody" : null) as MessageKey | null,
    goal: null as MessageKey | null,
    training: (days.length === 0 ? "profile.needDays" : null) as MessageKey | null,
  };

  /** The body for PUT /me/profile (and the plan preview). */
  const payload = (withDays = true) => ({
    birth_date: `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`,
    sex,
    height: num(height),
    height_unit: imperial ? "in" : "cm",
    weight: num(weight),
    weight_unit: imperial ? "lb" : "kg",
    activity_level: activity,
    goal,
    diet_option: diet,
    ...(withDays && days.length ? { training_days: days } : {}),
    minutes_per_session: minutes,
    equipment,
    unit_system: unitSystem,
    rest_seconds: rest || null,
  });

  return {
    profile,
    imperial,
    unitSystem,
    switchUnits,
    year,
    setYear,
    month,
    setMonth,
    day,
    setDay,
    sex,
    setSex,
    height,
    setHeight,
    weight,
    setWeight,
    activity,
    setActivity,
    goal,
    setGoal,
    diet,
    setDiet,
    days,
    setDays,
    minutes,
    setMinutes,
    equipment,
    setEquipment,
    rest,
    setRest,
    problems,
    payload,
  };
}

export type ProfileDraft = ReturnType<typeof useProfileDraft>;

/** Why saving didn't work: a form problem (message key) or the API error. Kept as-is so it re-translates. */
export type SaveProblem = { key: MessageKey } | { error: unknown };

/** The message for a SaveProblem, in the current language. */
export function useProblemText() {
  const { t, errorText } = useI18n();
  return (p: SaveProblem | null) => (p == null ? null : "key" in p ? t(p.key) : errorText(p.error));
}

/** Save the draft; refreshes the login state and every cached screen (calories and the plan change). */
export async function saveProfile(draft: ProfileDraft, refresh: () => Promise<void>): Promise<SaveProblem | null> {
  const problem = draft.problems.about ?? draft.problems.body ?? draft.problems.training;
  if (problem) return { key: problem };
  try {
    await api("/me/profile", { method: "PUT", body: draft.payload() });
    await refresh();
    queryClient.invalidateQueries();
    return null;
  } catch (e) {
    return { error: e };
  }
}

// ---------- the parts ----------

export function AboutFields({ draft }: { draft: ProfileDraft }) {
  const { t } = useI18n();
  return (
    <>
      <Chips
        label={t("profile.units")}
        value={draft.unitSystem}
        onChange={draft.switchUnits}
        options={[
          { value: "metric", label: t("unit.metric") },
          { value: "imperial", label: t("unit.imperial") },
        ]}
      />
      <Txt variant="label" style={{ marginTop: 10 }}>
        {t("profile.birthDate")}
      </Txt>
      <Row>
        <Field placeholder={t("profile.day")} value={draft.day} onChangeText={draft.setDay} keyboardType="number-pad" maxLength={2} style={{ flex: 1, marginTop: 4 }} accessibilityLabel={t("profile.birthDay")} />
        <Field placeholder={t("profile.month")} value={draft.month} onChangeText={draft.setMonth} keyboardType="number-pad" maxLength={2} style={{ flex: 1, marginTop: 4 }} accessibilityLabel={t("profile.birthMonth")} />
        <Field placeholder={t("profile.year")} value={draft.year} onChangeText={draft.setYear} keyboardType="number-pad" maxLength={4} style={{ flex: 1.4, marginTop: 4 }} accessibilityLabel={t("profile.birthYear")} />
      </Row>
      <Chips
        label={t("profile.sex")}
        value={draft.sex}
        onChange={draft.setSex}
        options={[
          { value: "male", label: t("profile.male") },
          { value: "female", label: t("profile.female") },
        ]}
      />
    </>
  );
}

export function BodyFields({ draft }: { draft: ProfileDraft }) {
  const { t } = useI18n();
  const options = useOptions();
  return (
    <>
      <Row>
        <Field label={t("profile.height")} suffix={t(draft.imperial ? "unit.in" : "unit.cm")} value={draft.height} onChangeText={draft.setHeight} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label={t("profile.weight")} suffix={t(draft.imperial ? "unit.lb" : "unit.kg")} value={draft.weight} onChangeText={draft.setWeight} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Chips label={t("profile.activity")} value={draft.activity} onChange={draft.setActivity} options={options(ACTIVITY)} />
    </>
  );
}

export function GoalFields({ draft }: { draft: ProfileDraft }) {
  const { t } = useI18n();
  const options = useOptions();
  return (
    <>
      <Chips label={t("profile.goal")} value={draft.goal} onChange={draft.setGoal} options={options(GOALS)} />
      <Chips label={t("profile.diet")} value={draft.diet} onChange={draft.setDiet} options={options(DIETS)} />
    </>
  );
}

export function TrainingFields({ draft }: { draft: ProfileDraft }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const options = useOptions();
  const profile = draft.profile;
  return (
    <>
      {profile && !profile.training_days_chosen ? (
        <Txt variant="small" style={{ marginTop: 8, color: t.warnInk }}>
          {tr("profile.autoDays", { days: dayList(profile.training_days) })}
        </Txt>
      ) : null}
      <DayPicker value={draft.days} onChange={draft.setDays} />
      <Chips
        label={tr("profile.minutes")}
        value={draft.minutes}
        onChange={draft.setMinutes}
        options={[20, 30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m}` }))}
      />
      <Chips label={tr("profile.equipment")} value={draft.equipment} onChange={draft.setEquipment} options={options(EQUIPMENT)} />
      <Chips label={tr("profile.rest")} value={draft.rest} onChange={draft.setRest} options={options(REST)} />
      <Txt variant="tiny" style={{ marginTop: 4 }}>
        {tr("profile.restHint")}
      </Txt>
    </>
  );
}

/** Every part on one screen (Profile). */
export function ProfileForm({ profile, onSaved }: { profile: Profile | null; onSaved: () => void }) {
  const { refresh } = useAuth();
  const { t } = useI18n();
  const problemText = useProblemText();
  const draft = useProfileDraft(profile);
  const [error, setError] = useState<SaveProblem | null>(null);
  const save = async () => {
    setError(null);
    const problem = await saveProfile(draft, refresh);
    if (problem) setError(problem);
    else onSaved();
  };
  return (
    <View>
      <Card>
        <Txt variant="h3">{t("onboarding.about")}</Txt>
        <AboutFields draft={draft} />
        <BodyFields draft={draft} />
      </Card>
      <Card>
        <Txt variant="h3">{t("onboarding.goal")}</Txt>
        <GoalFields draft={draft} />
      </Card>
      <Card>
        <Txt variant="h3">{t("profile.availability")}</Txt>
        <TrainingFields draft={draft} />
      </Card>
      <ErrorText message={problemText(error)} />
      <Button title={t(profile ? "profile.saveChanges" : "onboarding.seePlan")} onPress={save} style={{ marginTop: 16 }} />
    </View>
  );
}
