import { currentLocale, onLanguageChange, tr, trCount } from "./i18n/current.ts";
import { en, type MessageKey } from "./i18n/en.ts";
import type { SleepSource, UnitSystem } from "./types";

// Display text follows the language chosen in the app (lib/i18n). Values sent to the server never do.

/** "WHOOP" or "Health Connect"; null for sleep the user typed in */
export const trackerName = (source: SleepSource): string | null =>
  source === "whoop" ? "WHOOP" : source === "health_connect" ? "Health Connect" : null;

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

/** A food unit ID ("g", "tbsp", "fl_oz") as shown in the current language; an unknown unit as it is. */
export const unitLabel = (u: string): string => {
  const key = `foodUnit.${u}` as MessageKey;
  return key in en ? tr(key) : u;
};

export function round(n: number | null | undefined, digits = 0): number | null {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function fmt(n: number | null | undefined, digits = 0): string {
  const r = round(n, digits);
  return r == null ? "–" : r.toLocaleString(currentLocale(), { maximumFractionDigits: digits });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A server ID shown in the current language ("chest" → "الصدر"); an ID without a translation is shown capitalised. */
export function idLabel(prefix: "muscle" | "category", id: string): string {
  const key = `${prefix}.${id}` as MessageKey;
  return key in en ? tr(key) : cap(id);
}
/** English only — for translated screens use tn() from useI18n() with a count key. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Display helpers that follow the user's kg/cm or lb/in choice. */
export function units(system: UnitSystem | undefined) {
  const imperial = system === "imperial";
  // w and l are the unit IDs the API expects; wLabel and lLabel are what the user reads
  const w = imperial ? "lb" : "kg";
  const l = imperial ? "in" : "cm";
  const wLabel = tr(imperial ? "unit.lb" : "unit.kg");
  const lLabel = tr(imperial ? "unit.in" : "unit.cm");
  const fromKg = (kg: number | null | undefined) => (kg == null ? null : imperial ? kg / KG_PER_LB : kg);
  const fromCm = (cm: number | null | undefined) => (cm == null ? null : imperial ? cm / CM_PER_IN : cm);
  return {
    imperial,
    w,
    l,
    wLabel,
    lLabel,
    fromKg,
    fromCm,
    weight: (kg: number | null | undefined, digits = 1) => (kg == null ? "–" : `${fmt(fromKg(kg), digits)} ${wLabel}`),
    weightDelta: (kg: number | null | undefined, digits = 1) =>
      kg == null ? "–" : `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${fmt(Math.abs(fromKg(kg)!), digits)} ${wLabel}`,
    length: (cm: number | null | undefined, digits = 1) => (cm == null ? "–" : `${fmt(fromCm(cm), digits)} ${lLabel}`),
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
export const shortDate = (s: string) => parseISO(s).toLocaleDateString(currentLocale(), { month: "short", day: "numeric" });
export const longDate = (s: string) =>
  parseISO(s).toLocaleDateString(currentLocale(), { weekday: "long", month: "long", day: "numeric" });
/** For timestamps from the API (UTC): shown in the phone's time zone. */
export const longDateTime = (s: string) =>
  new Date(s).toLocaleDateString(currentLocale(), { weekday: "long", month: "long", day: "numeric" });
export const timeOf = (s: string) => new Date(s).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
export function duration(a: string, b: string): string {
  const min = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return min >= 60 ? tr("time.hoursMinutes", { h: Math.floor(min / 60), m: min % 60 }) : tr("time.minutes", { m: min });
}
export const monthLabel = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString(currentLocale(), { month: "long", year: "numeric" });

// ---------- sleep times (local clock times without a timezone) ----------

/** "7 h 05 min" */
export function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? tr("time.hoursMinutes", { h, m: String(m).padStart(2, "0") }) : tr("time.minutes", { m });
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
  if (!iso) return tr("time.never");
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return tr("time.justNow");
  if (min < 60) return tr("time.minutesAgo", { n: min });
  if (min < 48 * 60) return tr("time.hoursAgo", { n: Math.round(min / 60) });
  return trCount("time.daysAgo", Math.round(min / 1440));
}

// ---------- weekdays (0 = Monday ... 6 = Sunday, same as the backend) ----------

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** Weekday names in the current language. The arrays are refilled in place when the language changes. */
export const WEEKDAYS: string[] = [];
export const WEEKDAYS_SHORT: string[] = [];
/** Narrowest names, for seven buttons in a row ("Mon" / "ن"). */
export const WEEKDAYS_MIN: string[] = [];
function fillWeekdays() {
  WEEKDAYS.splice(0, 7, ...DAYS.map((d) => tr(`weekday.${d}`)));
  WEEKDAYS_SHORT.splice(0, 7, ...DAYS.map((d) => tr(`weekdayShort.${d}`)));
  WEEKDAYS_MIN.splice(0, 7, ...DAYS.map((d) => tr(`weekdayMin.${d}`)));
}
fillWeekdays();
onLanguageChange(fillWeekdays);
/** Today's weekday in the backend's numbering (JavaScript counts from Sunday). */
export const weekdayIndex = (d: Date = new Date()) => (d.getDay() + 6) % 7;
export const dayList = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => WEEKDAYS_SHORT[d]).join(tr("list.separator"));

/** The device's UTC offset in minutes (UTC+2 → 120). The server uses it to know the user's "today". */
export const tzOffset = () => -new Date().getTimezoneOffset();
