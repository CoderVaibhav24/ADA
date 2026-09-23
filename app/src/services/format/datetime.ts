/*
 * Dates are ISO 8601 on the wire and formatted once, here, at the render edge
 * (code-standards.md §9). The device locale decides the format.
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

// Day, short month and year in the device locale.
export function formatDate(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (date === null) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Date and time of day in the device locale.
export function formatDateTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (date === null) return null;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "5 min ago", "3 h ago", "2 d ago"; the date itself past a week.
export function formatAge(from: Date | string | null | undefined, now: number = Date.now()): string | null {
  const date = from instanceof Date ? from : parse(from);
  if (date === null) return null;
  const elapsed = Math.max(0, now - date.getTime());
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
  return formatDate(date.toISOString());
}

// Today on the device's calendar as `YYYY-MM-DD`, the day format the API filters take.
export function localIsoDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// A measured area in square metres, in the device locale.
export function formatArea(squareMetres: number | null | undefined): string | null {
  if (squareMetres === null || squareMetres === undefined || !Number.isFinite(squareMetres)) {
    return null;
  }
  return `${squareMetres.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`;
}
