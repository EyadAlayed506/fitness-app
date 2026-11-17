// Language logic with no React or Expo imports, so it can be tested with Node (src/lib/i18n.test.ts).
import { en, type Dictionary, type MessageKey } from "./en.ts";

export type Language = "en" | "ar";
export type Direction = "ltr" | "rtl";
export const LANGUAGES: Language[] = ["en", "ar"];

export const isLanguage = (v: unknown): v is Language => v === "en" || v === "ar";

/** The saved choice if there is one; otherwise Arabic for an Arabic device/browser, English for everything else. */
export function pickLanguage(saved: string | null | undefined, deviceLocales: readonly string[]): Language {
  if (isLanguage(saved)) return saved;
  const first = deviceLocales[0]?.toLowerCase() ?? "";
  return first === "ar" || first.startsWith("ar-") ? "ar" : "en";
}

export const directionOf = (lang: Language): Direction => (lang === "ar" ? "rtl" : "ltr");

/**
 * Locale for Intl number/date formatting. Arabic uses Western digits (0-9) and the Gregorian
 * calendar so numbers match what users type and what the server stores. (Decision recorded in DESIGN.md.)
 */
export const intlLocale = (lang: Language): string => (lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en");

// Unicode "first strong isolate" … "pop directional isolate": keeps a URL, email or number
// in an Arabic sentence from reordering the words around it.
const FSI = "⁨";
const PDI = "⁩";

export type Params = Record<string, string | number>;

/** Text for a key, with {placeholders} filled in. Falls back to English, then to the key itself. */
export function translate(dict: Dictionary, lang: Language, key: MessageKey, params?: Params): string {
  const template = dict[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in params)) return whole;
    const value = String(params[name]);
    return lang === "ar" ? `${FSI}${value}${PDI}` : value;
  });
}

// Plural forms are written in one text, separated by "|", in the order of the language's plural categories:
// English "one|other"; Arabic "zero|one|two|few|many|other" (e.g. 0, 1, 2, 3–10, 11–99, 100…).
const PLURAL_ORDER: Record<Language, Intl.LDMLPluralRule[]> = {
  en: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
};

/** Text for a count ("1 day", "3 days", "يومان"), with {n} and any other placeholders filled in. */
export function translateCount(dict: Dictionary, lang: Language, key: MessageKey, n: number, params?: Params): string {
  const forms = (dict[key] ?? en[key] ?? key).split("|");
  const formsLang: Language = dict[key] ? lang : "en";
  const index = PLURAL_ORDER[formsLang].indexOf(new Intl.PluralRules(formsLang).select(n));
  const form = forms[index] ?? forms[forms.length - 1];
  return translate({ [key]: form } as Dictionary, lang, key, { n, ...params });
}

// ---------- errors ----------

/**
 * Optional stable codes the backend may add next to `detail` (CONTRACTS.md §1, proposed).
 * Until it does, the English `detail` texts below are matched instead. These are matched only —
 * never shown to the user in Arabic.
 */
const CODES: Record<string, MessageKey> = {
  network: "errors.network",
  session_expired: "errors.sessionExpired",
  wrong_credentials: "errors.wrongCredentials",
  access_revoked: "errors.accessRevoked",
  signup_closed: "errors.signupClosed",
  email_taken: "errors.emailTaken",
  invalid_email: "errors.invalidEmail",
};

const DETAILS: [prefix: string, key: MessageKey][] = [
  ["Your session expired", "errors.sessionExpired"],
  ["Not logged in or session expired", "errors.sessionExpired"],
  ["Wrong email or password", "errors.wrongCredentials"],
  ["This account no longer has access", "errors.accessRevoked"],
  ["Sign-up is closed", "errors.signupClosed"],
  ["An account with this email already exists", "errors.emailTaken"],
  // 422 validation: api.ts formats it as "<field>: <message>"
  ["email: value is not a valid email", "errors.invalidEmail"],
];

/** The first web address in a message (e.g. the server the app couldn't reach), without trailing punctuation. */
export const urlIn = (message: string): string => message.match(/https?:\/\/\S+/)?.[0].replace(/[.,;:!?]+$/, "") ?? "";

/** The translated message for an API error, or null when the app has no specific text for it. */
export function errorKey(err: { status: number; message: string; code?: string | null }): MessageKey | null {
  if (err.code && CODES[err.code]) return CODES[err.code];
  if (err.status === 0) return "errors.network";
  for (const [prefix, key] of DETAILS) if (err.message.startsWith(prefix)) return key;
  return null;
}
