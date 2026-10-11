import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { AwardRow, LevelMeter } from "@/components/PointsParts";
import { Card, Loading, Meter, Row, Section, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tzOffset } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { Points } from "@/lib/types";

export default function PointsScreen() {
  const t = useTheme();
  const { ready, token } = useAuth();
  const [data, setData] = useState<Points | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      api<Points>(`/points?tz_offset=${tzOffset()}`).then(setData).catch(() => {});
    }, [token]),
  );

  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  if (!data) return <Loading />;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40, width: "100%", maxWidth: 560, alignSelf: "center" }}>
      <Card>
        <LevelMeter data={data} />
      </Card>

      <Section title="Last 2 weeks" />
      <Card>
        {data.recent.length ? (
          data.recent.map((a) => <AwardRow key={`${a.rule}-${a.day}`} award={a} showDay />)
        ) : (
          <Txt variant="muted" style={{ textAlign: "center" }}>
            No points yet. Finish a workout, log your sleep or your meals to earn some.
          </Txt>
        )}
      </Card>

      <Section title="Achievements" />
      <Card>
        <View style={{ gap: 12 }}>
          {data.achievements.map((a) => (
            <Row key={a.id} gap={10}>
              <Ionicons name={a.earned ? "trophy" : "trophy-outline"} size={22} color={a.earned ? t.warn : t.muted} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: "700", color: a.earned ? t.text : t.text2 }}>{a.title}</Txt>
                <Txt variant="tiny">{a.description}</Txt>
                {!a.earned ? (
                  <View style={{ marginTop: 4 }}>
                    <Meter value={a.progress} max={a.target} height={6} />
                  </View>
                ) : null}
              </View>
              <Txt variant="small">{a.earned ? "Earned" : `${a.progress}/${a.target}`}</Txt>
            </Row>
          ))}
        </View>
      </Card>

      <Section title="How points work" />
      <Card>
        <View style={{ gap: 8 }}>
          {data.rules.map((r) => (
            <View key={r.id}>
              <Txt style={{ fontWeight: "700" }}>
                {r.label} · +{r.points}
              </Txt>
              <Txt variant="small">{r.description}</Txt>
            </View>
          ))}
        </View>
        <Txt variant="tiny" style={{ marginTop: 10 }}>
          Points are never taken away and there are no penalties for missed days. Only recorded data counts; awards
          show whether the data came from WHOOP or was logged by you.
        </Txt>
      </Card>
    </ScrollView>
  );
}
