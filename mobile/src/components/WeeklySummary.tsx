import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { WEEKDAYS_SHORT, addDays, fmt, hoursMinutes, plural, shortDate, todayISO, tzOffset, units } from "@/lib/format";
import { errorMessage, qk, useRefreshOnFocus } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { WeeklySummary as Summary } from "@/lib/types";

import { Chart, type ChartSeries } from "./charts";
import { Badge, Card, ErrorText, IconButton, Row, SkeletonCards, Stat, Txt, type IconName } from "./ui";

/** A week (Monday to Sunday) against the plan and the week before. Missing data is left out, not shown as zero. */
export function WeeklySummaryCard() {
  const t = useTheme();
  const { profile } = useProfile();
  const u = units(profile.unit_system);
  const [week, setWeek] = useState<string | null>(null); // null = this week
  const query = useQuery({
    queryKey: qk.weekly(week),
    queryFn: () => api<Summary>(`/analytics/weekly-summary?tz_offset=${tzOffset()}${week ? `&week=${week}` : ""}`),
  });
  useRefreshOnFocus([qk.weekly(week)]); // e.g. after finishing a workout
  const data = query.data ?? null;
  const error = data ? null : errorMessage(query.error);

  if (error)
    return (
      <Card>
        <ErrorText message={error} />
      </Card>
    );
  if (!data) return <SkeletonCards count={2} />;

  const s = data;
  const title = s.current_week ? "This week" : `Week of ${shortDate(s.week_start)}`;
  const target = s.current_week ? s.planned_so_far : s.planned;
  const volumeChange = s.previous_volume_kg != null ? s.volume_kg - s.previous_volume_kg : null;
  const historySeries: ChartSeries[] = [
    { name: "Planned", data: s.history.map((h) => h.planned), color: t.series[0], type: "bar" },
    { name: "Done", data: s.history.map((h) => h.completed), color: t.series[2], type: "bar" },
  ];

  return (
    <View>
      <Row style={{ justifyContent: "space-between", marginBottom: space.md }}>
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

      <Card>
        <Txt variant="h3">Training</Txt>
        <WeekDays summary={s} />
        <Txt variant="small" style={{ marginTop: space.md }}>
          {s.completed} of {s.planned} planned session{s.planned === 1 ? "" : "s"}
          {s.current_week && s.planned_so_far < s.planned ? ` (${s.planned_so_far} so far)` : ""}
          {s.completed > s.completed_on_plan ? ` · ${s.completed - s.completed_on_plan} on other days` : ""}
          {s.previous_completed != null ? ` · last week ${s.previous_completed}` : ""}
        </Txt>

        <Row style={{ marginTop: space.lg }}>
          <Stat label="Sessions" value={`${s.completed}/${target || s.planned}`} />
          <Stat label="Sets" value={fmt(s.sets)} />
          <Stat label={`Volume (${u.w})`} value={s.volume_kg ? fmt(u.fromKg(s.volume_kg), 0) : "–"} />
        </Row>
        {volumeChange != null && s.volume_kg ? (
          <Txt variant="tiny" style={{ marginTop: space.xs }}>
            Volume {u.weightDelta(volumeChange, 0)} compared with last week (reps × weight).
          </Txt>
        ) : null}

        {s.exercises.length ? (
          <View style={{ marginTop: space.lg }}>
            <Txt variant="label" style={{ marginBottom: space.xs }}>
              Lifts
            </Txt>
            {s.exercises.slice(0, 8).map((e) => (
              <View key={e.exercise_id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingVertical: space.md - 2 }}>
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
          <Txt variant="small" style={{ marginTop: space.md }}>
            No workouts logged this week.
          </Txt>
        )}
      </Card>

      <Card style={{ gap: space.lg }}>
        <SummaryRow icon="moon" title="Sleep">
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
        </SummaryRow>

        <SummaryRow icon="scale" title="Weight goal">
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
        </SummaryRow>

        <SummaryRow icon="sparkles" title="Wellness points">
          <Txt variant="small">
            {s.points} points{s.previous_points ? ` (last week ${s.previous_points})` : ""}
          </Txt>
        </SummaryRow>
      </Card>

      <Card>
        <Txt variant="h3">Planned vs done</Txt>
        <Txt variant="tiny" style={{ marginBottom: space.sm }}>
          Sessions per week, last 8 weeks
        </Txt>
        <Chart labels={s.history.map((h) => shortDate(h.week_start))} series={historySeries} height={160} digits={0} />
        {s.notes.map((n) => (
          <Txt key={n} variant="tiny" style={{ marginTop: space.sm }}>
            {n}
          </Txt>
        ))}
      </Card>
    </View>
  );
}

function SummaryRow({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Row gap={space.md} style={{ alignItems: "flex-start" }}>
      <View style={{ width: 34, height: 34, borderRadius: radius.sm + 2, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={16} color={t.text2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontWeight: "600" }}>{title}</Txt>
        {children}
      </View>
    </Row>
  );
}

function setText(top: { weight_kg: number; reps: number }, u: ReturnType<typeof units>) {
  return top.weight_kg > 0 ? `${u.weight(top.weight_kg)} × ${top.reps}` : `${top.reps} reps`;
}

function WeekDays({ summary }: { summary: Summary }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: space.md }}>
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
              paddingVertical: 8,
              gap: 2,
              borderRadius: radius.sm + 2,
              backgroundColor: filled ? t.accentSoft : t.surface2,
              borderWidth: d.planned && !d.trained ? 1 : 0,
              borderColor: t.muted,
              borderStyle: "dashed",
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
