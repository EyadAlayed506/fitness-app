import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { useInsights } from "@/lib/data";
import { fmt, hoursMinutes } from "@/lib/format";
import { errorMessage } from "@/lib/query";
import { space, useTheme } from "@/lib/theme";
import type { Insight } from "@/lib/types";

import { Badge, Card, EmptyState, ErrorText, FadeIn, Meter, Row, Section, SkeletonCards, Txt } from "./ui";

/** "7 h 14 min" for sleep, "103.2 % of usual", "8 done" */
const valueText = (value: number, unit: string) => (unit === "min" ? hoursMinutes(value) : `${fmt(value, 1)} ${unit}`);

const STRENGTH: Record<string, { label: string; tone: "info" | "neutral" }> = {
  clear: { label: "Clear difference", tone: "info" },
  "could be chance": { label: "Could be chance", tone: "neutral" },
  count: { label: "Count", tone: "neutral" },
};

/**
 * Patterns in the user's own data (sleep, training, food, weight). Each shows how many days or sessions
 * it rests on; findings without enough data aren't shown, only what would unlock them. Nothing here
 * says one thing causes another.
 */
export function InsightsView() {
  const t = useTheme();
  const query = useInsights();
  if (query.isPending) return <SkeletonCards count={2} />;
  if (!query.data) return <ErrorText message={errorMessage(query.error) ?? "Couldn't load your insights"} />;
  const { insights, not_enough, note } = query.data;
  return (
    <FadeIn key="insights">
      <Row gap={space.sm} style={{ alignItems: "flex-start", paddingHorizontal: space.xs, marginBottom: space.md }}>
        <Ionicons name="information-circle-outline" size={18} color={t.text2} style={{ marginTop: 1 }} />
        <Txt variant="small" style={{ flex: 1 }}>
          {note} Only patterns with enough data are shown, with how much data each one is based on.
        </Txt>
      </Row>
      {insights.length ? (
        insights.map((i) => <InsightCard key={i.id} insight={i} />)
      ) : (
        <Card>
          <EmptyState
            icon="analytics-outline"
            title="Not enough data yet"
            text="Keep logging workouts, sleep, food and weight. Patterns show up here once there's enough to compare."
          />
        </Card>
      )}
      {not_enough.length ? (
        <>
          <Section title="Needs more data" />
          <Card>
            {not_enough.map((text, k) => (
              <Row key={text} gap={space.sm} style={{ alignItems: "flex-start", marginTop: k ? space.md : 0 }}>
                <Ionicons name="hourglass-outline" size={16} color={t.muted} style={{ marginTop: 2 }} />
                <Txt variant="small" style={{ flex: 1 }}>
                  {text}
                </Txt>
              </Row>
            ))}
          </Card>
        </>
      ) : null}
    </FadeIn>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const t = useTheme();
  const strength = STRENGTH[insight.strength] ?? STRENGTH.count;
  const max = Math.max(...insight.groups.map((g) => g.value), 0);
  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }} gap={space.sm}>
        <Txt variant="h3" style={{ flex: 1 }}>
          {insight.title}
        </Txt>
        <Badge label={strength.label} tone={strength.tone} />
      </Row>
      <Txt style={{ marginTop: space.xs }}>{insight.text}</Txt>
      <View style={{ marginTop: space.md, gap: space.md }}>
        {insight.groups.map((g) => (
          <View key={g.label} accessible accessibilityLabel={`${g.label}: ${valueText(g.value, g.unit)}, ${g.n} ${g.n === 1 ? "sample" : "samples"}`}>
            <Row style={{ justifyContent: "space-between" }} gap={space.sm}>
              <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>
                {g.label}
              </Txt>
              <Txt variant="small" style={{ color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                {valueText(g.value, g.unit)}
              </Txt>
            </Row>
            <View style={{ marginTop: 6 }}>
              <Meter value={g.value} max={max || 1} color={t.accent} />
            </View>
            <Txt variant="tiny" style={{ marginTop: 2 }}>
              n = {g.n}
            </Txt>
          </View>
        ))}
      </View>
      <Txt variant="tiny" style={{ marginTop: space.md }}>
        {insight.caution}
      </Txt>
    </Card>
  );
}
