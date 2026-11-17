import { Redirect } from "expo-router";
import { ScrollView, View } from "react-native";

import { AwardRow, LevelMeter } from "@/components/PointsParts";
import { Card, EmptyState, Icon, Loading, Meter, Row, Section, SkeletonCards, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePoints } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk, useRefreshOnFocus } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { Points } from "@/lib/types";

export default function PointsScreen() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  return <PointsContent />;
}

/** The screen itself, once the login has been restored (so its data loads with it). */
function PointsContent() {
  const t = useTheme();
  const points = usePoints();
  useRefreshOnFocus([qk.points]);
  const data = points.data ?? null;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, width: "100%", maxWidth: 600, alignSelf: "center" }}>
      {data ? <PointsBody data={data} /> : <SkeletonCards count={3} />}
    </ScrollView>
  );
}

function PointsBody({ data }: { data: Points }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <>
      <Card>
        <LevelMeter data={data} />
      </Card>

      <Section title={tr("points.last2")} />
      <Card>
        {data.recent.length ? (
          data.recent.map((a, i) => <AwardRow key={`${a.rule}-${a.day}`} award={a} showDay first={i === 0} />)
        ) : (
          <EmptyState icon="sparkles-outline" title={tr("points.noneTitle")} text={tr("points.noneText")} />
        )}
      </Card>

      <Section title={tr("points.achievements")} />
      <Card>
        <View style={{ gap: space.lg }}>
          {data.achievements.map((a) => (
            <Row key={a.id} gap={space.md}>
              <View style={{ width: 36, height: 36, borderRadius: radius.sm + 2, backgroundColor: a.earned ? t.warnSoft : t.surface2, alignItems: "center", justifyContent: "center" }}>
                <Icon name={a.earned ? "trophy" : "trophy-outline"} size={18} color={a.earned ? t.warnInk : t.muted} />
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
              <Txt variant="small">{a.earned ? tr("points.earned") : `${a.progress}/${a.target}`}</Txt>
            </Row>
          ))}
        </View>
      </Card>

      <Section title={tr("points.how")} />
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
          {tr("points.fairness")}
        </Txt>
      </Card>
    </>
  );
}
