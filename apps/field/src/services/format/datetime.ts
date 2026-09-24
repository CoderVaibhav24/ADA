import { getLocale, intlLocale, t, translatePlural } from '@/services/i18n';

/*
 * Dates are ISO 8601 on the wire and formatted once, here, at the render edge
 * (code-standards.md §9). The app's language decides the format: hi-IN or en-IN,
 * always with Western digits.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Parses an ISO timestamp; null for anything the platform cannot read.
function parse(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Day, short month and year in the app's language.
export function formatDate(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (date === null) return null;
  return date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// Date and time of day in the app's language.
export function formatDateTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (date === null) return null;
  return date.toLocaleString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "5 min ago", "3 hr ago", "2 days ago"; the date itself past a week.
export function formatAge(from: Date | string | null | undefined, now: number = Date.now()): string | null {
  const date = from instanceof Date ? from : parse(from);
  if (date === null) return null;
  const elapsed = Math.max(0, now - date.getTime());
  if (elapsed < MINUTE) return t('time.justNow');
  if (elapsed < HOUR) return t('time.minutesAgo', { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t('time.hoursAgo', { count: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY) return translatePlural(getLocale(), 'time.daysAgo', Math.floor(elapsed / DAY));
  return formatDate(date.toISOString());
}

// Today on the device's calendar as `YYYY-MM-DD`, the day format the API filters take.
export function localIsoDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// A measured area in square metres, in the app's language.
export function formatArea(squareMetres: number | null | undefined): string | null {
  if (squareMetres === null || squareMetres === undefined || !Number.isFinite(squareMetres)) {
    return null;
  }
  return `${squareMetres.toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} m²`;
}
