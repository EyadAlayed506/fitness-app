import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";

import { fmt } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { PointAward, Points } from "@/lib/types";

import { Badge, Card, CardHead, LinkButton, Meter, Row, Txt } from "./ui";

export const sourceLabel = (a: PointAward) => (a.data_source === "whoop" ? "WHOOP" : "Logged by you");

/** Level, progress to the next one, and what earned points today. */
export function LevelMeter({ data }: { data: Points }) {
  const span = data.next_level_at - data.level_start;
  return (
    <View>
      <Row style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <Txt>
          <Txt variant="big">Level {data.level}</Txt>
          <Txt variant="muted"> · {fmt(data.total)} points</Txt>
        </Txt>
        <Txt variant="small">{fmt(data.next_level_at - data.total)} to level {data.level + 1}</Txt>
      </Row>
      <View style={{ marginTop: 8 }}>
        <Meter value={data.total - data.level_start} max={span} />
      </View>
    </View>
  );
}

export function AwardRow({ award, showDay = false }: { award: PointAward; showDay?: boolean }) {
  const t = useTheme();
  return (
    <Row style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.border }} gap={10}>
      <Txt style={{ fontWeight: "700", color: t.goodInk, width: 40 }}>+{award.points}</Txt>
      <View style={{ flex: 1 }}>
        <Txt variant="small" style={{ color: t.text }}>
          {award.reason}
        </Txt>
        <Txt variant="tiny">
          {showDay ? `${new Date(`${award.day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}
          {sourceLabel(award)}
        </Txt>
      </View>
    </Row>
  );
}

export function PointsCard({ data }: { data: Points }) {
  const t = useTheme();
  return (
    <Card>
      <CardHead title="Wellness points" right={<LinkButton title="Details ›" onPress={() => router.push("/points")} />} />
      <LevelMeter data={data} />
      <Row style={{ marginTop: 12, marginBottom: 2 }} gap={6}>
        <Ionicons name="sparkles-outline" size={16} color={t.accent} />
        <Txt variant="small">{data.today.points ? `${data.today.points} points today` : "No points yet today"}</Txt>
        {data.achievements.filter((a) => a.earned).length ? (
          <Badge label={`${data.achievements.filter((a) => a.earned).length} achievements`} tone="good" />
        ) : null}
      </Row>
      {data.today.awards.map((a) => (
        <AwardRow key={`${a.rule}-${a.day}`} award={a} />
      ))}
      {!data.today.points ? (
        <Txt variant="tiny">Points come from finished workouts, sleep, eating to plan and weigh-ins. Rest days never cost you points.</Txt>
      ) : null}
    </Card>
  );
}
