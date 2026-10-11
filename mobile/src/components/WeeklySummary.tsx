import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { WEEKDAYS_SHORT, addDays, fmt, hoursMinutes, plural, shortDate, todayISO, tzOffset, units } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { WeeklySummary as Summary } from "@/lib/types";

import { Chart, type ChartSeries } from "./charts";
import { Badge, Card, ErrorText, IconButton, Row, Stat, Txt } from "./ui";

/** A week (Monday to Sunday) against the plan and the week before. Missing data is left out, not shown as zero. */
export function WeeklySummaryCard() {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [week, setWeek] = useState<string | null>(null); // null = this week
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // reload when the screen comes back into view (e.g. after finishing a workout)
  useFocusEffect(
    useCallback(() => {
      api<Summary>(`/analytics/weekly-summary?tz_offset=${tzOffset()}${week ? `&week=${week}` : ""}`)
        .then((s) => {
          setError(null);
          setData(s);
        })
        .catch((e) => setError((e as Error).message));
    }, [week]),
  );

  if (error) return <Card><ErrorText message={error} /></Card>;
  if (!data) return <Card><Txt variant="muted">Loading…</Txt></Card>;

  const s = data;
  const title = s.current_week ? "This week" : `Week of ${shortDate(s.week_start)}`;
  const target = s.current_week ? s.planned_so_far : s.planned;
  const volumeChange = s.previous_volume_kg != null ? s.volume_kg - s.previous_volume_kg : null;
  const historySeries: ChartSeries[] = [
    { name: "Planned", data: s.history.map((h) => h.planned), color: t.series[0], type: "bar" },
    { name: "Done", data: s.history.map((h) => h.completed), color: t.series[2], type: "bar" },
  ];

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <IconButton icon="chevron-back" label="Previous week" onPress={() => setWeek(addDays(s.week_start, -7))} />
        <View style={{ alignItems: "center", flex: 1 }}>
          <Txt variant="h3">{title}</Txt>
          <Txt variant="tiny">
            {shortDate(s.week_start)} – {shortDate(s.week_end)}
          </Txt>
        </View>
        {s.current_week ? (
          <View style={{ width: 36 }} />
        ) : (
          <IconButton icon="chevron-forward" label="Next week" onPress={() => setWeek(addDays(s.week_start, 7))} />
        )}
      </Row>

      <WeekDays summary={s} />
      <Txt variant="small" style={{ marginTop: 8 }}>
        {s.completed} of {s.planned} planned sessions
        {s.current_week && s.planned_so_far < s.planned ? ` (${s.planned_so_far} so far)` : ""}
        {s.completed > s.completed_on_plan ? ` · ${s.completed - s.completed_on_plan} on other days` : ""}
        {s.previous_completed != null ? ` · last week ${s.previous_completed}` : ""}
      </Txt>

      <Row style={{ marginTop: 10 }}>
        <Stat label="Sessions" value={`${s.completed}/${target || s.planned}`} />
        <Stat label="Sets" value={fmt(s.sets)} />
        <Stat label={`Volume (${u.w})`} value={s.volume_kg ? fmt(u.fromKg(s.volume_kg), 0) : "–"} />
      </Row>
      {volumeChange != null && s.volume_kg ? (
        <Txt variant="tiny" style={{ marginTop: 4 }}>
          Volume {u.weightDelta(volumeChange, 0)} compared with last week (reps × weight).
        </Txt>
      ) : null}

      {s.exercises.length ? (
        <View style={{ marginTop: 14 }}>
          <Txt variant="label">Lifts</Txt>
          {s.exercises.slice(0, 8).map((e) => (
            <View key={e.exercise_id} style={{ borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 7 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt style={{ fontWeight: "600", flex: 1 }}>{e.name}</Txt>
                {e.record ? <Badge label={e.record} tone="good" /> : null}
              </Row>
              <Txt variant="small">
                Best set {setText(e.top_set, u)} · {plural(e.sets, "set")}
              </Txt>
              <Txt variant="tiny">
                {e.previous_top_set
                  ? `Before: ${setText(e.previous_top_set, u)} on ${shortDate(e.previous_top_set.date)}`
                  : "First time logged"}
                {e.best_e1rm_kg != null && e.previous_e1rm_kg != null
                  ? ` · est. 1RM ${u.weight(e.best_e1rm_kg)} (best before ${u.weight(e.previous_e1rm_kg)})`
                  : ""}
              </Txt>
            </View>
          ))}
        </View>
      ) : (
        <Txt variant="muted" style={{ marginTop: 12 }}>
          No workouts logged this week.
        </Txt>
      )}

      <View style={{ marginTop: 14, gap: 6 }}>
        <Txt variant="label">Sleep</Txt>
        {s.sleep ? (
          <>
            <Txt variant="small">
              Average {hoursMinutes(s.sleep.average_minutes)} over {plural(s.sleep.nights_logged, "night")} · goal reached on{" "}
              {s.sleep.nights_meeting_goal} ({hoursMinutes(s.sleep.goal_minutes)} goal)
            </Txt>
            <Txt variant="tiny">
              {s.sleep.previous_average_minutes != null
                ? `Last week: ${hoursMinutes(s.sleep.previous_average_minutes)} over ${plural(s.sleep.previous_nights_logged, "night")}. `
                : "No sleep logged the week before, so there's nothing to compare. "}
              {[s.sleep.from_whoop ? `${s.sleep.from_whoop} from WHOOP` : "", s.sleep.logged_by_hand ? `${s.sleep.logged_by_hand} logged by hand` : ""]
                .filter(Boolean)
                .join(", ")}
            </Txt>
          </>
        ) : (
          <Txt variant="small">No sleep logged this week.</Txt>
        )}

        <Txt variant="label" style={{ marginTop: 6 }}>
          Weight goal
        </Txt>
        {s.weight ? (
          <Txt variant="small">
            Latest {u.weight(s.weight.latest_kg)}
            {s.weight.change_kg != null ? ` (${u.weightDelta(s.weight.change_kg)} since the weigh-in before)` : ""}
            {s.weight.direction !== "maintain"
              ? ` · ${u.weight(s.weight.to_target_kg)} to your ${u.weight(s.weight.target_kg)} target`
              : " · keeping your weight steady"}
          </Txt>
        ) : (
          <Txt variant="small">No weigh-in this week.</Txt>
        )}

        <Row gap={6} style={{ marginTop: 6 }}>
          <Ionicons name="sparkles-outline" size={16} color={t.accent} />
          <Txt variant="small">
            {s.points} wellness points{s.previous_points ? ` (last week ${s.previous_points})` : ""}
          </Txt>
        </Row>
      </View>

      <Txt variant="label" style={{ marginTop: 14 }}>
        Planned vs done, last 8 weeks
      </Txt>
      <Chart labels={s.history.map((h) => shortDate(h.week_start))} series={historySeries} height={160} digits={0} />
      {s.notes.map((n) => (
        <Txt key={n} variant="tiny" style={{ marginTop: 8 }}>
          {n}
        </Txt>
      ))}
    </Card>
  );
}

function setText(top: { weight_kg: number; reps: number }, u: ReturnType<typeof units>) {
  return top.weight_kg > 0 ? `${u.weight(top.weight_kg)} × ${top.reps}` : `${top.reps} reps`;
}

function WeekDays({ summary }: { summary: Summary }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: 10 }}>
      {summary.days.map((d, i) => {
        const upcoming = d.future || d.date === todayISO();
        const status = d.trained ? (d.planned ? "Done" : "Extra") : d.planned ? (upcoming ? "Planned" : "Not done") : "Rest";
        const filled = d.trained;
        return (
          <View
            key={d.date}
            accessibilityLabel={`${WEEKDAYS_SHORT[i]}: ${status}`}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: filled ? t.accentSoft : t.surface2,
              borderWidth: d.planned && !d.trained ? 1 : 0,
              borderColor: t.border,
            }}
          >
            <Txt variant="tiny" style={{ color: t.text2 }}>
              {WEEKDAYS_SHORT[i]}
            </Txt>
            {d.trained ? (
              <Ionicons name="checkmark-circle" size={18} color={t.accent} />
            ) : (
              <Txt variant="tiny" style={{ color: t.muted }}>
                {d.planned ? (d.date === todayISO() ? "Today" : d.future ? "Plan" : "–") : "Rest"}
              </Txt>
            )}
          </View>
        );
      })}
    </View>
  );
}
