/**
 * Phone health data -> what the server expects: daily steps (Health Connect and Apple Health) and Apple
 * Health sleep grouped into sessions. Pure (no React Native), so it's easy to test; healthConnect.ts and
 * appleHealth.ts do the reading on the phone. Contract: docs/team/HEALTH.md.
 */
import { FIRST_SYNC_DAYS, RESYNC_DAYS, type SleepSessionPayload } from "./healthConnectSessions.ts";

export interface StepsDayPayload {
  /** the phone's local day, YYYY-MM-DD */
  date: string;
  steps: number;
}

export type PhoneSource = "health_connect" | "apple_health";

export interface StepsUpload {
  source: PhoneSource;
  tz_offset_seconds: number;
  days: StepsDayPayload[];
}

export interface StepsUploadResult {
  inserted: number;
  updated: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of a moment in the phone's time zone */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight `days - 1` days before `now` up to now: the last 30 days the first time, then the last week. */
export function stepsRange(lastSyncAt: string | null, now = new Date()): { start: Date; end: Date } {
  const days = lastSyncAt ? RESYNC_DAYS : FIRST_SYNC_DAYS;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { start, end: now };
}

export function stepsUpload(source: PhoneSource, days: StepsDayPayload[], now = new Date()): StepsUpload {
  return { source, tz_offset_seconds: -now.getTimezoneOffset() * 60, days };
}

/** One day bucket of Health Connect's aggregateGroupByPeriod for Steps */
export interface HcStepsBucket {
  /** the bucket's local start, e.g. "2026-11-22T00:00" */
  startTime: string;
  result: { COUNT_TOTAL: number; dataOrigins: string[] };
}

/**
 * Health Connect's aggregate removes duplicates between apps, but react-native-health-connect reports a day
 * without data as COUNT_TOTAL 0. No app behind the number (`dataOrigins` empty) means no data: leave it out.
 */
export function hcStepsDays(buckets: HcStepsBucket[]): StepsDayPayload[] {
  return buckets
    .filter((b) => b.result.dataOrigins.length > 0)
    .map((b) => ({ date: b.startTime.slice(0, 10), steps: Math.round(b.result.COUNT_TOTAL) }));
}

/** One row of HealthKit's daily statistics collection (cumulative sum) for step count */
export interface AppleStepsRow {
  startDate?: Date;
  sumQuantity?: { quantity: number };
  sources: readonly unknown[];
}

/** HealthKit's statistics sum is already de-duplicated across iPhone and Watch. No sum or no source: no data. */
export function appleStepsDays(rows: readonly AppleStepsRow[]): StepsDayPayload[] {
  return rows
    .filter((r) => r.startDate && r.sumQuantity && r.sources.length > 0)
    .map((r) => ({ date: localDate(r.startDate!), steps: Math.round(r.sumQuantity!.quantity) }));
}

/** The parts of a HealthKit sleep-analysis sample that the app uses */
export interface AppleSleepSample {
  uuid: string;
  value: number;
  startDate: Date;
  endDate: Date;
  sourceRevision: { source: { name: string; bundleIdentifier: string } };
}

/**
 * HKCategoryValueSleepAnalysis -> Health Connect's SleepStageType, so the server maps both the same way.
 * inBed (0) is not sleep: it only sets the session's start and end.
 */
const STAGE: Record<number, number | null> = {
  0: null, // in bed
  1: 2, // asleep, no stage detail -> "sleeping"
  2: 1, // awake
  3: 4, // core -> light
  4: 5, // deep
  5: 6, // REM
};

/** More than this between two samples of the same source starts a new session (e.g. a nap). */
const SESSION_GAP_MS = 60 * 60_000;

/**
 * Group sleep samples into sessions, one source at a time. Sources are never mixed: when the Watch and the
 * iPhone both recorded a night, each becomes a session and the server keeps one (the one with stages).
 */
export function appleSleepSessions(samples: readonly AppleSleepSample[]): SleepSessionPayload[] {
  const bySource = new Map<string, AppleSleepSample[]>();
  for (const sample of samples) {
    if (!(sample.value in STAGE)) continue; // a value Apple adds later: ignore rather than guess
    const key = sample.sourceRevision.source.bundleIdentifier;
    bySource.set(key, [...(bySource.get(key) ?? []), sample]);
  }
  const sessions: SleepSessionPayload[] = [];
  for (const [app, list] of bySource) {
    list.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    let current: { first: AppleSleepSample; start: Date; end: Date; parts: AppleSleepSample[] } | null = null;
    const flush = () => {
      if (!current) return;
      sessions.push({
        id: current.first.uuid, // the earliest sample's UUID: the same night gets the same id on every sync
        start_time: current.start.toISOString(),
        end_time: current.end.toISOString(),
        zone_offset_seconds: -current.start.getTimezoneOffset() * 60,
        stages: current.parts
          .filter((p) => STAGE[p.value] !== null)
          .map((p) => ({ start_time: p.startDate.toISOString(), end_time: p.endDate.toISOString(), stage: STAGE[p.value]! })),
        app,
      });
    };
    for (const sample of list) {
      if (current && sample.startDate.getTime() - current.end.getTime() <= SESSION_GAP_MS) {
        current.parts.push(sample);
        if (sample.endDate > current.end) current.end = sample.endDate;
      } else {
        flush();
        current = { first: sample, start: sample.startDate, end: sample.endDate, parts: [sample] };
      }
    }
    flush();
  }
  return sessions;
}
