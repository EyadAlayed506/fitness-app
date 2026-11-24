import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type * as HealthConnect from "react-native-health-connect";

import { api } from "./api";
import { BATCH_SIZE, addResults, batches, syncWindow, toPayload, type SleepRecord } from "./healthConnectSessions";
import { hcStepsDays, stepsRange, stepsUpload } from "./phoneHealth";
import { derivedKeys, invalidate, qk } from "./query";
import { storage } from "./storage";
import type { HealthConnectImportResult, StepsUploadResult } from "./types";

/**
 * Sleep and daily steps from Android Health Connect. It lives on the phone, so the phone reads the sleep
 * sessions (from Samsung Health, Fitbit, Garmin, Oura, a sleep app, the phone's bedtime mode…) and each day's
 * step total, and sends them to the server. Whether the user turned it on is remembered on this phone; the
 * permissions themselves are Health Connect's. Steps are optional: sleep works without them.
 */

const KEY = "health_connect";
const SLEEP_READ = { accessType: "read", recordType: "SleepSession" } as const;
const STEPS_READ = { accessType: "read", recordType: "Steps" } as const;
const MAX_PAGES = 20;

export interface HealthConnectStatus {
  /**
   * unsupported: not Android. needs_build: Expo Go or the web, which don't include Health Connect.
   * not_installed / update_required: Health Connect itself is missing or too old (Android 13 and older).
   */
  state: "unsupported" | "needs_build" | "not_installed" | "update_required" | "available";
  connected: boolean;
  /** the user also let the app read steps (asked together with sleep; older connections may not have it) */
  steps: boolean;
  lastSyncAt: string | null;
}

let native: typeof HealthConnect | null | undefined;

/** The Health Connect module, or null where it isn't built in. Loaded on first use: importing it without its native part throws. */
function hc(): typeof HealthConnect | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native = Platform.OS === "android" ? (require("react-native-health-connect") as typeof HealthConnect) : null;
    } catch {
      native = null;
    }
  }
  return native;
}

async function saved(): Promise<{ lastSyncAt: string | null } | null> {
  const raw = await storage.get(KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function canRead(m: typeof HealthConnect, recordType: "SleepSession" | "Steps"): Promise<boolean> {
  const granted = await m.getGrantedPermissions();
  return granted.some((p) => "recordType" in p && p.recordType === recordType && p.accessType === "read");
}

const canReadSleep = (m: typeof HealthConnect) => canRead(m, "SleepSession");

export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  const off = (state: HealthConnectStatus["state"]): HealthConnectStatus => ({
    state,
    connected: false,
    steps: false,
    lastSyncAt: null,
  });
  if (Platform.OS !== "android") return off("unsupported");
  const m = hc();
  if (!m) return off("needs_build");
  let sdk: number;
  try {
    sdk = await m.getSdkStatus();
  } catch {
    return off("needs_build");
  }
  if (sdk === m.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return off("update_required");
  if (sdk !== m.SdkAvailabilityStatus.SDK_AVAILABLE) return off("not_installed");
  const s = await saved();
  if (!s) return off("available");
  try {
    await m.initialize();
    if (await canReadSleep(m)) {
      return { state: "available", connected: true, steps: await canRead(m, "Steps"), lastSyncAt: s.lastSyncAt };
    }
  } catch {
    // treated as no permission below
  }
  await storage.remove(KEY).catch(() => {}); // the user took the permission away in Health Connect
  return off("available");
}

/**
 * Shows Health Connect's permission screen for sleep and steps (also used to add steps to an older
 * connection). True if the user let the app read sleep; steps are optional.
 */
export async function connectHealthConnect(): Promise<boolean> {
  const m = hc();
  if (!m) throw new Error("Health Connect isn't included in this version of the app.");
  await m.initialize();
  await m.requestPermission([SLEEP_READ, STEPS_READ]);
  if (!(await canReadSleep(m))) return false;
  await storage.set(KEY, JSON.stringify({ lastSyncAt: null }));
  return true;
}

/** Stop importing. Sleep already imported stays; the permission is managed in Health Connect. */
export async function disconnectHealthConnect(): Promise<void> {
  await storage.remove(KEY);
}

export function openHealthConnectSettings(): void {
  hc()?.openHealthConnectSettings();
}

/**
 * Read sleep from Health Connect and send it to the server: the last 30 days the first time, then the last week.
 * Null when Health Connect isn't connected, or `staleMinutes` haven't passed since the last sync.
 */
export async function syncHealthConnect(staleMinutes = 0): Promise<HealthConnectImportResult | null> {
  const m = hc();
  const s = await saved();
  if (!m || !s) return null;
  if (staleMinutes && s.lastSyncAt && Date.now() - Date.parse(s.lastSyncAt) < staleMinutes * 60_000) return null;
  await m.initialize();
  const records: SleepRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await m.readRecords("SleepSession", {
      timeRangeFilter: { operator: "between", ...syncWindow(s.lastSyncAt) },
      pageSize: BATCH_SIZE,
      pageToken,
    });
    records.push(...(res.records as unknown as SleepRecord[]));
    pageToken = res.pageToken || undefined;
    if (!pageToken) break;
  }
  let total: HealthConnectImportResult = { imported: 0, updated: 0, replaced_manual: 0, skipped: 0 };
  const payloads = records.map(toPayload);
  // An empty sync is still sent once, so the server records "synced, nothing new" for the last-sync time
  for (const sessions of payloads.length ? batches(payloads) : [[]]) {
    total = addResults(total, await api<HealthConnectImportResult>("/sleep/health-connect", { method: "POST", body: { sessions } }));
  }
  total.steps = (await canRead(m, "Steps").catch(() => false)) ? await syncSteps(m, s.lastSyncAt) : null;
  await storage.set(KEY, JSON.stringify({ lastSyncAt: new Date().toISOString() }));
  return total;
}

/** Each local day's step total, as Health Connect adds it up (duplicates between apps removed by the user's priority list). */
async function syncSteps(m: typeof HealthConnect, lastSyncAt: string | null): Promise<StepsUploadResult> {
  const { start, end } = stepsRange(lastSyncAt);
  const buckets = await m.aggregateGroupByPeriod({
    recordType: "Steps",
    timeRangeFilter: { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() },
    timeRangeSlicer: { period: "DAYS", length: 1 },
  });
  const days = hcStepsDays(buckets);
  return api<StepsUploadResult>("/health/steps", { method: "POST", body: stepsUpload("health_connect", days) });
}

export const useHealthConnectStatus = () =>
  useQuery({ queryKey: qk.healthConnect, queryFn: getHealthConnectStatus, enabled: Platform.OS === "android" });

/**
 * With Health Connect connected: each time the screen comes into view, bring in new sleep (skipped if
 * it synced less than `staleMinutes` ago). New nights refresh sleep, points and suggestions.
 */
export function useHealthConnectAutoSync(
  connected: boolean,
  staleMinutes: number,
  onSynced?: (r: HealthConnectImportResult) => void,
) {
  const callback = useRef(onSynced);
  useEffect(() => {
    callback.current = onSynced;
  });
  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      syncHealthConnect(staleMinutes)
        .then((r) => {
          if (!r) return;
          invalidate(qk.healthConnect);
          if (r.imported || r.replaced_manual) invalidate(qk.sleep, ...derivedKeys);
          if (r.steps) invalidate(qk.health);
          callback.current?.(r);
        })
        .catch(() => {}); // older data stays on screen
    }, [connected, staleMinutes]),
  );
}
