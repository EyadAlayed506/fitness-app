import { LocaleProvider } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nManager, Platform } from "react-native";

import { storage } from "../storage";
import { directionOf, intlLocale, pickLanguage, type Direction, type Language, type Params } from "./core";
import { errorTextFor, setCurrentLanguage, tr, trCount } from "./current";
import type { MessageKey } from "./en";

export type { Language, MessageKey };

const KEY = "language";

/** The browser's or phone's preferred languages, most preferred first (no extra package needed). */
function deviceLocales(): string[] {
  if (Platform.OS === "web") {
    const nav = globalThis.navigator;
    return nav?.languages?.length ? [...nav.languages] : nav?.language ? [nav.language] : [];
  }
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

/** Puts the page itself into the language's direction: the browser then mirrors rows, text and inputs. */
function applyLanguage(lang: Language) {
  setCurrentLanguage(lang);
  const dir = directionOf(lang);
  if (Platform.OS === "web") {
    const html = globalThis.document?.documentElement;
    if (html) {
      html.lang = lang;
      html.dir = dir;
    }
    return;
  }
  // Phones: React Native only changes layout direction on the next app start (pilot is web-only; see DESIGN.md).
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== (dir === "rtl")) I18nManager.forceRTL(dir === "rtl");
}

type I18n = {
  lang: Language;
  dir: Direction;
  /** Locale for Intl.NumberFormat / Intl.DateTimeFormat */
  locale: string;
  t: (key: MessageKey, params?: Params) => string;
  /** Text for a count: tn("plan.daysPerWeek", 3) → "3 days a week" / "3 أيام في الأسبوع" */
  tn: (key: MessageKey, n: number, params?: Params) => string;
  /** A translated message for an error thrown by the API helper (falls back to its own text in English). */
  errorText: (err: unknown) => string;
  setLanguage: (lang: Language) => void;
};

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language | null>(null);

  useEffect(() => {
    storage
      .get(KEY)
      .catch(() => null)
      .then((saved) => {
        const chosen = pickLanguage(saved, deviceLocales());
        applyLanguage(chosen);
        setLang(chosen);
      });
  }, []);

  const setLanguage = useCallback((next: Language) => {
    applyLanguage(next);
    setLang(next);
    storage.set(KEY, next).catch(() => {});
  }, []);

  const value = useMemo<I18n | null>(() => {
    if (!lang) return null;
    // tr/trCount read the current language, which applyLanguage set before this render
    return {
      lang,
      dir: directionOf(lang),
      locale: intlLocale(lang),
      t: tr,
      tn: trCount,
      errorText: errorTextFor,
      setLanguage,
    };
  }, [lang, setLanguage]);

  // Wait one tick for the saved choice, so the first screen doesn't flash in the wrong language
  if (!value) return null;
  return (
    <I18nContext.Provider value={value}>
      <LocaleProvider direction={value.dir}>{children}</LocaleProvider>
    </I18nContext.Provider>
  );
}

/** textAlign for the end of a line: "right" in English, "left" in Arabic (e.g. numbers in a table). */
export const useLanguageEnd = (): "left" | "right" => (useLanguage() === "ar" ? "left" : "right");

/** The current language, or English outside the provider (safe for low-level UI components). */
export const useLanguage = (): Language => useContext(I18nContext)?.lang ?? "en";

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside LanguageProvider");
  return ctx;
}
