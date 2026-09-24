import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';

import { haversineMeters } from '@/services/location/last-known';

import { type ShutterFix } from './evidence';
import { withGpsExif } from './exif';

// The words burned onto a photo. English and Western digits on purpose: the image is evidence, read in court.
export type StampLines = {
  readonly title: string;
  readonly time: string;
  readonly coords: string;
  readonly address: string;
};

export const ADDRESS_UNAVAILABLE = 'Address unavailable';
const GEOCODE_TIMEOUT_MS = 2_500;
const GEOCODE_REUSE_M = 30;
const IST_OFFSET_MS = 330 * 60_000;

let lastAddress: { latitude: number; longitude: number; text: string } | null = null;

// "24-09-2026 10:11:12 IST", whatever the handset's zone.
export function formatIst(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const two = (value: number) => String(value).padStart(2, '0');
  return (
    `${two(ist.getUTCDate())}-${two(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()} ` +
    `${two(ist.getUTCHours())}:${two(ist.getUTCMinutes())}:${two(ist.getUTCSeconds())} IST`
  );
}

// Reverse-geocoded address, reused within 30 m; the fallback text when offline or slow.
export async function stampAddress(latitude: number, longitude: number): Promise<string> {
  const here = { latitude, longitude };
  if (lastAddress !== null && haversineMeters(here, lastAddress) <= GEOCODE_REUSE_M) return lastAddress.text;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS);
    });
    const found = await Promise.race([Location.reverseGeocodeAsync(here), timeout]);
    const first = found?.[0];
    if (first === undefined) return ADDRESS_UNAVAILABLE;
    const parts = [first.name, first.street, first.district, first.city ?? first.subregion, first.region, first.postalCode]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .filter((part, index, all) => all.indexOf(part) === index);
    if (parts.length === 0) return ADDRESS_UNAVAILABLE;
    lastAddress = { latitude, longitude, text: parts.join(', ') };
    return lastAddress.text;
  } catch {
    return ADDRESS_UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

// The stamp's lines for one capture.
export function stampLines(caseRef: string, fix: ShutterFix, takenAt: Date, address: string): StampLines {
  return {
    title: `ADA Inspection · Case ${caseRef}`,
    time: formatIst(takenAt),
    coords: `Lat ${fix.latitude.toFixed(6)}  Long ${fix.longitude.toFixed(6)}  ±${Math.round(fix.accuracyM)} m`,
    address,
  };
}

export type NormalizedPhoto = { readonly uri: string; readonly width: number; readonly height: number };

// Re-encodes a camera shot as an upright baseline JPEG, long edge capped: bakes the iPhone's EXIF rotation into pixels.
export async function normalizePhoto(uri: string, maxEdge: number, quality: number): Promise<NormalizedPhoto> {
  const context = ImageManipulator.manipulate(uri);
  const upright = await context.renderAsync();
  const { width, height } = upright;
  const image =
    Math.max(width, height) > maxEdge
      ? await ImageManipulator.manipulate(uri)
          .resize(width >= height ? { width: maxEdge } : { height: maxEdge })
          .renderAsync()
      : upright;
  const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

// False when a snapshot is implausibly small next to its source, the signature of a blank iOS capture.
export function looksRendered(stampedUri: string, sourceUri: string): boolean {
  const stamped = new File(stampedUri).size ?? 0;
  const source = new File(sourceUri).size ?? 0;
  return stamped > 0 && (source === 0 || stamped >= source * 0.25);
}

// Writes the GPS stamp into the stamped JPEG's EXIF, in place; the snapshot carries none.
export async function embedGps(uri: string, fix: ShutterFix, takenAt: Date): Promise<void> {
  const file = new File(uri);
  const bytes = await file.bytes();
  file.write(withGpsExif(bytes, { ...fix, takenAt }));
}

// Deletes a temporary file; a leftover in the cache is not worth failing a capture over.
export function discardFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The OS clears its cache directory by itself.
  }
}
