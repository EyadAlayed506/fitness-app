/**
 * Health Connect sleep records -> what POST /api/sleep/health-connect expects.
 * Pure (no React Native), so it's easy to test; healthConnect.ts does the reading on the phone.
 */
import { tr, trCount } from "./i18n/current.ts";
import type { HealthConnectImportResult } from "./types";

export const FIRST_SYNC_DAYS = 30;
/** After the first sync, re-read the last week: apps sometimes write a night late or change it */
export const RESYNC_DAYS = 7;
/** sessions per request (the server takes up to 400) */
export const BATCH_SIZE = 200;

/** The parts of a SleepSessionRecord (as react-native-health-connect returns it) that the app uses. */
export interface SleepRecord {
  startTime: string;
  endTime: string;
  startZoneOffset?: { totalSeconds: number } | null;
  stages?: { startTime: string; endTime: string; stage: number }[];
  metadata?: { id?: string; dataOrigin?: string };
}

export interface SleepSessionPayload {
  id: string;
  start_time: string;
  end_time: string;
  zone_offset_seconds: number;
  stages: { start_time: string; end_time: string; stage: number }[];
  app: string;
}

export function toPayload(r: SleepRecord): SleepSessionPayload {
  return {
    id: r.metadata?.id || `${r.startTime}/${r.endTime}`,
    start_time: r.startTime,
    end_time: r.endTime,
    // The time zone the sleep was recorded in; the phone's own when Health Connect doesn't have one
    zone_offset_seconds: r.startZoneOffset?.totalSeconds ?? -new Date(r.startTime).getTimezoneOffset() * 60,
    stages: (r.stages ?? []).map((s) => ({ start_time: s.startTime, end_time: s.endTime, stage: s.stage })),
    app: r.metadata?.dataOrigin ?? "",
  };
}

/** The time range to read: the last 30 days the first time, then the last week. */
export function syncWindow(lastSyncAt: string | null, now = new Date()): { startTime: string; endTime: string } {
  const days = lastSyncAt ? RESYNC_DAYS : FIRST_SYNC_DAYS;
  return { startTime: new Date(now.getTime() - days * 86_400_000).toISOString(), endTime: now.toISOString() };
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function addResults(a: HealthConnectImportResult, b: HealthConnectImportResult): HealthConnectImportResult {
  return {
    imported: a.imported + b.imported,
    updated: a.updated + b.updated,
    replaced_manual: a.replaced_manual + b.replaced_manual,
    skipped: a.skipped + b.skipped,
  };
}

/** "Health Connect synced: 2 new, 1 updated, steps for 7 days" (or "Apple Health synced: …") */
export function syncSummary(r: HealthConnectImportResult, title: "hc.synced" | "ah.synced" = "hc.synced"): string {
  const parts = [tr("sync.new", { n: r.imported }), tr("sync.updated", { n: r.updated })];
  if (r.replaced_manual) parts.push(trCount("sync.replaced", r.replaced_manual));
  const stepDays = r.steps ? r.steps.inserted + r.steps.updated : 0;
  if (stepDays) parts.push(trCount("sync.stepsDays", stepDays));
  return tr(title, { parts: parts.join(tr("list.separator")) });
}
