import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { AwardRow, LevelMeter } from "@/components/PointsParts";
import { Card, EmptyState, Loading, Meter, Row, Section, SkeletonCards, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tzOffset } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
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

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, width: "100%", maxWidth: 600, alignSelf: "center" }}>
      {data ? <PointsBody data={data} /> : <SkeletonCards count={3} />}
    </ScrollView>
  );
}

function PointsBody({ data }: { data: Points }) {
  const t = useTheme();
  return (
    <>
      <Card>
        <LevelMeter data={data} />
      </Card>

      <Section title="Last 2 weeks" />
      <Card>
        {data.recent.length ? (
          data.recent.map((a, i) => <AwardRow key={`${a.rule}-${a.day}`} award={a} showDay first={i === 0} />)
        ) : (
          <EmptyState icon="sparkles-outline" title="No points yet" text="Finish a workout, log your sleep or your meals to earn some." />
        )}
      </Card>

      <Section title="Achievements" />
      <Card>
        <View style={{ gap: space.lg }}>
          {data.achievements.map((a) => (
            <Row key={a.id} gap={space.md}>
              <View style={{ width: 36, height: 36, borderRadius: radius.sm + 2, backgroundColor: a.earned ? t.warnSoft : t.surface2, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={a.earned ? "trophy" : "trophy-outline"} size={18} color={a.earned ? t.warnInk : t.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: "600", color: a.earned ? t.text : t.text2 }}>{a.title}</Txt>
                <Txt variant="tiny">{a.description}</Txt>
                {!a.earned ? (
                  <View style={{ marginTop: 4 }}>
                    <Meter value={a.progress} max={a.target} height={4} />
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
        <View style={{ gap: space.md }}>
          {data.rules.map((r) => (
            <View key={r.id}>
              <Txt style={{ fontWeight: "600" }}>
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
    </>
  );
}
