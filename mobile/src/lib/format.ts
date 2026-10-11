import type { UnitSystem } from "./types";

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export const MASS_TO_G: Record<string, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
export const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  fl_oz: 29.5735295625,
  cup: 236.5882365,
  pint: 473.176473,
  quart: 946.352946,
  gallon: 3785.411784,
};

export const unitLabel = (u: string) => (u === "fl_oz" ? "fl oz" : u);

export function round(n: number | null | undefined, digits = 0): number | null {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function fmt(n: number | null | undefined, digits = 0): string {
  const r = round(n, digits);
  return r == null ? "–" : r.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Display helpers that follow the user's kg/cm or lb/in choice. */
export function units(system: UnitSystem | undefined) {
  const imperial = system === "imperial";
  const w = imperial ? "lb" : "kg";
  const l = imperial ? "in" : "cm";
  const fromKg = (kg: number | null | undefined) => (kg == null ? null : imperial ? kg / KG_PER_LB : kg);
  const fromCm = (cm: number | null | undefined) => (cm == null ? null : imperial ? cm / CM_PER_IN : cm);
  return {
    imperial,
    w,
    l,
    fromKg,
    fromCm,
    weight: (kg: number | null | undefined, digits = 1) => (kg == null ? "–" : `${fmt(fromKg(kg), digits)} ${w}`),
    weightDelta: (kg: number | null | undefined, digits = 1) =>
      kg == null ? "–" : `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${fmt(Math.abs(fromKg(kg)!), digits)} ${w}`,
    length: (cm: number | null | undefined, digits = 1) => (cm == null ? "–" : `${fmt(fromCm(cm), digits)} ${l}`),
  };
}

// ---------- dates (local time, YYYY-MM-DD) ----------

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const todayISO = () => isoDate(new Date());
export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, days: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
export const shortDate = (s: string) => parseISO(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (s: string) =>
  parseISO(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
/** For timestamps from the API (UTC): shown in the phone's time zone. */
export const longDateTime = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const timeOf = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function duration(a: string, b: string): string {
  const min = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}
export const monthLabel = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

// ---------- sleep times (local clock times without a timezone) ----------

/** "7 h 05 min" */
export function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** "23:30" from "2026-10-10T23:30:00" (the clock time as entered) */
export const clockOf = (localDateTime: string) => localDateTime.slice(11, 16);

/** Read "23:30", "7:05", "0705", "11:30 pm" or "7am" as minutes after midnight. */
export function parseClock(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" for a UTC timestamp from the API */
export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}
