import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { WEEKDAYS_SHORT, clockOf, hoursMinutes, longDate, parseISO, todayISO } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepNight } from "@/lib/types";

import { Badge, Button, Card, CardHead, Chips, ErrorText, LinkButton, Meter, Row, Stat, Txt } from "./ui";

const sourceBadge = (n: SleepNight) =>
  n.source === "whoop" ? <Badge label="WHOOP" tone="info" /> : <Badge label="Logged by you" />;

/** "8 h" for whole hours, otherwise "7 h 30 min" */
export const goalHours = (m: number) => (m % 60 ? hoursMinutes(m) : `${m / 60} h`);

const weekdayOf = (iso: string) => WEEKDAYS_SHORT[(parseISO(iso).getDay() + 6) % 7];

/** The last `n` nights with their dates. */
function lastNights(data: SleepAnalytics, n = 7) {
  return data.labels.slice(-n).map((date, i) => ({ date, night: data.nights.slice(-n)[i] ?? null }));
}

// ---------- last night against the goal ----------

export function LastNightCard({ data, onEditGoal }: { data: SleepAnalytics; onEditGoal: () => void }) {
  const t = useTheme();
  const today = todayISO();
  const night = data.labels.at(-1) === today ? data.nights.at(-1) ?? null : null;
  const goal = data.goal_minutes;
  const goalText = `${goalHours(goal)} goal${data.goal_custom ? "" : " (recommended for your age)"}`;
  return (
    <Card>
      <CardHead title="Last night" right={night ? sourceBadge(night) : undefined} />
      {night ? (
        <>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap" }}>
            <View style={{ flexShrink: 1 }}>
              <Txt variant="big">{hoursMinutes(night.minutes)}</Txt>
              <Txt variant="small">of your {goalHours(goal)} goal</Txt>
            </View>
            {night.points ? <Badge label="Points earned" tone="good" /> : null}
          </Row>
          <View style={{ marginTop: 8 }}>
            <Meter value={night.minutes} max={goal} color={night.minutes >= goal ? t.good : t.accent} />
          </View>
          <Txt variant="small" style={{ marginTop: 8 }}>
            {night.minutes >= goal
              ? "Goal reached."
              : `${hoursMinutes(goal - night.minutes)} under your goal.`}{" "}
            Bed {clockOf(night.bedtime)} · up {clockOf(night.wake_time)}
            {night.minutes !== night.main_minutes ? ` · includes ${hoursMinutes(night.minutes - night.main_minutes)} of naps` : ""}
          </Txt>
          {night.stages ? <Stages stages={night.stages} /> : null}
          {night.source === "manual" ? (
            <Txt variant="tiny" style={{ marginTop: 6 }}>
              Sleep stages are only shown for nights measured by a tracker.
            </Txt>
          ) : null}
        </>
      ) : (
        <Txt variant="small">Not logged yet. Log last night, or connect WHOOP to bring it in automatically.</Txt>
      )}
      <Row style={{ marginTop: 10, justifyContent: "space-between" }}>
        <Txt variant="tiny" style={{ flex: 1 }}>
          {goalText}
        </Txt>
        <LinkButton title="Change goal" onPress={onEditGoal} />
      </Row>
    </Card>
  );
}

function Stages({ stages }: { stages: NonNullable<SleepNight["stages"]> }) {
  const t = useTheme();
  const parts = [
    { label: "Light", value: stages.light, color: t.series[0] },
    { label: "Deep", value: stages.deep, color: t.series[2] },
    { label: "REM", value: stages.rem, color: t.series[4] },
    { label: "Awake", value: stages.awake, color: t.series[3] },
  ];
  const total = parts.reduce((s, p) => s + (p.value ?? 0), 0);
  if (!total) return null;
  return (
    <View style={{ marginTop: 12 }} accessibilityLabel={`Sleep stages: ${parts.map((p) => `${p.label} ${p.value ?? "unknown"} minutes`).join(", ")}`}>
      <Txt variant="label">Stages (from WHOOP)</Txt>
      <View style={{ flexDirection: "row", height: 12, borderRadius: 99, overflow: "hidden", marginTop: 6, gap: 2 }}>
        {parts.map((p) => (p.value ? <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} /> : null))}
      </View>
      <Row style={{ flexWrap: "wrap", marginTop: 6 }} gap={12}>
        {parts.map((p) => (
          <Row key={p.label} gap={4}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
            <Txt variant="tiny">
              {p.label} {p.value == null ? "–" : hoursMinutes(p.value)}
            </Txt>
          </Row>
        ))}
      </Row>
    </View>
  );
}

// ---------- the last 7 nights against the goal ----------

export function SleepWeekCard({ data }: { data: SleepAnalytics }) {
  const t = useTheme();
  const nights = lastNights(data);
  const goal = data.goal_minutes;
  const scaleMax = Math.max(goal + 120, ...nights.map((n) => n.night?.minutes ?? 0));
  const H = 140;
  const goalY = (goal / scaleMax) * H;
  const color = (n: SleepNight) => (n.source === "whoop" ? t.series[0] : t.series[2]);
  const prev = data.average_hours_prev_7d;
  const avg = data.average_hours_7d;

  return (
    <Card>
      <CardHead title="Last 7 nights" />
      <Row>
        <Stat label="Average" value={avg != null ? hoursMinutes(avg * 60) : "–"} />
        <Stat label="At goal" value={`${data.nights_at_goal_7d} of ${data.nights_logged_7d}`} />
        <Stat label="Week before" value={prev != null ? hoursMinutes(prev * 60) : "–"} />
      </Row>
      <Txt variant="tiny" style={{ marginTop: 4 }}>
        {prev != null && avg != null
          ? `${avg >= prev ? "Up" : "Down"} ${hoursMinutes(Math.abs(avg - prev) * 60)} on average compared with the 7 nights before.`
          : `Comparing weeks needs at least 3 logged nights in each (the week before has ${data.nights_logged_prev_7d}).`}
      </Txt>

      <View style={{ height: H + 20, marginTop: 14 }} accessibilityLabel={`Hours slept, last 7 nights, goal ${goalHours(goal)}`}>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 20 + goalY, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: t.text2 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: H, gap: 6 }}>
          {nights.map(({ date, night }) => (
            <View key={date} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: H }}>
              {night ? (
                <View
                  accessibilityLabel={`${longDate(date)}: ${hoursMinutes(night.minutes)}, ${night.source === "whoop" ? "from WHOOP" : "logged by you"}`}
                  style={{ width: "70%", maxWidth: 28, height: Math.max(4, (night.minutes / scaleMax) * H), backgroundColor: color(night), borderTopLeftRadius: 5, borderTopRightRadius: 5 }}
                />
              ) : (
                <View
                  accessibilityLabel={`${longDate(date)}: not logged`}
                  style={{ width: "70%", maxWidth: 28, height: 26, borderWidth: 1, borderStyle: "dashed", borderColor: t.muted, borderRadius: 5, alignItems: "center", justifyContent: "center" }}
                >
                  <Txt variant="tiny">–</Txt>
                </View>
              )}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 6, height: 20, alignItems: "flex-end" }}>
          {nights.map(({ date }) => (
            <Txt key={date} variant="tiny" style={{ flex: 1, textAlign: "center", fontWeight: date === todayISO() ? "700" : "400" }}>
              {weekdayOf(date)}
            </Txt>
          ))}
        </View>
      </View>
      <Row style={{ marginTop: 8, flexWrap: "wrap" }} gap={12}>
        <Legend color={t.series[0]} label="WHOOP" />
        <Legend color={t.series[2]} label="Logged by you" />
        <Legend color="transparent" dashed label="Not logged" />
        <Row gap={4}>
          <View style={{ width: 14, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: t.text2 }} />
          <Txt variant="tiny">Goal {goalHours(goal)}</Txt>
        </Row>
      </Row>
    </Card>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  const t = useTheme();
  return (
    <Row gap={4}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, borderWidth: dashed ? 1 : 0, borderStyle: "dashed", borderColor: t.muted }} />
      <Txt variant="tiny">{label}</Txt>
    </Row>
  );
}

// ---------- bedtime and wake-up times ----------

const WINDOW = 18 * 60; // the timeline runs from 18:00 to 12:00 the next day

function timelinePos(iso: string, nightDate: string) {
  // minutes after 18:00 on the evening before the morning `nightDate`
  const evening = parseISO(nightDate).getTime() - 6 * 3600_000; // 18:00 the day before
  const [d, time] = [iso.slice(0, 10), iso.slice(11, 16)];
  const [h, m] = time.split(":").map(Number);
  const at = parseISO(d).getTime() + (h * 60 + m) * 60_000;
  return Math.min(WINDOW, Math.max(0, (at - evening) / 60_000));
}

export function SleepConsistencyCard({ data }: { data: SleepAnalytics }) {
  const t = useTheme();
  const nights = lastNights(data);
  const spread = (m: number | null) => (m == null ? null : m < 15 ? "under 15 min" : `about ${hoursMinutes(Math.round(m / 5) * 5)}`);
  const bed = spread(data.bedtime_spread_minutes);
  const wake = spread(data.wake_spread_minutes);
  return (
    <Card>
      <CardHead title="Bedtime and wake-up" />
      <Txt variant="small">
        {bed && wake
          ? `Over the last 7 nights your bedtime varied by ${bed} and your wake-up time by ${wake}.`
          : "Log at least 3 nights to see how much your bedtime and wake-up time vary."}
      </Txt>
      <View style={{ marginTop: 12, gap: 6 }}>
        {nights.map(({ date, night }) => (
          <Row key={date} gap={8}>
            <Txt variant="tiny" style={{ width: 30 }}>
              {weekdayOf(date)}
            </Txt>
            <View style={{ flex: 1, height: 14, borderRadius: 7, backgroundColor: t.surface2, overflow: "hidden" }}>
              {night ? (
                <View
                  accessibilityLabel={`${longDate(date)}: bed ${clockOf(night.bedtime)}, up ${clockOf(night.wake_time)}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${(timelinePos(night.bedtime, date) / WINDOW) * 100}%`,
                    width: `${((timelinePos(night.wake_time, date) - timelinePos(night.bedtime, date)) / WINDOW) * 100}%`,
                    backgroundColor: night.source === "whoop" ? t.series[0] : t.series[2],
                    borderRadius: 7,
                  }}
                />
              ) : null}
            </View>
            <Txt variant="tiny" style={{ width: 82, textAlign: "right" }}>
              {night ? `${clockOf(night.bedtime)}–${clockOf(night.wake_time)}` : "not logged"}
            </Txt>
          </Row>
        ))}
        <Row gap={8}>
          <View style={{ width: 30 }} />
          <Row style={{ flex: 1, justifyContent: "space-between" }}>
            {["18:00", "00:00", "06:00", "12:00"].map((l) => (
              <Txt key={l} variant="tiny">
                {l}
              </Txt>
            ))}
          </Row>
          <View style={{ width: 82 }} />
        </Row>
      </View>
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        Main sleep of each night. Naps aren&apos;t shown here.
      </Txt>
    </Card>
  );
}

// ---------- change the sleep goal ----------

const GOAL_CHOICES = [360, 390, 420, 450, 480, 510, 540, 600];

export function SleepGoalForm({ data, onSaved }: { data: SleepAnalytics; onSaved: (message: string) => void }) {
  const [low] = data.recommended_hours;
  const [value, setValue] = useState<number | "recommended">(data.goal_custom ? data.goal_minutes : "recommended");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api("/me/sleep-goal", { method: "PUT", body: { minutes: value === "recommended" ? null : value } });
      onSaved("Sleep goal saved");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View>
      <Txt variant="small">
        Recommended for your age: {data.recommended_hours[0]}–{data.recommended_hours[1]} h a night. Your goal is used for the
        sleep chart, your points and workout suggestions.
      </Txt>
      <Chips
        label="Goal"
        value={value}
        onChange={setValue}
        options={[
          { value: "recommended" as const, label: `Recommended (${low} h)` },
          ...GOAL_CHOICES.map((m) => ({ value: m, label: goalHours(m) })),
        ]}
      />
      <ErrorText message={error} />
      <Button title="Save goal" onPress={save} style={{ marginTop: 14 }} />
    </View>
  );
}
