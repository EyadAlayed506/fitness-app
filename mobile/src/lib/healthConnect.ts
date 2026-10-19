import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type * as HealthConnect from "react-native-health-connect";

import { api } from "./api";
import { BATCH_SIZE, addResults, batches, syncWindow, toPayload, type SleepRecord } from "./healthConnectSessions";
import { derivedKeys, invalidate, qk } from "./query";
import { storage } from "./storage";
import type { HealthConnectImportResult } from "./types";

/**
 * Sleep from Android Health Connect. It lives on the phone, so the phone reads the sleep sessions
 * (from Samsung Health, Fitbit, Garmin, Oura, a sleep app, the phone's bedtime mode…) and sends them to
 * the server. Whether the user turned it on is remembered on this phone; the permission itself is
 * Health Connect's.
 */

const KEY = "health_connect";
const SLEEP_READ = { accessType: "read", recordType: "SleepSession" } as const;
const MAX_PAGES = 20;

export interface HealthConnectStatus {
  /**
   * unsupported: not Android. needs_build: Expo Go or the web, which don't include Health Connect.
   * not_installed / update_required: Health Connect itself is missing or too old (Android 13 and older).
   */
  state: "unsupported" | "needs_build" | "not_installed" | "update_required" | "available";
  connected: boolean;
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

async function canReadSleep(m: typeof HealthConnect): Promise<boolean> {
  const granted = await m.getGrantedPermissions();
  return granted.some((p) => "recordType" in p && p.recordType === "SleepSession" && p.accessType === "read");
}

export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  const off = (state: HealthConnectStatus["state"]): HealthConnectStatus => ({ state, connected: false, lastSyncAt: null });
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
    if (await canReadSleep(m)) return { state: "available", connected: true, lastSyncAt: s.lastSyncAt };
  } catch {
    // treated as no permission below
  }
  await storage.remove(KEY).catch(() => {}); // the user took the permission away in Health Connect
  return off("available");
}

/** Shows Health Connect's permission screen. True if the user let the app read sleep. */
export async function connectHealthConnect(): Promise<boolean> {
  const m = hc();
  if (!m) throw new Error("Health Connect isn't included in this version of the app.");
  await m.initialize();
  await m.requestPermission([SLEEP_READ]);
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
  for (const sessions of batches(records.map(toPayload))) {
    total = addResults(total, await api<HealthConnectImportResult>("/sleep/health-connect", { method: "POST", body: { sessions } }));
  }
  await storage.set(KEY, JSON.stringify({ lastSyncAt: new Date().toISOString() }));
  return total;
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
          callback.current?.(r);
        })
        .catch(() => {}); // older data stays on screen
    }, [connected, staleMinutes]),
  );
}
