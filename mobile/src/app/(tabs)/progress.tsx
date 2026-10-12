import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Chart, ChartCard, type ChartSeries } from "@/components/charts";
import { InsightsView } from "@/components/Insights";
import { SleepChart } from "@/components/SleepParts";
import { WeeklySummaryCard } from "@/components/WeeklySummary";
import {
  Button,
  Card,
  Chips,
  EmptyState,
  ErrorText,
  FadeIn,
  Field,
  Row,
  Screen,
  Section,
  Segmented,
  Sheet,
  SkeletonCards,
  Txt,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { fmt, monthLabel, round, shortDate, todayISO, units } from "@/lib/format";
import { errorMessage, invalidate, qk, useRefreshOnFocus } from "@/lib/query";
import { useTheme } from "@/lib/theme";
import type {
  CalorieAnalytics,
  ExerciseProgress,
  MeasurementCompare,
  Projection,
  SeriesData,
  SleepAnalytics,
  WeightAnalytics,
} from "@/lib/types";

interface Data {
  weight: WeightAnalytics;
  projection: Projection;
  calories: CalorieAnalytics;
  volume: { labels: string[]; series: SeriesData[] };
  lifts: { id: number; name: string; sets: number }[];
  compare: MeasurementCompare;
  sleep: SleepAnalytics;
}

type View_ = "week" | "body" | "food" | "strength" | "sleep" | "insights";
const VIEWS: { value: View_; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "body", label: "Body" },
  { value: "food", label: "Food" },
  { value: "strength", label: "Strength" },
  { value: "sleep", label: "Sleep" },
  { value: "insights", label: "Insights" },
];

const hasValues = (series: { data: (number | null)[] }[]) => series.some((s) => s.data.some((v) => v != null && v !== 0));

export default function Progress() {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [chosenLift, setLiftId] = useState<number | null>(null);
  const [months, setMonths] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View_>("week");
  const [refreshing, setRefreshing] = useState(false);

  const loadCompare = (m: string[] | null) =>
    api<MeasurementCompare>(`/measurements/compare${m ? `?months=${m.join(",")}` : ""}`);
  const progress = useQuery({
    queryKey: qk.progress,
    queryFn: async (): Promise<Data> => {
      const [weight, projection, calories, volume, lifts, compare, sleep] = await Promise.all([
        api<WeightAnalytics>("/analytics/weight"),
        api<Projection>("/me/plan/projection"),
        api<CalorieAnalytics>("/analytics/calories"),
        api<Data["volume"]>("/analytics/volume?weeks=8"),
        api<Data["lifts"]>("/analytics/exercises"),
        loadCompare(null),
        api<SleepAnalytics>("/analytics/sleep?days=14"),
      ]);
      return { weight, projection, calories, volume, lifts, compare, sleep };
    },
  });
  // months picked for the measurement comparison (the default pair comes with the rest)
  const comparison = useQuery({
    queryKey: [...qk.progress, "compare", months?.join(",")],
    queryFn: () => loadCompare(months),
    enabled: months != null,
  });
  useRefreshOnFocus([qk.progress]);
  const data = progress.data ?? null;
  const error = errorMessage(progress.error);
  const liftId = chosenLift && data?.lifts.some((l) => l.id === chosenLift) ? chosenLift : (data?.lifts[0]?.id ?? null);
  const liftQuery = useQuery({
    queryKey: qk.lift(liftId ?? 0),
    queryFn: () => api<ExerciseProgress>(`/analytics/exercise/${liftId}`),
    enabled: liftId != null,
  });
  const lift = liftId != null ? (liftQuery.data ?? null) : null;
  const load = async () => {
    await progress.refetch();
  };

  if (!data)
    return (
      <Screen title="Progress">
        {error ? (
          <Card>
            <ErrorText message={error} />
            <Button title="Try again" kind="soft" small onPress={load} style={{ marginTop: 12, alignSelf: "flex-start" }} />
          </Card>
        ) : (
          <SkeletonCards count={3} />
        )}
      </Screen>
    );
  const { weight, projection, calories, volume, lifts } = data;
  const compare = (months != null ? comparison.data : null) ?? data.compare;
  const kg = (vals: (number | null)[]) => vals.map((v) => (v == null ? null : round(u.fromKg(v), 2)));

  // Body weight
  const wLabels = weight.labels.map(shortDate);
  const wSeries: ChartSeries[] = [
    { name: "Weight", data: kg(weight.series[0].data), color: t.series[0], type: "line", dots: weight.labels.length < 40 },
    { name: "7-day average", data: kg(weight.series[1].data), color: t.series[1], type: "line" },
  ];
  if (weight.target_weight_kg) wSeries.push({ name: "Target", data: [round(u.fromKg(weight.target_weight_kg), 1)], color: t.muted, type: "ref" });

  // Projection
  const pLen = projection.labels.length;
  const pSeries: ChartSeries[] = projection.series.map((s, i) => ({
    name: s.name.charAt(0).toUpperCase() + s.name.slice(1),
    data: [...kg(s.data), ...Array(pLen - s.data.length).fill(null)],
    color: t.series[i],
    type: "line",
  }));
  if (pSeries.length) pSeries.push({ name: "Target", data: [round(u.fromKg(projection.target_weight_kg), 1)], color: t.muted, type: "ref" });

  // Calories and macros
  const cLabels = calories.labels.map(shortDate);
  const cSeries: ChartSeries[] = [{ name: "Calories", data: calories.series[0].data, color: t.series[0], type: "bar" }];
  if (calories.target_calories) cSeries.push({ name: "Target", data: [calories.target_calories], color: t.muted, type: "ref" });
  const mSeries: ChartSeries[] = calories.macros.map((m, i) => ({ name: m.name, data: m.data, color: t.series[i], type: "bar" }));

  // Lift progress
  const lSeries: ChartSeries[] = lift
    ? [
        { name: "Estimated 1RM", data: kg(lift.series[0].data), color: t.series[0], type: "line", dots: true },
        { name: "Heaviest set", data: kg(lift.series[1].data), color: t.series[1], type: "line", dots: true },
      ]
    : [];
  const lLabels = lift?.labels.map(shortDate) ?? [];

  // Weekly volume
  const vLabels = volume.labels.map((l) => shortDate(l));
  const vSeries: ChartSeries[] = volume.series.map((s, i) => ({ name: s.name, data: kg(s.data), color: t.series[i], type: "bar" }));

  return (
    <Screen
      title="Progress"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <Segmented options={VIEWS} value={view} onChange={setView} style={{ marginBottom: 16 }} />
      <ErrorText message={error} />

      {view === "week" ? <WeeklySummaryCard /> : null}
      {view === "insights" ? <InsightsView /> : null}

      {view === "body" ? (
        <FadeIn key="body">
          <ChartCard
            title={`Body weight (${u.w})`}
            subtitle="Each weigh-in, the 7-day average and your BMI 22 target"
            empty={!hasValues(wSeries.filter((s) => s.type !== "ref"))}
            emptyText="Log your weight on the Today tab to see the trend."
            table={{ labels: wLabels, series: wSeries }}
          >
            <Chart labels={wLabels} series={wSeries} />
          </ChartCard>

          <ChartCard
            title={`Projected weight (${u.w})`}
            subtitle={projection.note}
            empty={!pSeries.length}
            emptyText="You're at a healthy weight, so there's nothing to project."
            table={{ labels: projection.labels.map(String), series: pSeries }}
          >
            <Chart labels={projection.labels.map(String)} series={pSeries} xTitle="Weeks from today" />
          </ChartCard>

          <Section title="Body measurements" action="Add" onAction={() => setAdding(true)} />
          <Measurements
            compare={compare}
            onAdd={() => setAdding(true)}
            onChangeMonths={setMonths}
          />
        </FadeIn>
      ) : null}

      {view === "food" ? (
        <FadeIn key="food">
          <ChartCard
            title="Calories, last 14 days"
            subtitle="Daily intake against your target"
            empty={!hasValues(cSeries.filter((s) => s.type !== "ref"))}
            emptyText="Log food to see your daily calories."
            table={{ labels: cLabels, series: cSeries, digits: 0 }}
          >
            <Chart labels={cLabels} series={cSeries} digits={0} />
          </ChartCard>

          <ChartCard
            title="Macros, last 14 days (g)"
            empty={!hasValues(mSeries)}
            emptyText="Log food to see your macros."
            table={{ labels: cLabels, series: mSeries, digits: 0 }}
          >
            <Chart labels={cLabels} series={mSeries} stacked digits={0} />
          </ChartCard>
        </FadeIn>
      ) : null}

      {view === "strength" ? (
        <FadeIn key="strength">
          <ChartCard
            title={`Lift progress (${u.w})`}
            subtitle="Estimated 1-rep max (Epley) and heaviest set per workout"
            empty={!lifts.length}
            emptyText="Log a workout to see your strength progress."
            table={{ labels: lLabels, series: lSeries }}
          >
            <Chips
              value={liftId ?? 0}
              onChange={setLiftId}
              options={lifts.slice(0, 6).map((l) => ({ value: l.id, label: l.name }))}
              style={{ marginTop: 4, marginBottom: 6 }}
            />
            {lift && hasValues(lSeries) ? (
              <Chart labels={lLabels} series={lSeries} />
            ) : (
              <Txt variant="small" style={{ paddingVertical: 16, textAlign: "center" }}>
                No sets with weight for this exercise yet.
              </Txt>
            )}
          </ChartCard>

          <ChartCard
            title="Weekly training volume"
            subtitle={`Reps × weight (${u.w}) per body region, weeks starting`}
            empty={!hasValues(vSeries)}
            emptyText="Log workouts to see your weekly volume."
            table={{ labels: vLabels, series: vSeries, digits: 0 }}
          >
            <Chart labels={vLabels} series={vSeries} stacked digits={0} />
          </ChartCard>
        </FadeIn>
      ) : null}

      {view === "sleep" ? (
        <FadeIn key="sleep">
          <SleepChart data={data.sleep} />
        </FadeIn>
      ) : null}

      <Sheet visible={adding} title="Add measurements" onClose={() => setAdding(false)}>
        {adding ? (
          <MeasurementForm
            onSaved={async () => {
              setAdding(false);
              setMonths(null);
              invalidate(qk.progress);
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const SHRINK_IS_GOOD = ["waist_cm", "hips_cm", "neck_cm", "body_fat_pct"];

function Measurements({
  compare,
  onChangeMonths,
  onAdd,
}: {
  compare: MeasurementCompare;
  onChangeMonths: (m: string[]) => void;
  onAdd: () => void;
}) {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  if (!compare.rows.length) {
    return (
      <Card>
        <EmptyState
          icon="resize-outline"
          title="Compare your measurements"
          text={`Add measurements (waist, shoulders…) at least once a month to compare months.${
            compare.available_months.length === 1 ? " You have one month so far." : ""
          }`}
          action="Add measurements"
          onAction={onAdd}
        />
      </Card>
    );
  }
  const [a, b] = compare.months;
  const monthOptions = compare.available_months.map((m) => ({ value: m, label: monthLabel(m) }));
  const val = (field: string, v: number | null) =>
    v == null ? "–" : field === "body_fat_pct" ? fmt(v, 1) : fmt(u.fromCm(v), 1);
  const unitFor = (field: string) => (field === "body_fat_pct" ? "%" : u.l);
  const lengthRows = compare.rows.filter((r) => r.field !== "body_fat_pct");
  const series: ChartSeries[] = [
    { name: monthLabel(a).split(" ")[0], data: lengthRows.map((r) => round(u.fromCm(r.first), 1)), color: t.series[0], type: "bar" },
    { name: monthLabel(b).split(" ")[0], data: lengthRows.map((r) => round(u.fromCm(r.second), 1)), color: t.series[1], type: "bar" },
  ];
  const cell = { flex: 1, textAlign: "right" as const, color: t.text, fontSize: 13, fontVariant: ["tabular-nums" as const] };
  return (
    <Card>
      <Chips label="Compare" value={a} onChange={(m) => onChangeMonths([m, b])} options={monthOptions} />
      <Chips label="with" value={b} onChange={(m) => onChangeMonths([a, m])} options={monthOptions} />
      <View style={{ marginTop: 10 }}>
        <Chart labels={lengthRows.map((r) => r.label)} series={series} />
      </View>
      <Row style={{ paddingVertical: 6, marginTop: 8 }}>
        <Text style={{ flex: 1.2 }} />
        <Text style={[cell, { color: t.text2, fontSize: 12 }]}>{monthLabel(a).split(" ")[0]}</Text>
        <Text style={[cell, { color: t.text2, fontSize: 12 }]}>{monthLabel(b).split(" ")[0]}</Text>
        <Text style={[cell, { color: t.text2, fontSize: 12 }]}>Change</Text>
      </Row>
      {compare.rows.map((r) => {
        const d = r.difference;
        const good = d != null && d !== 0 && d < 0 === SHRINK_IS_GOOD.includes(r.field);
        const color = d == null || d === 0 ? t.text : good ? t.goodInk : t.critical;
        return (
          <Row key={r.field} style={{ paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
            <Text style={{ flex: 1.2, color: t.text, fontSize: 13 }}>{r.label}</Text>
            <Text style={cell}>{val(r.field, r.first)}</Text>
            <Text style={cell}>{val(r.field, r.second)}</Text>
            <Text style={[cell, { color }]}>
              {d == null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${val(r.field, Math.abs(d))} ${unitFor(r.field)}`}
            </Text>
          </Row>
        );
      })}
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        Body fat is estimated with the U.S. Navy formula from waist, neck{profile.sex === "female" ? ", hips" : ""} and height.
      </Txt>
    </Card>
  );
}

const FIELDS: [string, string][] = [
  ["waist_cm", "Waist"],
  ["shoulders_cm", "Shoulders"],
  ["chest_cm", "Chest"],
  ["hips_cm", "Hips"],
  ["neck_cm", "Neck"],
  ["arm_cm", "Arm"],
  ["thigh_cm", "Thigh"],
];

function MeasurementForm({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const body: Record<string, unknown> = { date: todayISO(), unit: u.l };
    for (const [k] of FIELDS) body[k] = values[k] ? Number(values[k].replace(",", ".")) : null;
    try {
      await api("/measurements", { method: "POST", body });
      toast("Measurements saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View>
      <Txt variant="small">Fill in any you have, in {u.l}. Measure in the morning, relaxed, tape snug but not tight.</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8 }}>
        {FIELDS.map(([k, label]) => (
          <Field
            key={k}
            label={label}
            suffix={u.l}
            value={values[k] ?? ""}
            onChangeText={(v) => setValues((old) => ({ ...old, [k]: v }))}
            keyboardType="decimal-pad"
            style={{ width: "48%" }}
          />
        ))}
      </View>
      <ErrorText message={error} />
      <Button title="Save" onPress={save} style={{ marginTop: 16 }} />
    </View>
  );
}
