import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { prefsStore } from '@/services/storage/kv';

/*
 * The chosen language, persisted in the preferences store so it survives sign-out
 * and restarts. MMKV is synchronous, so the store is hydrated before the first render.
 */
export type Locale = 'hi' | 'en';

export const LOCALES: readonly Locale[] = ['hi', 'en'];

// Hindi is the surveyors' first language, so it is what a new install opens in.
export const DEFAULT_LOCALE: Locale = 'hi';

type LocaleState = {
  readonly locale: Locale;
  /** False until the surveyor has picked a language once; drives the first-launch choice screen. */
  readonly chosen: boolean;
  readonly setLocale: (locale: Locale) => void;
};

const mmkvStorage: StateStorage = {
  getItem: (name) => prefsStore.getString(name) ?? null,
  setItem: (name, value) => prefsStore.set(name, value),
  removeItem: (name) => {
    prefsStore.remove(name);
  },
};

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      chosen: false,
      setLocale: (locale) => set({ locale, chosen: true }),
    }),
    {
      name: 'i18n.locale',
      version: 1,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({ locale: state.locale, chosen: state.chosen }),
    },
  ),
);

// The active locale outside React (services, formatters).
export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

// Sets the language and records that the surveyor has chosen one.
export function setLocale(locale: Locale): void {
  useLocaleStore.getState().setLocale(locale);
}

export function useLocale(): Locale {
  return useLocaleStore((state) => state.locale);
}

export function useLocaleChosen(): boolean {
  return useLocaleStore((state) => state.chosen);
}

// BCP 47 tag for Intl. `-u-nu-latn` keeps digits Western (0-9) in Hindi too.
export function intlLocale(locale: Locale = getLocale()): string {
  return locale === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN';
}
