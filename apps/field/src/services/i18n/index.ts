/**
 * The i18n surface. Import from `@/services/i18n` only, never a file inside it.
 * It is the one service the design system may import: words and script, no data, no network.
 */

export { en, type MessageKey } from './en';
export {
  DEFAULT_LOCALE,
  LOCALES,
  getLocale,
  intlLocale,
  setLocale,
  useLocale,
  useLocaleChosen,
  useLocaleStore,
  type Locale,
} from './locale';
export { containsDevanagari, scriptOf, useScriptOf, type Script } from './script';
export {
  t,
  translate,
  translatePlural,
  useT,
  useTPlural,
  type MessageParams,
  type PlainKey,
  type PluralKey,
  type TArgs,
  type TFunction,
  type TPluralFunction,
} from './translate';
