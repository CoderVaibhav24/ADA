// IST date formatting shared by the web portal and the field app. Every ICMS timestamp is
// displayed in IST regardless of the device time zone, and in the caller's locale.

/** ICMS displays every timestamp in IST; a device-local format is always wrong here. */
export const IST_TIME_ZONE = "Asia/Kolkata";

/** Fixed offset of IST from UTC, in minutes. India has no daylight saving. */
export const IST_UTC_OFFSET_MINUTES = 330;

export type DateInput = Date | string | number;

/** Default locale. `hi-IN-u-nu-latn` is the other one: Devanagari script, Western digits. */
export const DEFAULT_LOCALE = "en-IN";

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: IST_TIME_ZONE,
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

// en-CA is the shortest way to a real YYYY-MM-DD; en-IN would give 22/09/2026.
const KEY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: IST_TIME_ZONE,
};

const cache = new Map<string, Intl.DateTimeFormat>();

// Constructing an Intl.DateTimeFormat per cell is the usual cause of a slow register.
function formatter(locale: string, kind: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${kind}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    cache.set(key, found);
  }
  return found;
}

// Throws rather than falling back to "Invalid Date", which reaches a printed notice unnoticed.
function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`@ada/shared: not a valid date: ${String(value)}`);
  }
  return date;
}

/** e.g. "22 Sept 2026" / "22 सित॰ 2026". Always the IST calendar day. */
export function formatIstDate(value: DateInput, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, "date", DATE_OPTIONS).format(toDate(value));
}

/** Adds the IST wall-clock time. Used wherever an inspection's minute matters. */
export function formatIstDateTime(value: DateInput, locale: string = DEFAULT_LOCALE): string {
  return formatter(locale, "dateTime", DATE_TIME_OPTIONS).format(toDate(value));
}

/**
 * `YYYY-MM-DD` for API query params and export filenames. Locale-independent on
 * purpose: the backend parses it as an IST calendar day, not as display text.
 */
export function toIstDateKey(value: DateInput): string {
  return formatter("en-CA", "key", KEY_OPTIONS).format(toDate(value));
}
