import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";

import { useTheme } from "@/lib/theme";
import type { Recommendation, Recommendations } from "@/lib/types";

import { Card, CardHead, LinkButton, Row, Txt } from "./ui";

const ICON: Record<Recommendation["kind"], keyof typeof Ionicons.glyphMap> = {
  plan: "barbell-outline",
  rest: "bed-outline",
  lighter: "leaf-outline",
  progress: "trending-up-outline",
  info: "information-circle-outline",
};

/** Today's suggestions: the planned session or rest day, plus anything worth adjusting, each with its reasons. */
export function TodayCard({ data }: { data: Recommendations }) {
  const t = useTheme();
  const tone = (kind: Recommendation["kind"]) => (kind === "lighter" ? t.warnInk : kind === "progress" ? t.goodInk : t.accent);
  return (
    <Card>
      <CardHead title="Today" right={<LinkButton title="Workouts ›" onPress={() => router.push("/workouts")} />} />
      <View style={{ gap: 12 }}>
        {data.items.map((r) => (
          <Row key={`${r.id}-${r.title}`} gap={10} style={{ alignItems: "flex-start" }}>
            <Ionicons name={ICON[r.kind]} size={22} color={tone(r.kind)} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: "700" }}>{r.title}</Txt>
              <Txt variant="small">{r.message}</Txt>
              {r.reasons.map((why) => (
                <Txt key={why} variant="tiny" style={{ marginTop: 2 }}>
                  Why: {why}
                </Txt>
              ))}
              <Txt variant="tiny" style={{ marginTop: 1 }}>
                Based on: {r.sources.join(", ")}
              </Txt>
            </View>
          </Row>
        ))}
      </View>
      <Txt variant="tiny" style={{ marginTop: 12 }}>
        {data.disclaimer}
      </Txt>
    </Card>
  );
}
