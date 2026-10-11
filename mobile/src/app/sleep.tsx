import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";

import { QUALITY, SleepChart, SleepForm, qualityLabel, rangeBadge, trackerSummary } from "@/components/SleepParts";
import { Badge, Card, ListRow, Loading, Row, Section, Sheet, Stat, Txt, useToast } from "@/components/ui";
import { WhoopCard, syncSummary } from "@/components/WhoopCard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockOf, fmt, hoursMinutes, longDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry, WhoopStatus, WhoopSyncResult } from "@/lib/types";

type SheetState = { kind: "new" } | { kind: "edit"; entry: SleepEntry } | null;

export default function Sleep() {
  const t = useTheme();
  const toast = useToast();
  const { ready, token } = useAuth();
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [stats, setStats] = useState<SleepAnalytics | null>(null);
  const [whoop, setWhoop] = useState<WhoopStatus | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  const load = useCallback(async () => {
    const [list, analytics, status] = await Promise.all([
      api<SleepEntry[]>("/sleep?limit=60"),
      api<SleepAnalytics>("/analytics/sleep?days=14"),
      api<WhoopStatus>("/whoop"),
    ]);
    setEntries(list);
    setStats(analytics);
    setWhoop(status);
    return status;
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      (async () => {
        const status = await load();
        // Pull new WHOOP sleep when the screen opens (at most every 15 minutes)
        if (status.connected) {
          const r = await api<WhoopSyncResult>("/whoop/sync?stale_minutes=15", { method: "POST" }).catch(() => null);
          if (r && !r.skipped) {
            if (r.imported || r.replaced_manual) toast(syncSummary(r));
            await load();
          }
        }
      })().catch(() => {});
    }, [load, token, toast]),
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
      </Card>

      <WhoopCard
        status={whoop}
        onChanged={async () => {
          await load();
        }}
        onLogManually={() => setSheet({ kind: "new" })}
        toast={toast}
      />

      {stats ? <SleepChart data={stats} /> : null}

      <Section title="History" />
      <Card>
        {entries.length ? (
          entries.map((e, i) => (
            <ListRow
              key={e.id}
              first={i === 0}
              title={`${longDate(e.date)} · ${hoursMinutes(e.duration_minutes)}`}
              subtitle={[
                `${clockOf(e.bedtime)} → ${clockOf(e.wake_time)}`,
                e.quality ? qualityLabel(e.quality) : "",
                e.source !== "manual" ? trackerSummary(e) : "",
                e.notes,
              ]
                .filter(Boolean)
                .join(" · ")}
              right={e.source === "whoop" ? <Badge label="WHOOP" tone="info" /> : undefined}
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
