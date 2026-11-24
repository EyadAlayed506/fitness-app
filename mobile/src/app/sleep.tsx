import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { LastNightCard, SleepConsistencyCard, SleepGoalForm, SleepWeekCard } from "@/components/SleepDashboard";
import { SleepChart, SleepForm, qualityChoices, qualityLabel, trackerSummary } from "@/components/SleepParts";
import { AppleHealthCard } from "@/components/AppleHealthCard";
import { HealthConnectCard } from "@/components/HealthConnectCard";
import { StepsCard } from "@/components/StepsCard";
import { Badge, Card, EmptyState, ListRow, Loading, Section, Sheet, SkeletonCards, Txt, useToast } from "@/components/ui";
import { WhoopCard, syncSummary } from "@/components/WhoopCard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockOf, hoursMinutes, longDate, trackerName, tzOffset } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useWhoopAutoSync, useWhoopStatus } from "@/lib/data";
import { useAppleHealthAutoSync, useAppleHealthStatus } from "@/lib/appleHealth";
import { useHealthConnectAutoSync, useHealthConnectStatus } from "@/lib/healthConnect";
import { syncSummary as healthConnectSummary } from "@/lib/healthConnectSessions";
import { derivedKeys, invalidate, qk, useRefreshOnFocus } from "@/lib/query";
import { space, useTheme } from "@/lib/theme";
import type { SleepAnalytics, SleepEntry } from "@/lib/types";

type SheetState = { kind: "new" } | { kind: "edit"; entry: SleepEntry } | { kind: "goal" } | null;

export default function Sleep() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  return <SleepScreen />;
}

/** The screen itself, once the login has been restored (so its data loads with it). */
function SleepScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const [sheet, setSheet] = useState<SheetState>(null);
  const screen = useQuery({
    queryKey: [...qk.sleep, "screen"],
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
  const healthConnectQuery = useHealthConnectStatus();
  // and from Health Connect (Android)
  useHealthConnectAutoSync(!!healthConnectQuery.data?.connected, 15, (r) => {
    if (r.imported || r.replaced_manual) toast(healthConnectSummary(r));
  });
  const appleHealthQuery = useAppleHealthStatus();
  // and from Apple Health (iPhone)
  useAppleHealthAutoSync(!!appleHealthQuery.data?.connected, 15, (r) => {
    if (r.imported || r.replaced_manual) toast(healthConnectSummary(r, "ah.synced"));
  });
  const entries = screen.data?.list ?? [];
  const stats = screen.data?.analytics ?? null;
  const whoop = whoopQuery.data ?? null;
  const load = async () => {
    invalidate(qk.sleep, qk.whoop, qk.healthConnect, qk.appleHealth, qk.health, ...derivedKeys);
  };

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

      <HealthConnectCard status={healthConnectQuery.data ?? null} onChanged={load} toast={toast} />
      <AppleHealthCard status={appleHealthQuery.data ?? null} onChanged={load} toast={toast} />
      <StepsCard />

      <WhoopCard
        status={whoop}
        onChanged={async () => {
          await load();
        }}
        onLogManually={() => setSheet({ kind: "new" })}
        toast={toast}
      />

      {stats ? <SleepChart data={stats} /> : null}

      <Section title={tr("workouts.history")} action={tr("home.logSleep")} onAction={() => setSheet({ kind: "new" })} />
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
              right={e.source !== "manual" ? <Badge label={trackerName(e.source) ?? ""} tone="info" /> : undefined}
              onPress={() => setSheet({ kind: "edit", entry: e })}
            />
          ))
        ) : (
          <EmptyState
            icon="moon-outline"
            title={tr("sleep.noSleepTitle")}
            text={tr("sleep.noSleepText")}
            action={tr("home.logSleep")}
            onAction={() => setSheet({ kind: "new" })}
          />
        )}
      </Card>
      <Txt variant="tiny" style={{ textAlign: "center", marginTop: space.xs, paddingHorizontal: space.sm }}>
        {tr("sleep.qualityNote", { scale: qualityChoices().map((q) => `${q.value} = ${q.label}`).join(tr("list.separator")) })}
      </Txt>

      <Sheet visible={sheet?.kind === "new"} title={tr("home.logSleep")} onClose={() => setSheet(null)}>
        {sheet?.kind === "new" ? <SleepForm onSaved={saved} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "goal"} title={tr("sleep.goalTitle")} onClose={() => setSheet(null)}>
        {sheet?.kind === "goal" && stats ? <SleepGoalForm data={stats} onSaved={saved} /> : null}
      </Sheet>
      <Sheet visible={sheet?.kind === "edit"} title={tr("sleep.edit")} onClose={() => setSheet(null)}>
        {sheet?.kind === "edit" ? <SleepForm entry={sheet.entry} onSaved={saved} /> : null}
      </Sheet>
    </ScrollView>
  );
}
