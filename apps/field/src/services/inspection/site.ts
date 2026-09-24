import { haversineMeters } from '@/services/location/last-known';

/*
 * The check-in's plain-language readings: how good the GPS signal is, and how far
 * the surveyor stands from the point the case was filed at. The radius and whether
 * it is enforced are served (`geofence_radius_m`, `geofence_enforced`).
 */
export type SignalQuality = 'good' | 'fair' | 'weak' | 'searching';

// Good up to the flag line, fair up to the gate, weak beyond it (thresholds are server policy).
export function signalQuality(accuracyM: number | null | undefined, gateM: number, flagM: number): SignalQuality {
  if (accuracyM === null || accuracyM === undefined || !Number.isFinite(accuracyM)) return 'searching';
  if (accuracyM <= flagM) return 'good';
  if (accuracyM <= gateM) return 'fair';
  return 'weak';
}

// After this long with no usable fix, the check-in shows the "step outside" tips.
export const SLOW_FIX_MS = 60_000;

export type SiteDistance = { readonly meters: number; readonly far: boolean };

// Metres from the case point and whether that is beyond the served radius.
export function siteDistance(
  from: { readonly latitude: number; readonly longitude: number } | null,
  site: { readonly latitude: number; readonly longitude: number } | null,
  radiusM: number,
): SiteDistance | null {
  if (from === null || site === null) return null;
  const meters = haversineMeters(from, site);
  return { meters, far: meters > radiusM };
}

// "26.9412° N, 75.9280° E", as the check-in card draws it.
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}
