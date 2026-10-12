import Constants from "expo-constants";
import { Platform } from "react-native";

import { storage } from "./storage";

const SERVER_KEY = "server_url";
const API_PORT = 8000;

/**
 * Where the backend runs.
 * - Web: the same computer the page was opened from.
 * - Expo Go on a phone: the computer running `npx expo start` (Expo tells us its address).
 * EXPO_PUBLIC_API_URL overrides both, and the login screen lets the user change it.
 */
function defaultServerUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:${API_PORT}`;
}

let serverUrl = defaultServerUrl();
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const server = {
  get url() {
    return serverUrl;
  },
  async load() {
    serverUrl = (await storage.get(SERVER_KEY)) ?? defaultServerUrl();
  },
  async set(url: string) {
    serverUrl = url.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(serverUrl)) serverUrl = `http://${serverUrl}`;
    await storage.set(SERVER_KEY, serverUrl);
  },
  async reset() {
    serverUrl = defaultServerUrl();
    await storage.remove(SERVER_KEY);
  },
};

export function setToken(value: string | null) {
  token = value;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: Record<string, string>;
  /** a local file (photo or recording) to send as multipart form data */
  upload?: { field: string; uri: string; name: string; type: string; fields?: Record<string, string> };
}

/** Multipart body for a local file: phones send the file by its uri, the browser needs the bytes. */
async function uploadBody(file: NonNullable<Options["upload"]>): Promise<FormData> {
  const data = new FormData();
  for (const [k, v] of Object.entries(file.fields ?? {})) data.append(k, v);
  if (Platform.OS === "web") {
    data.append(file.field, await (await fetch(file.uri)).blob(), file.name);
  } else {
    data.append(file.field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  return data;
}

export async function api<T>(path: string, { method = "GET", body, form, upload }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const sentToken = token;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  let payload: string | FormData | undefined;
  if (upload) {
    payload = await uploadBody(upload); // fetch sets the multipart Content-Type itself
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${serverUrl}. Is the backend running?`);
  }
  // Only a rejected login token means "logged out" (not a request sent before the login was restored)
  if (res.status === 401 && sentToken && sentToken === token) {
    onUnauthorized?.();
    throw new ApiError(401, "Your session expired. Please log in again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorText(data) ?? `Request failed (${res.status})`);
  return data as T;
}

function errorText(data: unknown): string | null {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { loc?: string[]; msg?: string }) => `${d.loc?.at(-1) ?? ""}: ${d.msg}`).join("; ");
  }
  return null;
}

export const qrImageUrl = (exerciseId: number) => `${serverUrl}/api/exercises/${exerciseId}/qr.png`;
