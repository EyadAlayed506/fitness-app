import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CM_PER_IN, KG_PER_LB, dayList, round } from "@/lib/format";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/lib/theme";
import type { Profile, UnitSystem } from "@/lib/types";

import { DayPicker } from "./DayPicker";

import { Button, Card, Chips, ErrorText, Field, Row, Txt, type Choice } from "./ui";

const ACTIVITY: Choice<string>[] = [
  { value: "sedentary", label: "Sedentary", hint: "Desk job, little exercise" },
  { value: "light", label: "Light", hint: "Exercise 1–3 days a week" },
  { value: "moderate", label: "Moderate", hint: "Exercise 3–5 days a week" },
  { value: "active", label: "Active", hint: "Hard exercise 6–7 days a week" },
  { value: "very_active", label: "Very active", hint: "Physical job plus training" },
];
const GOALS: Choice<string>[] = [
  { value: "auto", label: "Decide from my BMI" },
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain weight" },
];
const DIETS: Choice<string>[] = [
  { value: "light", label: "Light", hint: "Small change, easy to keep" },
  { value: "normal", label: "Normal", hint: "Steady progress" },
  { value: "extreme", label: "Extreme", hint: "Fastest, hardest to keep" },
];
const EQUIPMENT: Choice<string>[] = [
  { value: "gym", label: "Gym", hint: "Machines and free weights" },
  { value: "home", label: "Home", hint: "Dumbbells" },
  { value: "bodyweight", label: "Bodyweight", hint: "No equipment" },
];

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

  const switchUnits = (next: UnitSystem) => {
    if (next === unitSystem) return;
    const h = num(height);
    const w = num(weight);
    const toImperial = next === "imperial";
    if (!Number.isNaN(h)) setHeight(String(round(toImperial ? h / CM_PER_IN : h * CM_PER_IN, 1)));
    if (!Number.isNaN(w)) setWeight(String(round(toImperial ? w / KG_PER_LB : w * KG_PER_LB, 1)));
    setUnitSystem(next);
  };

  /** What's wrong with each part, or null when it's fine. */
  const problems = {
    about: (() => {
      const y = Number(year);
      const m = Number(month);
      const d = Number(day);
      const date = new Date(y, m - 1, d);
      if (!y || !m || !d || date.getMonth() !== m - 1 || date.getDate() !== d || year.length !== 4)
        return "Enter a valid birth date (day, month and a 4-digit year).";
      return null;
    })(),
    body: Number.isNaN(num(height)) || Number.isNaN(num(weight)) ? "Enter your height and weight." : null,
    goal: null as string | null,
    training: days.length === 0 ? "Pick at least one day you can train." : null,
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
    problems,
    payload,
  };
}

export type ProfileDraft = ReturnType<typeof useProfileDraft>;

/** Save the draft; refreshes the login state and every cached screen (calories and the plan change). */
export async function saveProfile(draft: ProfileDraft, refresh: () => Promise<void>): Promise<string | null> {
  const problem = draft.problems.about ?? draft.problems.body ?? draft.problems.training;
  if (problem) return problem;
  try {
    await api("/me/profile", { method: "PUT", body: draft.payload() });
    await refresh();
    queryClient.invalidateQueries();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------- the parts ----------

export function AboutFields({ draft }: { draft: ProfileDraft }) {
  return (
    <>
      <Chips
        label="Units"
        value={draft.unitSystem}
        onChange={draft.switchUnits}
        options={[
          { value: "metric", label: "kg · cm" },
          { value: "imperial", label: "lb · in" },
        ]}
      />
      <Txt variant="label" style={{ marginTop: 10 }}>
        Birth date
      </Txt>
      <Row>
        <Field placeholder="Day" value={draft.day} onChangeText={draft.setDay} keyboardType="number-pad" maxLength={2} style={{ flex: 1, marginTop: 4 }} accessibilityLabel="Birth day" />
        <Field placeholder="Month" value={draft.month} onChangeText={draft.setMonth} keyboardType="number-pad" maxLength={2} style={{ flex: 1, marginTop: 4 }} accessibilityLabel="Birth month" />
        <Field placeholder="Year" value={draft.year} onChangeText={draft.setYear} keyboardType="number-pad" maxLength={4} style={{ flex: 1.4, marginTop: 4 }} accessibilityLabel="Birth year" />
      </Row>
      <Chips
        label="Sex"
        value={draft.sex}
        onChange={draft.setSex}
        options={[
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
        ]}
      />
    </>
  );
}

export function BodyFields({ draft }: { draft: ProfileDraft }) {
  return (
    <>
      <Row>
        <Field label="Height" suffix={draft.imperial ? "in" : "cm"} value={draft.height} onChangeText={draft.setHeight} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Weight" suffix={draft.imperial ? "lb" : "kg"} value={draft.weight} onChangeText={draft.setWeight} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Chips label="Activity level" value={draft.activity} onChange={draft.setActivity} options={ACTIVITY} />
    </>
  );
}

export function GoalFields({ draft }: { draft: ProfileDraft }) {
  return (
    <>
      <Chips label="Goal" value={draft.goal} onChange={draft.setGoal} options={GOALS} />
      <Chips label="Diet" value={draft.diet} onChange={draft.setDiet} options={DIETS} />
    </>
  );
}

export function TrainingFields({ draft }: { draft: ProfileDraft }) {
  const t = useTheme();
  const profile = draft.profile;
  return (
    <>
      {profile && !profile.training_days_chosen ? (
        <Txt variant="small" style={{ marginTop: 8, color: t.warnInk }}>
          Your plan was using {dayList(profile.training_days)}, filled in automatically. Pick the days you actually train.
        </Txt>
      ) : null}
      <DayPicker value={draft.days} onChange={draft.setDays} />
      <Chips
        label="Minutes per session"
        value={draft.minutes}
        onChange={draft.setMinutes}
        options={[20, 30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m}` }))}
      />
      <Chips label="Equipment" value={draft.equipment} onChange={draft.setEquipment} options={EQUIPMENT} />
    </>
  );
}

/** Every part on one screen (Profile). */
export function ProfileForm({ profile, onSaved }: { profile: Profile | null; onSaved: () => void }) {
  const { refresh } = useAuth();
  const draft = useProfileDraft(profile);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const problem = await saveProfile(draft, refresh);
    if (problem) setError(problem);
    else onSaved();
  };
  return (
    <View>
      <Card>
        <Txt variant="h3">About you</Txt>
        <AboutFields draft={draft} />
        <BodyFields draft={draft} />
      </Card>
      <Card>
        <Txt variant="h3">Your goal</Txt>
        <GoalFields draft={draft} />
      </Card>
      <Card>
        <Txt variant="h3">Training availability</Txt>
        <TrainingFields draft={draft} />
      </Card>
      <ErrorText message={error} />
      <Button title={profile ? "Save changes" : "See my plan"} onPress={save} style={{ marginTop: 16 }} />
    </View>
  );
}
