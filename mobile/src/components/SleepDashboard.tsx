import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { WEEKDAYS_MIN, clockOf, hoursMinutes, longDate, parseISO, todayISO, trackerName } from "@/lib/format";
import { useI18n, useLanguageEnd } from "@/lib/i18n";
import { errorTextFor, tr } from "@/lib/i18n/current";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepNight } from "@/lib/types";

import { Badge, Button, Card, CardHead, Chips, ErrorText, LinkButton, Meter, Row, Stat, Txt } from "./ui";

const sourceBadge = (n: SleepNight) =>
  n.source !== "manual" ? <Badge label={trackerName(n.source) ?? ""} tone="info" /> : <Badge label={tr("sleep.byYou")} />;

/** "8 h" for whole hours, otherwise "7 h 30 min" */
export const goalHours = (m: number) => (m % 60 ? hoursMinutes(m) : tr("sleep.hours", { h: m / 60 }));

// narrowest day names: seven columns side by side ("Mon" / "ن")
const weekdayOf = (iso: string) => WEEKDAYS_MIN[(parseISO(iso).getDay() + 6) % 7];

/** The last `n` nights with their dates. */
function lastNights(data: SleepAnalytics, n = 7) {
  return data.labels.slice(-n).map((date, i) => ({ date, night: data.nights.slice(-n)[i] ?? null }));
}

// ---------- last night against the goal ----------

export function LastNightCard({ data, onEditGoal }: { data: SleepAnalytics; onEditGoal: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const today = todayISO();
  const night = data.labels.at(-1) === today ? data.nights.at(-1) ?? null : null;
  const goal = data.goal_minutes;
  const goalText = tr(data.goal_custom ? "sleep.goalText" : "sleep.goalRecommended", { goal: goalHours(goal) });
  return (
    <Card>
      <CardHead title={tr("sleep.lastNightTitle")} right={night ? sourceBadge(night) : undefined} />
      {night ? (
        <>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap" }}>
            <View style={{ flexShrink: 1 }}>
              <Txt variant="big">{hoursMinutes(night.minutes)}</Txt>
              <Txt variant="small">{tr("sleep.ofGoal", { goal: goalHours(goal) })}</Txt>
            </View>
            {night.points ? <Badge label={tr("sleep.pointsEarned")} tone="good" /> : null}
          </Row>
          <View style={{ marginTop: 8 }}>
            <Meter value={night.minutes} max={goal} color={night.minutes >= goal ? t.good : t.accent} />
          </View>
          <Txt variant="small" style={{ marginTop: 8 }}>
            {night.minutes >= goal ? tr("sleep.goalReached") : tr("sleep.under", { d: hoursMinutes(goal - night.minutes) })}{" "}
            {tr("sleep.bedUp", { bed: clockOf(night.bedtime), up: clockOf(night.wake_time) })}
            {night.minutes !== night.main_minutes ? tr("sleep.naps", { d: hoursMinutes(night.minutes - night.main_minutes) }) : ""}
          </Txt>
          {night.stages ? <Stages stages={night.stages} from={trackerName(night.source)} /> : null}
          {night.source === "manual" ? (
            <Txt variant="tiny" style={{ marginTop: 6 }}>
              {tr("sleep.stagesOnlyTracker")}
            </Txt>
          ) : null}
        </>
      ) : (
        <Txt variant="small">{tr("sleep.notLoggedYet")}</Txt>
      )}
      <Row style={{ marginTop: 10, justifyContent: "space-between" }}>
        <Txt variant="tiny" style={{ flex: 1 }}>
          {goalText}
        </Txt>
        <LinkButton title={tr("sleep.changeGoal")} onPress={onEditGoal} />
      </Row>
    </Card>
  );
}

function Stages({ stages, from }: { stages: NonNullable<SleepNight["stages"]>; from: string | null }) {
  const t = useTheme();
  const parts = [
    { label: tr("sleep.light"), value: stages.light, color: t.series[0] },
    { label: tr("sleep.deep"), value: stages.deep, color: t.series[2] },
    { label: tr("sleep.rem"), value: stages.rem, color: t.series[4] },
    { label: tr("sleep.awake"), value: stages.awake, color: t.series[3] },
  ];
  const total = parts.reduce((s, p) => s + (p.value ?? 0), 0);
  if (!total) return null;
  return (
    <View style={{ marginTop: 12 }} accessibilityLabel={tr("sleep.stagesLabel", { list: parts.map((p) => tr("sleep.stageMinutes", { label: p.label, n: p.value ?? tr("sleep.unknown") })).join(tr("list.separator")) })}>
      <Txt variant="label">{from ? tr("sleep.stagesFrom", { tracker: from }) : tr("sleep.stages")}</Txt>
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
  const { t: tr } = useI18n();
  const nights = lastNights(data);
  const goal = data.goal_minutes;
  const scaleMax = Math.max(goal + 120, ...nights.map((n) => n.night?.minutes ?? 0));
  const H = 140;
  const goalY = (goal / scaleMax) * H;
  const color = (n: SleepNight) => (n.source !== "manual" ? t.series[0] : t.series[2]);
  const prev = data.average_hours_prev_7d;
  const avg = data.average_hours_7d;

  return (
    <Card>
      <CardHead title={tr("sleep.last7")} />
      <Row>
        <Stat label={tr("sleep.average")} value={avg != null ? hoursMinutes(avg * 60) : "–"} />
        <Stat label={tr("sleep.atGoal")} value={tr("sleep.atGoalValue", { n: data.nights_at_goal_7d, total: data.nights_logged_7d })} />
        <Stat label={tr("sleep.weekBefore")} value={prev != null ? hoursMinutes(prev * 60) : "–"} />
      </Row>
      <Txt variant="tiny" style={{ marginTop: 4 }}>
        {prev != null && avg != null
          ? tr(avg >= prev ? "sleep.upBy" : "sleep.downBy", { d: hoursMinutes(Math.abs(avg - prev) * 60) })
          : tr("sleep.needs3", { n: data.nights_logged_prev_7d })}
      </Txt>

      <View style={{ height: H + 20, marginTop: 14 }} accessibilityLabel={tr("sleep.chartLabel", { goal: goalHours(goal) })}>
        <View style={{ position: "absolute", start: 0, end: 0, bottom: 20 + goalY, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: t.text2 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: H, gap: 6 }}>
          {nights.map(({ date, night }) => (
            <View key={date} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: H }}>
              {night ? (
                <View
                  accessibilityLabel={tr("sleep.barLabel", {
                    date: longDate(date),
                    duration: hoursMinutes(night.minutes),
                    source: night.source !== "manual" ? tr("sleep.fromTracker", { tracker: trackerName(night.source) ?? "" }) : tr("sleep.byYouLower"),
                  })}
                  style={{ width: "70%", maxWidth: 28, height: Math.max(4, (night.minutes / scaleMax) * H), backgroundColor: color(night), borderTopLeftRadius: 5, borderTopRightRadius: 5 }}
                />
              ) : (
                <View
                  accessibilityLabel={tr("sleep.notLoggedOn", { date: longDate(date) })}
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
        <Legend color={t.series[0]} label={tr("sleep.legendTracker")} />
        <Legend color={t.series[2]} label={tr("sleep.byYou")} />
        <Legend color="transparent" dashed label={tr("sleep.legendNotLogged")} />
        <Row gap={4}>
          <View style={{ width: 14, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: t.text2 }} />
          <Txt variant="tiny">{tr("sleep.goalShort", { goal: goalHours(goal) })}</Txt>
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
  const { t: tr } = useI18n();
  const end = useLanguageEnd();
  const nights = lastNights(data);
  const spread = (m: number | null) =>
    m == null ? null : m < 15 ? tr("sleep.spreadUnder") : tr("sleep.spreadAbout", { d: hoursMinutes(Math.round(m / 5) * 5) });
  const bed = spread(data.bedtime_spread_minutes);
  const wake = spread(data.wake_spread_minutes);
  return (
    <Card>
      <CardHead title={tr("sleep.consistencyTitle")} />
      <Txt variant="small">
        {bed && wake
          ? tr("sleep.varied", { bed, wake })
          : tr("sleep.need3")}
      </Txt>
      <View style={{ marginTop: 12, gap: 6 }}>
        {nights.map(({ date, night }) => (
          <Row key={date} gap={8}>
            <Txt variant="tiny" style={{ width: 30 }}>
              {weekdayOf(date)}
            </Txt>
            <View style={{ flex: 1, height: 14, borderRadius: 7, backgroundColor: t.surface2, overflow: "hidden", direction: "ltr" }}>
              {night ? (
                <View
                  accessibilityLabel={tr("sleep.bedUpLabel", { date: longDate(date), bed: clockOf(night.bedtime), up: clockOf(night.wake_time) })}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${(timelinePos(night.bedtime, date) / WINDOW) * 100}%`,
                    width: `${((timelinePos(night.wake_time, date) - timelinePos(night.bedtime, date)) / WINDOW) * 100}%`,
                    backgroundColor: night.source !== "manual" ? t.series[0] : t.series[2],
                    borderRadius: 7,
                  }}
                />
              ) : null}
            </View>
            <Txt variant="tiny" style={{ width: 82, textAlign: end }}>
              {night ? `${clockOf(night.bedtime)}–${clockOf(night.wake_time)}` : tr("sleep.notLogged")}
            </Txt>
          </Row>
        ))}
        <Row gap={8}>
          <View style={{ width: 30 }} />
          <Row style={{ flex: 1, justifyContent: "space-between", direction: "ltr" }}>
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
        {tr("sleep.mainOnly")}
      </Txt>
    </Card>
  );
}

// ---------- change the sleep goal ----------

const GOAL_CHOICES = [360, 390, 420, 450, 480, 510, 540, 600];

export function SleepGoalForm({ data, onSaved }: { data: SleepAnalytics; onSaved: (message: string) => void }) {
  const { t: tr } = useI18n();
  const [low] = data.recommended_hours;
  const [value, setValue] = useState<number | "recommended">(data.goal_custom ? data.goal_minutes : "recommended");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api("/me/sleep-goal", { method: "PUT", body: { minutes: value === "recommended" ? null : value } });
      onSaved(tr("sleep.goalSaved"));
    } catch (e) {
      setError(errorTextFor(e));
    }
  };
  return (
    <View>
      <Txt variant="small">
        {tr("sleep.goalIntro", { low: data.recommended_hours[0], high: data.recommended_hours[1] })}
      </Txt>
      <Chips
        label={tr("profile.goal")}
        value={value}
        onChange={setValue}
        options={[
          { value: "recommended" as const, label: tr("sleep.recommendedChoice", { h: low }) },
          ...GOAL_CHOICES.map((m) => ({ value: m, label: goalHours(m) })),
        ]}
      />
      <ErrorText message={error} />
      <Button title={tr("sleep.saveGoal")} onPress={save} style={{ marginTop: 14 }} />
    </View>
  );
}
