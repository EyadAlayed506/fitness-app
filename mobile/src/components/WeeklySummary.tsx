import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useProfile } from "@/lib/auth";
import { WEEKDAYS_SHORT, addDays, fmt, hoursMinutes, shortDate, todayISO, tzOffset, units } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { tr, trOr } from "@/lib/i18n/current";
import { errorMessage, qk, useRefreshOnFocus } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { WeeklySummary as Summary } from "@/lib/types";

import { Chart, type ChartSeries } from "./charts";
import { Badge, Card, ErrorText, Icon, IconButton, Row, SkeletonCards, Stat, Txt, type IconName } from "./ui";

/** A week (Monday to Sunday) against the plan and the week before. Missing data is left out, not shown as zero. */
export function WeeklySummaryCard() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
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
  const title = s.current_week ? tr("weekly.thisWeek") : tr("weekly.weekOf", { date: shortDate(s.week_start) });
  const target = s.current_week ? s.planned_so_far : s.planned;
  const volumeChange = s.previous_volume_kg != null ? s.volume_kg - s.previous_volume_kg : null;
  const historySeries: ChartSeries[] = [
    { name: tr("weekly.planned"), data: s.history.map((h) => h.planned), color: t.series[0], type: "bar" },
    { name: tr("weekly.done"), data: s.history.map((h) => h.completed), color: t.series[2], type: "bar" },
  ];

  return (
    <View>
      <Row style={{ justifyContent: "space-between", marginBottom: space.md }}>
        <IconButton icon="chevron-back" label={tr("weekly.previous")} onPress={() => setWeek(addDays(s.week_start, -7))} />
        <View style={{ alignItems: "center", flex: 1 }}>
          <Txt variant="h3">{title}</Txt>
          <Txt variant="tiny">
            {shortDate(s.week_start)} – {shortDate(s.week_end)}
          </Txt>
        </View>
        {s.current_week ? (
          <View style={{ width: 36 }} />
        ) : (
          <IconButton icon="chevron-forward" label={tr("weekly.next")} onPress={() => setWeek(addDays(s.week_start, 7))} />
        )}
      </Row>

      <Card>
        <Txt variant="h3">{tr("onboarding.training")}</Txt>
        <WeekDays summary={s} />
        <Txt variant="small" style={{ marginTop: space.md }}>
          {tr("weekly.completedOf", { done: s.completed, count: tn("weekly.plannedSessions", s.planned) })}
          {s.current_week && s.planned_so_far < s.planned ? tr("weekly.soFar", { n: s.planned_so_far }) : ""}
          {s.completed > s.completed_on_plan ? tr("weekly.otherDays", { n: s.completed - s.completed_on_plan }) : ""}
          {s.previous_completed != null ? tr("weekly.lastWeek", { n: s.previous_completed }) : ""}
        </Txt>

        <Row style={{ marginTop: space.lg }}>
          <Stat label={tr("weekly.sessions")} value={`${s.completed}/${target || s.planned}`} />
          <Stat label={tr("workouts.sets")} value={fmt(s.sets)} />
          <Stat label={tr("weekly.volumeLabel", { unit: u.wLabel })} value={s.volume_kg ? fmt(u.fromKg(s.volume_kg), 0) : "–"} />
        </Row>
        {volumeChange != null && s.volume_kg ? (
          <Txt variant="tiny" style={{ marginTop: space.xs }}>
            {tr("weekly.volumeChange", { delta: u.weightDelta(volumeChange, 0) })}
          </Txt>
        ) : null}

        {s.exercises.length ? (
          <View style={{ marginTop: space.lg }}>
            <Txt variant="label" style={{ marginBottom: space.xs }}>
              {tr("weekly.lifts")}
            </Txt>
            {s.exercises.slice(0, 8).map((e) => (
              <View key={e.exercise_id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingVertical: space.md - 2 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt style={{ fontWeight: "600", flex: 1 }}>{e.name}</Txt>
                  {e.record ? <Badge label={trOr(`record.${e.record}`, e.record)} tone="good" /> : null}
                </Row>
                <Txt variant="small">
                  {tr("weekly.bestSet", { set: setText(e.top_set, u), count: tn("workouts.setCount", e.sets) })}
                </Txt>
                <Txt variant="tiny">
                  {e.previous_top_set
                    ? tr("weekly.before", { set: setText(e.previous_top_set, u), date: shortDate(e.previous_top_set.date) })
                    : tr("weekly.firstTime")}
                  {e.best_e1rm_kg != null && e.previous_e1rm_kg != null
                    ? tr("weekly.e1rm", { now: u.weight(e.best_e1rm_kg), before: u.weight(e.previous_e1rm_kg) })
                    : ""}
                </Txt>
              </View>
            ))}
          </View>
        ) : (
          <Txt variant="small" style={{ marginTop: space.md }}>
            {tr("weekly.noWorkouts")}
          </Txt>
        )}
      </Card>

      <Card style={{ gap: space.lg }}>
        <SummaryRow icon="moon" title={tr("nav.sleep")}>
          {s.sleep ? (
            <>
              <Txt variant="small">
                {tr("weekly.sleepAvg", {
                  average: hoursMinutes(s.sleep.average_minutes),
                  nights: tn("weekly.nights", s.sleep.nights_logged),
                  met: s.sleep.nights_meeting_goal,
                  goal: hoursMinutes(s.sleep.goal_minutes),
                })}
              </Txt>
              <Txt variant="tiny">
                {s.sleep.previous_average_minutes != null
                  ? tr("weekly.sleepLast", { average: hoursMinutes(s.sleep.previous_average_minutes), nights: tn("weekly.nights", s.sleep.previous_nights_logged) })
                  : tr("weekly.sleepNoPrev")}
                {[
                  s.sleep.from_whoop ? tr("weekly.fromWhoop", { n: s.sleep.from_whoop }) : "",
                  s.sleep.from_health_connect ? tr("weekly.fromHc", { n: s.sleep.from_health_connect }) : "",
                  s.sleep.logged_by_hand ? tr("weekly.byHand", { n: s.sleep.logged_by_hand }) : "",
                ]
                  .filter(Boolean)
                  .join(tr("list.separator"))}
              </Txt>
            </>
          ) : (
            <Txt variant="small">{tr("weekly.noSleep")}</Txt>
          )}
        </SummaryRow>

        <SummaryRow icon="scale" title={tr("weekly.weightGoal")}>
          {s.weight ? (
            <Txt variant="small">
              {tr("weekly.latest", { weight: u.weight(s.weight.latest_kg) })}
              {s.weight.change_kg != null ? tr("weekly.sinceBefore", { delta: u.weightDelta(s.weight.change_kg) }) : ""}
              {s.weight.direction !== "maintain"
                ? tr("weekly.toTarget", { left: u.weight(s.weight.to_target_kg), target: u.weight(s.weight.target_kg) })
                : tr("weekly.keeping")}
            </Txt>
          ) : (
            <Txt variant="small">{tr("weekly.noWeighIn")}</Txt>
          )}
        </SummaryRow>

        <SummaryRow icon="sparkles" title={tr("nav.points")}>
          <Txt variant="small">
            {tr("weekly.points", { n: s.points })}{s.previous_points ? tr("weekly.pointsLast", { n: s.previous_points }) : ""}
          </Txt>
        </SummaryRow>
      </Card>

      <Card>
        <Txt variant="h3">{tr("weekly.plannedVsDone")}</Txt>
        <Txt variant="tiny" style={{ marginBottom: space.sm }}>
          {tr("weekly.last8")}
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
        <Icon name={icon} size={16} color={t.text2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontWeight: "600" }}>{title}</Txt>
        {children}
      </View>
    </Row>
  );
}

function setText(top: { weight_kg: number; reps: number }, u: ReturnType<typeof units>) {
  return top.weight_kg > 0 ? `${u.weight(top.weight_kg)} × ${top.reps}` : tr("weekly.reps", { n: top.reps });
}

function WeekDays({ summary }: { summary: Summary }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: space.md }}>
      {summary.days.map((d, i) => {
        const upcoming = d.future || d.date === todayISO();
        const status = tr(
          d.trained ? (d.planned ? "weekly.statusDone" : "weekly.statusExtra") : d.planned ? (upcoming ? "weekly.statusPlanned" : "weekly.statusMissed") : "workouts.rest",
        );
        const filled = d.trained;
        return (
          <View
            key={d.date}
            accessibilityLabel={tr("weekly.dayStatus", { day: WEEKDAYS_SHORT[i], status })}
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
              <Icon name="checkmark-circle" size={18} color={t.accent} />
            ) : (
              <Txt variant="tiny" style={{ color: t.muted }}>
                {d.planned ? (d.date === todayISO() ? tr("today.today") : d.future ? tr("weekly.plan") : "–") : tr("workouts.rest")}
              </Txt>
            )}
          </View>
        );
      })}
    </View>
  );
}
