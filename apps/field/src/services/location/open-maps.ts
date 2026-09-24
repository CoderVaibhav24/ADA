import { Linking, Platform } from 'react-native';

/*
 * Hands the surveyor to Google Maps for the way to a case. Tries the app's own
 * intents first on Android, then the https URL every platform can open. Nothing
 * here sends the coordinates anywhere but the maps app the surveyor chooses.
 */
export type MapTarget = {
  readonly latitude?: number;
  readonly longitude?: number;
  /** Used when the case has no map point: Maps searches the address. */
  readonly address?: string;
};

// The URLs to try, best first; empty when there is nothing to go to.
export function mapUrls(target: MapTarget, mode: 'directions' | 'show'): string[] {
  const hasPoint =
    typeof target.latitude === 'number' &&
    typeof target.longitude === 'number' &&
    Number.isFinite(target.latitude) &&
    Number.isFinite(target.longitude);
  const address = target.address?.trim() ?? '';
  if (!hasPoint && address === '') return [];
  const where = hasPoint ? `${target.latitude},${target.longitude}` : address;
  const q = encodeURIComponent(where);
  const web =
    mode === 'directions'
      ? `https://www.google.com/maps/dir/?api=1&destination=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  if (Platform.OS !== 'android') return [web];
  const intents =
    mode === 'directions'
      ? [`google.navigation:q=${q}`, `geo:0,0?q=${q}`]
      : [hasPoint ? `geo:${where}?q=${q}` : `geo:0,0?q=${q}`];
  return [...intents, web];
}

// Opens the first URL the handset accepts. False when none opened (or there was nothing to open).
export async function openInMaps(target: MapTarget, mode: 'directions' | 'show'): Promise<boolean> {
  for (const url of mapUrls(target, mode)) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // No app for this scheme; try the next one.
    }
  }
  return false;
}

// Starts a phone call. False when the handset cannot dial.
export async function dialNumber(phone: string): Promise<boolean> {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits === '') return false;
  try {
    await Linking.openURL(`tel:${digits}`);
    return true;
  } catch {
    return false;
  }
}
