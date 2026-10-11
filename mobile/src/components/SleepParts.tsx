import { useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { addDays, clockOf, clockText, hoursMinutes, longDate, parseClock, shortDate, todayISO } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry } from "@/lib/types";

import { Chart, ChartCard, type ChartSeries } from "./charts";
import { Badge, Button, Chips, ErrorText, Field, IconButton, Row, Stat, Txt } from "./ui";

export const QUALITY = [
  { value: 1, label: "Very poor" },
  { value: 2, label: "Poor" },
  { value: 3, label: "OK" },
  { value: 4, label: "Good" },
  { value: 5, label: "Great" },
];

export const qualityLabel = (q: number | null | undefined) => QUALITY.find((x) => x.value === Math.round(q ?? 0))?.label;

/** Compare a night's hours with the recommended range. */
export function rangeBadge(hours: number | null, [low, high]: [number, number]) {
  if (hours == null) return null;
  if (hours < low) return <Badge label={`Below ${low} h`} tone="warn" />;
  if (hours > high) return <Badge label={`Over ${high} h`} tone="info" />;
  return <Badge label="In range" tone="good" />;
}

/** "Deep 1 h 45 min · REM 2 h 00 min · Recovery 78 %" for tracker nights */
export function trackerSummary(e: SleepEntry): string {
  const parts: string[] = [];
  if (e.deep_minutes != null) parts.push(`Deep ${hoursMinutes(e.deep_minutes)}`);
  if (e.rem_minutes != null) parts.push(`REM ${hoursMinutes(e.rem_minutes)}`);
  if (e.recovery_score != null) parts.push(`Recovery ${Math.round(e.recovery_score)} %`);
  return parts.join(" · ");
}

function TrackerDetails({ entry }: { entry: SleepEntry }) {
  const stages: [string, number | null | undefined][] = [
    ["Light", entry.light_minutes],
    ["Deep", entry.deep_minutes],
    ["REM", entry.rem_minutes],
    ["Awake", entry.awake_minutes],
  ];
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={{ fontWeight: "700" }}>{longDate(entry.date)}</Txt>
        <Badge label="From WHOOP" tone="info" />
      </Row>
      <Txt variant="small" style={{ marginTop: 4 }}>
        {clockOf(entry.bedtime)} → {clockOf(entry.wake_time)} · {hoursMinutes(entry.duration_minutes)} asleep
      </Txt>
      {entry.light_minutes != null ? (
        <Row style={{ marginTop: 10 }} gap={6}>
          {stages.map(([label, m]) => (
            <Stat key={label} label={label} value={m == null ? "–" : m < 60 ? `${m} min` : hoursMinutes(m).replace(" min", "")} />
          ))}
        </Row>
      ) : (
        <Txt variant="tiny" style={{ marginTop: 8 }}>
          WHOOP hasn&apos;t scored this sleep yet. Stages appear after the next sync.
        </Txt>
      )}
      <Row style={{ marginTop: 8 }} gap={6}>
        <Stat label="Sleep performance" value={entry.performance_pct != null ? `${Math.round(entry.performance_pct)} %` : "–"} />
        <Stat label="Recovery" value={entry.recovery_score != null ? `${Math.round(entry.recovery_score)} %` : "–"} />
      </Row>
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        Times come from WHOOP and update on every sync. You can still change the quality and add notes.
      </Txt>
    </View>
  );
}

// ---------- log or edit a sleep ----------

export function SleepForm({ entry, onSaved }: { entry?: SleepEntry; onSaved: (message: string) => void }) {
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
        onSaved("Sleep updated");
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (bedMin == null || wakeMin == null) {
      setError("Enter times like 23:30 or 7:00.");
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
      onSaved(entry ? "Sleep updated" : `Sleep saved: ${hoursMinutes(minutes ?? 0)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View>
      {fromTracker ? (
        <TrackerDetails entry={entry} />
      ) : (
        <>
          <Txt variant="label" style={{ marginTop: 4 }}>
            Woke up on
          </Txt>
          <Row style={{ justifyContent: "space-between", marginTop: 6 }}>
            <IconButton icon="chevron-back" label="Day before" onPress={() => setWakeDay(addDays(wakeDay, -1))} />
            <Txt style={{ fontWeight: "700" }}>{isToday ? "Today" : longDate(wakeDay)}</Txt>
            {isToday ? <View style={{ width: 30 }} /> : <IconButton icon="chevron-forward" label="Next day" onPress={() => setWakeDay(addDays(wakeDay, 1))} />}
          </Row>
          <Row>
            <Field label="Went to bed" value={bed} onChangeText={setBed} placeholder="23:30" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
            <Field label="Woke up" value={wake} onChangeText={setWake} placeholder="07:00" keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
          </Row>
          <Txt variant="small" style={{ marginTop: 8 }}>
            {minutes != null
              ? `${hoursMinutes(minutes)} of sleep${bedBefore ? ` (bed on ${shortDate(addDays(wakeDay, -1))})` : ""}`
              : "Use 24-hour times like 23:30, or 11:30 pm."}
          </Txt>
        </>
      )}
      <Chips label="How did you sleep? (optional)" value={quality} onChange={setQuality} options={QUALITY} />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="e.g. coffee late, woke up twice" />
      <ErrorText message={error} />
      <Button title={entry ? "Save changes" : "Save sleep"} onPress={save} style={{ marginTop: 14 }} />
      {entry ? (
        <Button
          title="Delete"
          kind="danger"
          style={{ marginTop: 10 }}
          onPress={async () => {
            const note = fromTracker ? " It may come back on the next WHOOP sync if WHOOP still has it." : "";
            if (!(await confirm("Delete this sleep?", `${longDate(entry.date)} · ${hoursMinutes(entry.duration_minutes)}.${note}`, "Delete"))) return;
            await api(`/sleep/${entry.id}`, { method: "DELETE" });
            onSaved("Sleep deleted");
          }}
        />
      ) : null}
    </View>
  );
}

// ---------- chart: hours per night with the recommended range ----------

export function SleepChart({ data }: { data: SleepAnalytics }) {
  const t = useTheme();
  const [low, high] = data.recommended_hours;
  const labels = data.labels.map(shortDate);
  const series: ChartSeries[] = [
    { name: "Hours slept", data: data.series[0].data, color: t.series[0], type: "bar" },
    { name: `${low} h (min)`, data: [low], color: t.muted, type: "ref" },
    { name: `${high} h (max)`, data: [high], color: t.muted, type: "ref" },
  ];
  const tableSeries: ChartSeries[] = [
    series[0],
    { name: "Quality (1–5)", data: data.quality, color: t.series[1], type: "line" },
  ];
  return (
    <ChartCard
      title={`Sleep, last ${data.labels.length} nights`}
      subtitle={`Hours per night. Recommended for you: ${low}–${high} h`}
      empty={!data.series[0].data.some((v) => v != null)}
      emptyText="Log your sleep to see it here."
      table={{ labels, series: tableSeries }}
    >
      <Chart labels={labels} series={series} />
    </ChartCard>
  );
}
