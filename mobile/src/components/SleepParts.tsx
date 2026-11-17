import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { addDays, clockOf, clockText, hoursMinutes, longDate, parseClock, shortDate, todayISO, trackerName } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { errorTextFor, tr } from "@/lib/i18n/current";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry } from "@/lib/types";

import { Chart, ChartCard, type ChartSeries } from "./charts";
import { Badge, Button, Chips, ErrorText, Field, IconButton, Row, Stat, Txt } from "./ui";

const QUALITY_VALUES = [1, 2, 3, 4, 5] as const;

/** Quality 1–5 with its name in the current language ("Good" / "جيدة"). */
export const qualityChoices = () => QUALITY_VALUES.map((value) => ({ value, label: tr(`quality.${value}`) }));

export const qualityLabel = (q: number | null | undefined) => qualityChoices().find((x) => x.value === Math.round(q ?? 0))?.label;

/** Compare a night's hours with the recommended range. */
export function rangeBadge(hours: number | null, [low, high]: [number, number]) {
  if (hours == null) return null;
  if (hours < low) return <Badge label={tr("sleep.below", { h: low })} tone="warn" />;
  if (hours > high) return <Badge label={tr("sleep.over", { h: high })} tone="info" />;
  return <Badge label={tr("sleep.inRange")} tone="good" />;
}

/** "Deep 1 h 45 min · REM 2 h 00 min · Recovery 78 %" for tracker nights */
export function trackerSummary(e: SleepEntry): string {
  const parts: string[] = [];
  if (e.deep_minutes != null) parts.push(tr("sleep.part", { label: tr("sleep.deep"), value: hoursMinutes(e.deep_minutes) }));
  if (e.rem_minutes != null) parts.push(tr("sleep.part", { label: tr("sleep.rem"), value: hoursMinutes(e.rem_minutes) }));
  if (e.recovery_score != null) parts.push(tr("sleep.part", { label: tr("sleep.recovery"), value: `${Math.round(e.recovery_score)} %` }));
  return parts.join(" · ");
}

function TrackerDetails({ entry }: { entry: SleepEntry }) {
  const stages: [string, number | null | undefined][] = [
    [tr("sleep.light"), entry.light_minutes],
    [tr("sleep.deep"), entry.deep_minutes],
    [tr("sleep.rem"), entry.rem_minutes],
    [tr("sleep.awake"), entry.awake_minutes],
  ];
  const whoop = entry.source === "whoop";
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={{ fontWeight: "700" }}>{longDate(entry.date)}</Txt>
        <Badge label={tr("sleep.from", { tracker: trackerName(entry.source) ?? "" })} tone="info" />
      </Row>
      <Txt variant="small" style={{ marginTop: 4 }}>
        {clockOf(entry.bedtime)} → {clockOf(entry.wake_time)} · {tr("sleep.asleep", { duration: hoursMinutes(entry.duration_minutes) })}
      </Txt>
      {entry.light_minutes != null ? (
        <Row style={{ marginTop: 10 }} gap={6}>
          {stages.map(([label, m]) => (
            <Stat key={label} label={label} value={m == null ? "–" : hoursMinutes(m)} />
          ))}
        </Row>
      ) : (
        <Txt variant="tiny" style={{ marginTop: 8 }}>
          {whoop
            ? tr("sleep.whoopNotScored")
            : tr("sleep.noStages")}
        </Txt>
      )}
      {whoop ? (
        <Row style={{ marginTop: 8 }} gap={6}>
          <Stat label={tr("sleep.performance")} value={entry.performance_pct != null ? `${Math.round(entry.performance_pct)} %` : "–"} />
          <Stat label={tr("sleep.recovery")} value={entry.recovery_score != null ? `${Math.round(entry.recovery_score)} %` : "–"} />
        </Row>
      ) : null}
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        {tr("sleep.timesFrom", { tracker: trackerName(entry.source) ?? "" })}
      </Txt>
    </View>
  );
}

// ---------- log or edit a sleep ----------

export function SleepForm({ entry, onSaved }: { entry?: SleepEntry; onSaved: (message: string) => void }) {
  const { t: tr } = useI18n();
  const [wakeDay, setWakeDay] = useState(entry?.date ?? todayISO());
  const [bed, setBed] = useState(entry ? clockOf(entry.bedtime) : "23:00");
  const [wake, setWake] = useState(entry ? clockOf(entry.wake_time) : "07:00");
  const [quality, setQuality] = useState(entry?.quality ?? 0);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const fromTracker = entry != null && entry.source !== "manual";

  const bedMin = parseClock(bed);
  const wakeMin = parseClock(wake);
  // A bedtime later on the clock than the wake-up time was the evening before
  const bedBefore = bedMin != null && wakeMin != null && bedMin >= wakeMin;
  const minutes = bedMin != null && wakeMin != null ? (bedBefore ? wakeMin + 1440 - bedMin : wakeMin - bedMin) : null;
  const isToday = wakeDay === todayISO();

  const save = async () => {
    setError(null);
    if (fromTracker) {
      try {
        await api(`/sleep/${entry.id}`, { method: "PATCH", body: { quality: quality || null, notes } });
        onSaved(tr("sleep.updated"));
      } catch (e) {
        setError(errorTextFor(e));
      }
      return;
    }
    if (bedMin == null || wakeMin == null) {
      setError(tr("sleep.badTimes"));
      return;
    }
    const body = {
      bedtime: `${bedBefore ? addDays(wakeDay, -1) : wakeDay}T${clockText(bedMin)}:00`,
      wake_time: `${wakeDay}T${clockText(wakeMin)}:00`,
      quality: quality || null,
      notes,
    };
    try {
      if (entry) await api(`/sleep/${entry.id}`, { method: "PATCH", body });
      else await api("/sleep", { method: "POST", body });
      onSaved(entry ? tr("sleep.updated") : tr("sleep.saved", { duration: hoursMinutes(minutes ?? 0) }));
    } catch (e) {
      setError(errorTextFor(e));
    }
  };

  return (
    <View>
      {fromTracker ? (
        <TrackerDetails entry={entry} />
      ) : (
        <>
          <Txt variant="label" style={{ marginTop: 4 }}>
            {tr("sleep.wokeOn")}
          </Txt>
          <Row style={{ justifyContent: "space-between", marginTop: 6 }}>
            <IconButton icon="chevron-back" label={tr("food.previousDay")} onPress={() => setWakeDay(addDays(wakeDay, -1))} />
            <Txt style={{ fontWeight: "700" }}>{isToday ? tr("today.today") : longDate(wakeDay)}</Txt>
            {isToday ? <View style={{ width: 30 }} /> : <IconButton icon="chevron-forward" label={tr("food.nextDay")} onPress={() => setWakeDay(addDays(wakeDay, 1))} />}
          </Row>
          <Row>
            <Field label={tr("sleep.wentToBed")} value={bed} onChangeText={setBed} placeholder="23:30" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
            <Field label={tr("sleep.wokeUp")} value={wake} onChangeText={setWake} placeholder="07:00" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
          </Row>
          <Txt variant="small" style={{ marginTop: 8 }}>
            {minutes != null
              ? tr("sleep.ofSleep", { duration: hoursMinutes(minutes) }) + (bedBefore ? tr("sleep.bedOn", { date: shortDate(addDays(wakeDay, -1)) }) : "")
              : tr("sleep.timeHint")}
          </Txt>
        </>
      )}
      <Chips label={tr("sleep.howDid")} value={quality} onChange={setQuality} options={qualityChoices()} />
      <Field label={tr("sleep.notes")} value={notes} onChangeText={setNotes} placeholder={tr("sleep.notesPlaceholder")} />
      <ErrorText message={error} />
      <Button title={tr(entry ? "profile.saveChanges" : "sleep.save")} onPress={save} style={{ marginTop: 14 }} />
      {entry ? (
        <Button
          title={tr("settings.deleteConfirm")}
          kind="danger"
          style={{ marginTop: 10 }}
          onPress={async () => {
            const from = trackerName(entry.source);
            const note = fromTracker ? tr("sleep.mayComeBack", { tracker: from ?? "" }) : "";
            if (!(await confirm(tr("sleep.deleteTitle"), `${longDate(entry.date)} · ${hoursMinutes(entry.duration_minutes)}.${note}`, tr("settings.deleteConfirm")))) return;
            await api(`/sleep/${entry.id}`, { method: "DELETE" });
            onSaved(tr("sleep.deleted"));
          }}
        />
      ) : null}
    </View>
  );
}

// ---------- chart: hours per night with the recommended range ----------

export function SleepChart({ data }: { data: SleepAnalytics }) {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const [low, high] = data.recommended_hours;
  const labels = data.labels.map(shortDate);
  const goal = Math.round((data.goal_minutes / 60) * 100) / 100;
  const series: ChartSeries[] = [
    { name: tr("sleep.hoursSlept"), data: data.series[0].data, color: t.series[0], type: "bar" },
    { name: tr("sleep.goalShort", { goal: data.goal_minutes % 60 ? hoursMinutes(data.goal_minutes) : tr("sleep.hours", { h: data.goal_minutes / 60 }) }), data: [goal], color: t.text2, type: "ref" },
  ];
  const tableSeries: ChartSeries[] = [
    series[0],
    { name: tr("sleep.quality15"), data: data.quality, color: t.series[1], type: "line" },
  ];
  return (
    <ChartCard
      title={tr("sleep.chartTitle", { nights: tn("weekly.nights", data.labels.length) })}
      subtitle={tr("sleep.chartHint", { low, high })}
      empty={!data.series[0].data.some((v) => v != null)}
      emptyText={tr("sleep.chartEmpty")}
      table={{ labels, series: tableSeries }}
    >
      <Chart labels={labels} series={series} />
    </ChartCard>
  );
}
