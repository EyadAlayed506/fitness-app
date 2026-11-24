import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type * as HealthKit from "@kingstinct/react-native-healthkit";

import { api } from "./api";
import { BATCH_SIZE, addResults, batches, syncWindow } from "./healthConnectSessions";
import { appleSleepSessions, appleStepsDays, stepsRange, stepsUpload } from "./phoneHealth";
import { derivedKeys, invalidate, qk } from "./query";
import { storage } from "./storage";
import type { HealthConnectImportResult, StepsUploadResult } from "./types";

/**
 * Sleep and daily steps from Apple Health (HealthKit) on the iPhone: the phone reads them and sends them
 * to the server, like Health Connect on Android. Read only, in the foreground; nothing is written to Health.
 *
 * Apple never tells an app whether the user allowed reading (to protect privacy): after the permission
 * sheet, "no data" can mean "not allowed". So "connected" here only means the user went through the sheet.
 */

const KEY = "apple_health";
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis" as const;
const STEPS = "HKQuantityTypeIdentifierStepCount" as const;
const READ = [SLEEP, STEPS] as const;

export interface AppleHealthStatus {
  /**
   * unsupported: not an iPhone. needs_build: Expo Go or the web, which don't include HealthKit.
   * unavailable: HealthKit isn't on this device (some iPads).
   */
  state: "unsupported" | "needs_build" | "unavailable" | "available";
  connected: boolean;
  lastSyncAt: string | null;
}

let native: typeof HealthKit | null | undefined;

/** The HealthKit module, or null where it isn't built in. Loaded on first use: importing it without its native part throws. */
function hk(): typeof HealthKit | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native = Platform.OS === "ios" ? (require("@kingstinct/react-native-healthkit") as typeof HealthKit) : null;
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

export async function getAppleHealthStatus(): Promise<AppleHealthStatus> {
  const off = (state: AppleHealthStatus["state"]): AppleHealthStatus => ({ state, connected: false, lastSyncAt: null });
  if (Platform.OS !== "ios") return off("unsupported");
  const m = hk();
  if (!m) return off("needs_build");
  let available: boolean;
  try {
    available = m.isHealthDataAvailable();
  } catch {
    return off("needs_build");
  }
  if (!available) return off("unavailable");
  const s = await saved();
  return s ? { state: "available", connected: true, lastSyncAt: s.lastSyncAt } : off("available");
}

/** Shows Apple's permission sheet for sleep and steps (read only). Apple doesn't say what the user chose. */
export async function connectAppleHealth(): Promise<void> {
  const m = hk();
  if (!m) throw new Error("Apple Health isn't included in this version of the app.");
  await m.requestAuthorization({ toRead: READ });
  await storage.set(KEY, JSON.stringify({ lastSyncAt: null }));
}

/** Stop importing. Data already imported stays; access itself is managed in the Health app or Settings. */
export async function disconnectAppleHealth(): Promise<void> {
  await storage.remove(KEY);
}

/**
 * Read sleep and steps from Apple Health and send them to the server: the last 30 days the first time,
 * then the last week. Null when it isn't connected, or `staleMinutes` haven't passed since the last sync.
 */
export async function syncAppleHealth(staleMinutes = 0): Promise<HealthConnectImportResult | null> {
  const m = hk();
  const s = await saved();
  if (!m || !s) return null;
  if (staleMinutes && s.lastSyncAt && Date.now() - Date.parse(s.lastSyncAt) < staleMinutes * 60_000) return null;

  const window = syncWindow(s.lastSyncAt);
  const samples = await m.queryCategorySamples(SLEEP, {
    limit: 0, // all of them in the window
    ascending: true,
    filter: { date: { startDate: new Date(window.startTime), endDate: new Date(window.endTime) } },
  });
  const sessions = appleSleepSessions(samples);
  let total: HealthConnectImportResult = { imported: 0, updated: 0, replaced_manual: 0, skipped: 0 };
  // An empty sync is still sent once, so the server records "synced, nothing new" for the last-sync time
  for (const batch of sessions.length ? batches(sessions, BATCH_SIZE) : [[]]) {
    total = addResults(total, await api<HealthConnectImportResult>("/sleep/apple-health", { method: "POST", body: { sessions: batch } }));
  }
  total.steps = await syncSteps(m, s.lastSyncAt);
  await storage.set(KEY, JSON.stringify({ lastSyncAt: new Date().toISOString() }));
  return total;
}

/** Each local day's step total from HealthKit's statistics (iPhone and Watch counted once). */
async function syncSteps(m: typeof HealthKit, lastSyncAt: string | null): Promise<StepsUploadResult> {
  const { start, end } = stepsRange(lastSyncAt);
  const rows = await m.queryStatisticsCollectionForQuantity(STEPS, ["cumulativeSum"], start, { day: 1 }, {
    filter: { date: { startDate: start, endDate: end } },
    unit: "count",
  });
  return api<StepsUploadResult>("/health/steps", { method: "POST", body: stepsUpload("apple_health", appleStepsDays(rows)) });
}

export const useAppleHealthStatus = () =>
  useQuery({ queryKey: qk.appleHealth, queryFn: getAppleHealthStatus, enabled: Platform.OS === "ios" });

/**
 * With Apple Health connected: each time the screen comes into view, and each time the app comes back to the
 * front while it's in view, bring in new sleep and steps (skipped if it synced less than `staleMinutes` ago).
 */
export function useAppleHealthAutoSync(
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
      const run = () =>
        syncAppleHealth(staleMinutes)
          .then((r) => {
            if (!r) return;
            invalidate(qk.appleHealth, qk.health);
            if (r.imported || r.replaced_manual) invalidate(qk.sleep, ...derivedKeys);
            callback.current?.(r);
          })
          .catch(() => {}); // older data stays on screen
      run();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") run();
      });
      return () => sub.remove();
    }, [connected, staleMinutes]),
  );
}
