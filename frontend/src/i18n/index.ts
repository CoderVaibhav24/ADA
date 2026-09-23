/**
 * i18next setup for the portal. Importing this module initialises the singleton
 * synchronously — both entry points (`main.tsx`, `design-system/main.tsx`) do so
 * before they render, which is what lets any component call `useTranslation()`
 * without a provider in the tree.
 *
 * Language tags are FULL (`en-IN`, `hi-IN`), not bare (`en`, `hi`), because the
 * same tag drives `Intl`: `hi` alone gives Western grouping, `hi-IN` gives the
 * Indian lakh/crore grouping the registers are read with.
 */

import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { useCallback } from "react";
import { formatIstDate, formatIstDateTime } from "@ada/shared/dates";
import { en } from "./en";
import { hi } from "./hi";

export const LANGUAGES = ["en-IN", "hi-IN"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "en-IN";

const STORAGE_KEY = "icms.lang";

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

// localStorage throws outright in a private window and in a sandboxed iframe, so
// every access is guarded; an unreadable preference is not a fatal condition.
function readStoredLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

// Same reason as readStoredLanguage: a failed write must not break the switch.
function writeStoredLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* preference is not persisted; the session still switches */
  }
}

/** Stored choice wins; otherwise a Hindi browser opens in Hindi. */
function initialLanguage(): Language {
  const stored = readStoredLanguage();
  if (stored) return stored;
  const preferred = typeof navigator === "undefined" ? "" : navigator.language;
  return preferred.toLowerCase().startsWith("hi") ? "hi-IN" : DEFAULT_LANGUAGE;
}

// Without this a screen reader pronounces Devanagari with an English voice, and
// the browser applies English hyphenation and font fallback to Hindi.
function applyDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
}

void i18next.use(initReactI18next).init({
  resources: { "en-IN": { app: en }, "hi-IN": { app: hi } },
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  // Without currentOnly, i18next also looks for a bare "hi" bundle that is not here.
  load: "currentOnly",
  supportedLngs: [...LANGUAGES],
  ns: ["app"],
  defaultNS: "app",
  // React escapes for us; leaving this on double-escapes every apostrophe.
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage(i18next.language);
i18next.on("languageChanged", applyDocumentLanguage);

export { i18next };

/** The active language and the one call that changes it everywhere. */
export function useLanguage(): {
  language: Language;
  setLanguage: (next: Language) => void;
} {
  const { i18n } = useTranslation();
  const language = isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;

  const setLanguage = useCallback(
    (next: Language) => {
      writeStoredLanguage(next);
      void i18n.changeLanguage(next);
    },
    [i18n],
  );

  return { language, setLanguage };
}

/* -------------------------------------------------------------------------
   Numbers and dates.

   `-u-nu-latn` is pinned on the Hindi tag deliberately. Indian government forms
   use Western digits; ICU's default for `hi-IN` is already `latn`, but pinning
   it means a later CLDR change cannot silently turn 4,318 into ४,३१८.
   ------------------------------------------------------------------------- */

const NUMBER_LOCALE: Record<Language, string> = {
  "en-IN": "en-IN",
  "hi-IN": "hi-IN-u-nu-latn",
};

export function localeTag(language: Language): string {
  return NUMBER_LOCALE[language] ?? NUMBER_LOCALE[DEFAULT_LANGUAGE];
}

export function formatNumber(language: Language, value: number): string {
  return new Intl.NumberFormat(localeTag(language)).format(value);
}

/** Formatters bound to the active language. Dates go through the IST helpers. */
export function useFormats(): {
  language: Language;
  locale: string;
  number: (value: number) => string;
  date: (value: Date | string | number) => string;
  dateTime: (value: Date | string | number) => string;
} {
  const { language } = useLanguage();
  const locale = localeTag(language);
  return {
    language,
    locale,
    number: (value) => formatNumber(language, value),
    date: (value) => formatIstDate(value, locale),
    dateTime: (value) => formatIstDateTime(value, locale),
  };
}
