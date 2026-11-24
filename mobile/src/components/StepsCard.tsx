import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";

import { api } from "@/lib/api";
import { fmt, shortDate, trackerName, tzOffset } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useTheme } from "@/lib/theme";
import type { StepsDay } from "@/lib/types";

import { Card, Row, Txt } from "./ui";

/**
 * Daily steps from the phone (Health Connect or Apple Health), last 7 days. A day without data says so;
 * it is never shown as 0. Hidden until the phone has sent steps at least once.
 */
export function StepsCard() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const query = useQuery({
    queryKey: qk.steps(7),
    queryFn: () => api<{ days: StepsDay[] }>(`/health/steps?days=7&tz_offset=${tzOffset()}`),
  });
  const days = query.data?.days ?? [];
  if (!days.some((d) => d.steps !== null)) return null;
  const today = days[days.length - 1];
  const source = [...days].reverse().find((d) => d.source)?.source ?? null;

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="h3">{tr("steps.title")}</Txt>
        {source ? <Txt variant="tiny">{tr("steps.from", { source: trackerName(source) ?? "" })}</Txt> : null}
      </Row>
      <Txt style={{ marginTop: 4, fontWeight: "700" }}>
        {today?.steps != null ? tr("steps.today", { n: fmt(today.steps) }) : tr("steps.noToday")}
      </Txt>
      <Txt variant="tiny" style={{ marginTop: 10 }}>
        {tr("steps.lastWeek")}
      </Txt>
      <View style={{ marginTop: 4, gap: 2 }}>
        {days.map((d) => (
          <Row key={d.date} style={{ justifyContent: "space-between" }}>
            <Txt variant="small">{shortDate(d.date)}</Txt>
            <Txt variant="small" style={d.steps === null ? { color: t.muted } : undefined}>
              {d.steps === null ? tr("steps.missing") : fmt(d.steps)}
            </Txt>
          </Row>
        ))}
      </View>
    </Card>
  );
}
