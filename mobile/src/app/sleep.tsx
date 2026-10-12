import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { LastNightCard, SleepConsistencyCard, SleepGoalForm, SleepWeekCard } from "@/components/SleepDashboard";
import { QUALITY, SleepChart, SleepForm, qualityLabel, trackerSummary } from "@/components/SleepParts";
import { Badge, Card, EmptyState, ListRow, Loading, Section, Sheet, SkeletonCards, Txt, useToast } from "@/components/ui";
import { WhoopCard, syncSummary } from "@/components/WhoopCard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockOf, hoursMinutes, longDate, tzOffset } from "@/lib/format";
import { useWhoopAutoSync, useWhoopStatus } from "@/lib/data";
import { derivedKeys, invalidate, qk, useRefreshOnFocus } from "@/lib/query";
import { space, useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry } from "@/lib/types";

type SheetState = { kind: "new" } | { kind: "edit"; entry: SleepEntry } | { kind: "goal" } | null;

export default function Sleep() {
  const t = useTheme();
  const toast = useToast();
  const { ready, token } = useAuth();
  const [sheet, setSheet] = useState<SheetState>(null);
  const screen = useQuery({
    queryKey: [...qk.sleep, "screen"],
    enabled: !!token,
    queryFn: async () => {
      // give any sleep-goal points first, so the nights that earned them are marked
      await api(`/points?tz_offset=${tzOffset()}`).catch(() => null);
      const [list, analytics] = await Promise.all([
        api<SleepEntry[]>("/sleep?limit=60"),
        api<SleepAnalytics>(`/analytics/sleep?days=14&tz_offset=${tzOffset()}`),
      ]);
      return { list, analytics };
    },
  });
  const whoopQuery = useWhoopStatus();
  useRefreshOnFocus([qk.sleep, qk.whoop]);
  // Pull new WHOOP sleep when the screen opens (at most every 15 minutes)
  useWhoopAutoSync(!!whoopQuery.data?.connected, 15, (r) => {
    if (!r.skipped && (r.imported || r.replaced_manual)) toast(syncSummary(r));
  });
  const entries = screen.data?.list ?? [];
  const stats = screen.data?.analytics ?? null;
  const whoop = whoopQuery.data ?? null;
  const load = async () => {
    invalidate(qk.sleep, qk.whoop, ...derivedKeys);
  };

  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;

  const saved = async (message: string) => {
    setSheet(null);
    toast(message);
    await load();
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, width: "100%", maxWidth: 600, alignSelf: "center" }}>
      {stats ? null : <SkeletonCards count={2} />}
      {stats ? <LastNightCard data={stats} onEditGoal={() => setSheet({ kind: "goal" })} /> : null}
      {stats ? <SleepWeekCard data={stats} /> : null}
      {stats ? <SleepConsistencyCard data={stats} /> : null}

      <WhoopCard
        status={whoop}
        onChanged={async () => {
          await load();
        }}
        onLogManually={() => setSheet({ kind: "new" })}
        toast={toast}
      />

      {stats ? <SleepChart data={stats} /> : null}

      <Section title="History" action="Log sleep" onAction={() => setSheet({ kind: "new" })} />
      <Card style={entries.length ? { paddingVertical: space.xs } : undefined}>
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
          <EmptyState
            icon="moon-outline"
            title="No sleep logged yet"
            text="Log last night by hand, or connect WHOOP to import it."
            action="Log sleep"
            onAction={() => setSheet({ kind: "new" })}
          />
        )}
      </Card>
      <Txt variant="tiny" style={{ textAlign: "center", marginTop: space.xs, paddingHorizontal: space.sm }}>
        Quality: {QUALITY.map((q) => `${q.value} = ${q.label}`).join(", ")}. Recommended hours follow CDC / National Sleep Foundation guidance for your age.
      </Txt>

      <Sheet visible={sheet?.kind === "new"} title="Log sleep" onClose={() => setSheet(null)}>
        {sheet?.kind === "new" ? <SleepForm onSaved={saved} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "goal"} title="Sleep goal" onClose={() => setSheet(null)}>
        {sheet?.kind === "goal" && stats ? <SleepGoalForm data={stats} onSaved={saved} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "edit"} title="Edit sleep" onClose={() => setSheet(null)}>
        {sheet?.kind === "edit" ? <SleepForm entry={sheet.entry} onSaved={saved} /> : null}
      </Sheet>
    </ScrollView>
  );
}
