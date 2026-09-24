import { useCallback } from 'react';

import { en, type MessageKey } from './en';
import { hi } from './hi';
import { getLocale, useLocale, type Locale } from './locale';

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, hi };

// The `{name}` placeholders in a message, as a union of their names.
type ParamNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParamNames<Rest>
  : never;

// Keys whose message has no placeholders; a variable holding one of these can be passed to t() alone.
export type PlainKey = {
  [K in MessageKey]: [ParamNames<(typeof en)[K]>] extends [never] ? K : never;
}[MessageKey];

export type MessageParams<K extends MessageKey> = Record<ParamNames<(typeof en)[K]>, string | number>;

// A key with placeholders requires its params; a key without them takes none.
export type TArgs<K extends MessageKey> = [ParamNames<(typeof en)[K]>] extends [never]
  ? []
  : [params: MessageParams<K>];

export type TFunction = <K extends MessageKey>(key: K, ...args: TArgs<K>) => string;

// A base key `x` for which both `x.one` and `x.other` exist.
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

export type TPluralFunction = (key: PluralKey, count: number) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

// Replaces `{name}` with the param; an unknown placeholder is left visible so it is noticed.
function interpolate(template: string, params: Record<string, string | number> | undefined): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

// Looks a key up in one locale. Falls back to English, which typecheck guarantees has it.
export function translate<K extends MessageKey>(locale: Locale, key: K, ...args: TArgs<K>): string {
  const template = dictionaries[locale][key] ?? en[key];
  return interpolate(template, args[0] as Record<string, string | number> | undefined);
}

// Translates in the active locale. Outside React only; components use `useT`.
export function t<K extends MessageKey>(key: K, ...args: TArgs<K>): string {
  return translate(getLocale(), key, ...args);
}

// CLDR plural category, reduced to the two forms en and hi need. hi treats 0 and 1 as `one`.
function pluralForm(locale: Locale, count: number): 'one' | 'other' {
  if (locale === 'hi') return count === 0 || count === 1 ? 'one' : 'other';
  return count === 1 ? 'one' : 'other';
}

// Picks `key.one` or `key.other` by count and fills `{count}`.
export function translatePlural(locale: Locale, key: PluralKey, count: number): string {
  const full = `${key}.${pluralForm(locale, count)}` as MessageKey;
  return interpolate(dictionaries[locale][full] ?? en[full], { count });
}

// The translator for the active locale; the component re-renders when the language changes.
export function useT(): TFunction {
  const locale = useLocale();
  return useCallback<TFunction>((key, ...args) => translate(locale, key, ...args), [locale]);
}

// The plural translator for the active locale.
export function useTPlural(): TPluralFunction {
  const locale = useLocale();
  return useCallback<TPluralFunction>((key, count) => translatePlural(locale, key, count), [locale]);
}

// Dev-only: every hi message must use exactly the placeholders its en message uses.
function checkPlaceholders(): void {
  const names = (text: string) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort().join(',');
  for (const key of Object.keys(en) as MessageKey[]) {
    if (names(en[key]) !== names(hi[key])) {
      console.warn(`i18n: placeholders differ between en and hi for "${key}".`);
    }
  }
}

if (__DEV__) checkPlaceholders();
