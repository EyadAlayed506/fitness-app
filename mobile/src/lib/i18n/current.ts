// The language in use right now, for code outside React components (format.ts, query.ts error messages).
// LanguageProvider keeps it up to date; screens re-render through useI18n() when it changes.
import { ar } from "./ar.ts";
import { errorKey, intlLocale, translate, translateCount, urlIn, type Language, type Params } from "./core.ts";
import { en, type Dictionary, type MessageKey } from "./en.ts";

const DICTS: Record<Language, Dictionary> = { en, ar };
let lang: Language = "en";
const listeners = new Set<(l: Language) => void>();

export function setCurrentLanguage(next: Language) {
  lang = next;
  listeners.forEach((fn) => fn(next));
}
/** Called with the new language whenever it changes (used by format.ts to refresh weekday names). */
export function onLanguageChange(fn: (l: Language) => void) {
  listeners.add(fn);
}
export const currentLanguage = (): Language => lang;
export const currentLocale = (): string => intlLocale(lang);

/** Text for a key in the current language. */
export const tr = (key: MessageKey, params?: Params): string => translate(DICTS[lang], lang, key, params);
/** Text for a count in the current language ("3 days", "3 أيام"). */
export const trCount = (key: MessageKey, n: number, params?: Params): string => translateCount(DICTS[lang], lang, key, n, params);

/** A name from the server shown translated when the app has a text for it ("region.chest"), else as it came. */
export const trOr = (key: string, fallback: string): string => (key in en ? tr(key as MessageKey) : fallback);

/** A message for an error from the API helper (or anything thrown), in the current language. */
export function errorTextFor(err: unknown): string {
  const e = err as { status?: number; message?: string; code?: string } | null;
  const status = typeof e?.status === "number" ? e.status : -1;
  const message = typeof e?.message === "string" ? e.message : "";
  const key = errorKey({ status, message, code: e?.code });
  if (key) return tr(key, { url: urlIn(message), status });
  // No translation for this one: English shows the server's own words, Arabic a general message
  if (lang === "en" && message) return message;
  return status >= 0 ? tr("errors.generic", { status }) : tr("errors.unknown");
}
