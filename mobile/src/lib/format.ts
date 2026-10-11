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
