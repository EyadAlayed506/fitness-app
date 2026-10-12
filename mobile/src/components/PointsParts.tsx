import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";

import { fmt } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import type { PointAward, Points } from "@/lib/types";

import { Card, Meter, Row, Txt } from "./ui";

export const sourceLabel = (a: PointAward) => (a.data_source === "whoop" ? "WHOOP" : "Logged by you");

/** Level, progress to the next one, and what earned points today. */
export function LevelMeter({ data }: { data: Points }) {
  const span = data.next_level_at - data.level_start;
  return (
    <View>
      <Row style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
        <Txt>
          <Txt variant="big">Level {data.level}</Txt>
          <Txt variant="muted"> · {fmt(data.total)} pts</Txt>
        </Txt>
        <Txt variant="small">{fmt(data.next_level_at - data.total)} to level {data.level + 1}</Txt>
      </Row>
      <View style={{ marginTop: space.md }}>
        <Meter value={data.total - data.level_start} max={span} />
      </View>
    </View>
  );
}

export function AwardRow({ award, showDay = false, first = false }: { award: PointAward; showDay?: boolean; first?: boolean }) {
  const t = useTheme();
  return (
    <Row
      style={{ paddingVertical: space.md - 2, borderTopWidth: first ? 0 : 1, borderTopColor: t.border, alignItems: "flex-start" }}
      gap={space.md}
    >
      <View style={{ minWidth: 40, paddingVertical: 2, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: t.goodSoft, alignItems: "center" }}>
        <Txt variant="label" style={{ color: t.goodInk }}>
          +{award.points}
        </Txt>
      </View>
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

/** A compact level-and-today summary for Home. The full history lives on the Points screen. */
export function PointsCard({ data }: { data: Points }) {
  const t = useTheme();
  const earned = data.achievements.filter((a) => a.earned).length;
  return (
    <Card onPress={() => router.push("/points")}>
      <Row gap={space.md}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="sparkles" size={18} color={t.text2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt style={{ fontWeight: "600" }}>
              Level {data.level} <Txt variant="small">· {fmt(data.total)} pts</Txt>
            </Txt>
            <Txt variant="small" style={{ color: data.today.points ? t.goodInk : t.muted, fontWeight: "600" }}>
              {data.today.points ? `+${data.today.points} today` : "0 today"}
            </Txt>
          </Row>
          <View style={{ marginTop: space.sm }}>
            <Meter value={data.total - data.level_start} max={data.next_level_at - data.level_start} height={4} />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Row>
      {data.today.awards.length ? (
        <View style={{ marginTop: space.md }}>
          {data.today.awards.map((a, i) => (
            <AwardRow key={`${a.rule}-${a.day}`} award={a} first={i === 0} />
          ))}
        </View>
      ) : (
        <Txt variant="tiny" style={{ marginTop: space.md }}>
          Earn points for finished workouts, sleep, eating to plan and weigh-ins
          {earned ? ` · ${earned} achievement${earned === 1 ? "" : "s"} earned` : ""}. Rest days never cost you points.
        </Txt>
      )}
    </Card>
  );
}
