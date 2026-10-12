import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { Recommendation, Recommendations } from "@/lib/types";

import { Button, Card, Divider, Txt, type IconName } from "./ui";

const ICON: Record<Recommendation["kind"], IconName> = {
  plan: "barbell",
  rest: "bed",
  lighter: "leaf",
  progress: "trending-up",
  info: "information-circle",
};

/**
 * Today's plan: the planned session (or rest day) leads, with one clear action. Anything worth
 * adjusting follows as quieter rows. The reasons behind each suggestion are one tap away.
 */
export function TodayCard({ data }: { data: Recommendations }) {
  const t = useTheme();
  const [why, setWhy] = useState(false);
  const [lead, ...rest] = data.items;
  if (!lead) return null;
  const tone = (kind: Recommendation["kind"]) =>
    kind === "lighter" ? t.warnInk : kind === "progress" ? t.goodInk : kind === "info" ? t.text2 : t.accent;
  const soft = (kind: Recommendation["kind"]) =>
    kind === "lighter" ? t.warnSoft : kind === "progress" ? t.goodSoft : kind === "info" ? t.surface2 : t.accentSoft;
  const training = lead.kind === "plan" || lead.kind === "lighter";

  return (
    <Card style={{ padding: space.lg + 2 }}>
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: soft(lead.kind), alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={ICON[lead.kind]} size={20} color={tone(lead.kind)} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
            {training ? "TODAY'S SESSION" : "TODAY"}
          </Txt>
          <Txt style={{ ...typeScale.heading, fontSize: 19, lineHeight: 24, color: t.text }} numberOfLines={2}>
            {lead.title.replace(/^Today:\s*/, "")}
          </Txt>
        </View>
      </View>
      <Txt variant="small" style={{ marginTop: space.md }}>
        {lead.message}
      </Txt>

      {rest.map((r) => (
        <View key={`${r.id}-${r.title}`}>
          <Divider />
          <View style={{ flexDirection: "row", gap: space.md, paddingVertical: space.md, alignItems: "flex-start" }}>
            <Ionicons name={ICON[r.kind]} size={18} color={tone(r.kind)} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: "600" }}>{r.title}</Txt>
              <Txt variant="small">{r.message}</Txt>
            </View>
          </View>
        </View>
      ))}

      <View style={{ flexDirection: "row", gap: space.sm, marginTop: rest.length ? space.xs : space.lg }}>
        <Button
          title={training ? "Start workout" : "Open workouts"}
          icon={training ? "play" : undefined}
          kind={training ? "primary" : "soft"}
          onPress={() => router.navigate(training ? { pathname: "/workouts", params: { start: "today" } } : "/workouts")}
          style={{ flex: 1 }}
        />
        <Pressable
          onPress={() => setWhy((w) => !w)}
          accessibilityRole="button"
          aria-expanded={why}
          accessibilityLabel="Why these suggestions"
          style={({ pressed }) => ({
            minHeight: 50,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Txt variant="label">Why?</Txt>
          <Ionicons name={why ? "chevron-up" : "chevron-down"} size={14} color={t.text2} />
        </Pressable>
      </View>

      {why ? (
        <View style={{ marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: t.surface2, gap: space.sm }}>
          {data.items.map((r) => (
            <View key={`why-${r.id}-${r.title}`}>
              <Txt variant="label" style={{ color: t.text }}>
                {r.title}
              </Txt>
              {r.reasons.map((reason) => (
                <Txt key={reason} variant="small">
                  • {reason}
                </Txt>
              ))}
              <Txt variant="tiny">Based on: {r.sources.join(", ")}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      <Txt variant="tiny" style={{ marginTop: space.md }}>
        {data.disclaimer}
      </Txt>
    </Card>
  );
}
