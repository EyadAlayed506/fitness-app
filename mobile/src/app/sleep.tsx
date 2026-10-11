import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";

import { QUALITY, SleepChart, SleepForm, qualityLabel, rangeBadge } from "@/components/SleepParts";
import { Button, Card, ListRow, Loading, Row, Section, Sheet, Stat, Txt, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockOf, fmt, hoursMinutes, longDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry } from "@/lib/types";

type SheetState = { kind: "new" } | { kind: "edit"; entry: SleepEntry } | null;

export default function Sleep() {
  const t = useTheme();
  const toast = useToast();
  const { ready, token } = useAuth();
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [stats, setStats] = useState<SleepAnalytics | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  const load = useCallback(async () => {
    const [list, analytics] = await Promise.all([api<SleepEntry[]>("/sleep?limit=60"), api<SleepAnalytics>("/analytics/sleep?days=14")]);
    setEntries(list);
    setStats(analytics);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (token) load().catch(() => {});
    }, [load, token]),
  );

  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;

  const saved = async (message: string) => {
    setSheet(null);
    toast(message);
    await load();
  };
  const range = stats?.recommended_hours ?? [7, 9];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40, width: "100%", maxWidth: 560, alignSelf: "center" }}>
      <Card>
        <Row>
          <Stat label="7-day average" value={stats?.average_hours_7d != null ? hoursMinutes(stats.average_hours_7d * 60) : "–"} />
          <Stat label="Avg. quality" value={stats?.average_quality_7d != null ? `${fmt(stats.average_quality_7d, 1)} / 5` : "–"} />
        </Row>
        <Row style={{ marginTop: 10, justifyContent: "space-between" }}>
          <Txt variant="small">
            {stats ? `${stats.nights_logged_7d} of the last 7 nights logged · aim for ${range[0]}–${range[1]} h` : " "}
          </Txt>
          {rangeBadge(stats?.average_hours_7d ?? null, range)}
        </Row>
        <Button title="Log sleep" icon="moon" onPress={() => setSheet({ kind: "new" })} style={{ marginTop: 12 }} />
      </Card>

      {stats ? <SleepChart data={stats} /> : null}

      <Section title="History" />
      <Card>
        {entries.length ? (
          entries.map((e, i) => (
            <ListRow
              key={e.id}
              first={i === 0}
              title={`${longDate(e.date)} · ${hoursMinutes(e.duration_minutes)}`}
              subtitle={`${clockOf(e.bedtime)} → ${clockOf(e.wake_time)}${e.quality ? ` · ${qualityLabel(e.quality)}` : ""}${e.notes ? ` · ${e.notes}` : ""}`}
              onPress={() => setSheet({ kind: "edit", entry: e })}
            />
          ))
        ) : (
          <Txt variant="muted" style={{ textAlign: "center" }}>
            No sleep logged yet.
          </Txt>
        )}
      </Card>
      <Txt variant="tiny" style={{ textAlign: "center", marginTop: 4 }}>
        Quality: {QUALITY.map((q) => `${q.value} = ${q.label}`).join(", ")}. Recommended hours follow CDC / National Sleep Foundation guidance for your age.
      </Txt>

      <Sheet visible={sheet?.kind === "new"} title="Log sleep" onClose={() => setSheet(null)}>
        {sheet?.kind === "new" ? <SleepForm onSaved={saved} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "edit"} title="Edit sleep" onClose={() => setSheet(null)}>
        {sheet?.kind === "edit" ? <SleepForm entry={sheet.entry} onSaved={saved} /> : null}
      </Sheet>
    </ScrollView>
  );
}
