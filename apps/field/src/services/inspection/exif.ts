// Minimal JPEG EXIF writer (GPS, accuracy, capture time); runs last, on the exact bytes that upload.

export type ExifGps = {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  /** Capture time; written as local wall-clock DateTimeOriginal plus its UTC offset. */
  readonly takenAt: Date;
};

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_UNDEFINED = 7;

type Entry = { tag: number; type: number; count: number; data: number[] };

// Little-endian bytes of an unsigned integer.
function le(value: number, size: 2 | 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i += 1) out.push((value >>> (8 * i)) & 0xff);
  return out;
}

// NUL-terminated 7-bit ASCII.
function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0) & 0x7f).concat(0);
}

function rationals(pairs: readonly (readonly [number, number])[]): number[] {
  return pairs.flatMap(([num, den]) => [...le(num, 4), ...le(den, 4)]);
}

// Decimal degrees as degrees, minutes and seconds to 1/10000 s (about 3 mm).
function dms(value: number): [number, number][] {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFull = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = Math.round((minutesFull - minutes) * 60 * 10_000);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10_000],
  ];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function exifDateTime(date: Date): string {
  return (
    `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function exifOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function entryBytes(entry: Entry): number {
  const unit = entry.type === TYPE_SHORT ? 2 : entry.type === TYPE_LONG ? 4 : entry.type === TYPE_RATIONAL ? 8 : 1;
  return unit * entry.count;
}

// One IFD at `offset` from the TIFF header; values over 4 bytes follow the entry table.
function ifd(entries: Entry[], offset: number): number[] {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const valuesStart = offset + 2 + sorted.length * 12 + 4;
  const head: number[] = [...le(sorted.length, 2)];
  const tail: number[] = [];
  for (const entry of sorted) {
    head.push(...le(entry.tag, 2), ...le(entry.type, 2), ...le(entry.count, 4));
    if (entryBytes(entry) <= 4) {
      head.push(...entry.data, ...new Array<number>(4 - entry.data.length).fill(0));
    } else {
      head.push(...le(valuesStart + tail.length, 4));
      tail.push(...entry.data);
      if (tail.length % 2 === 1) tail.push(0);
    }
  }
  head.push(...le(0, 4));
  return [...head, ...tail];
}

// The TIFF body of the APP1 segment: IFD0 pointing at an Exif IFD and a GPS IFD.
export function buildExif(gps: ExifGps): Uint8Array {
  const accuracy = Math.max(0, Math.round(gps.accuracyM * 100));
  const gpsEntries: Entry[] = [
    { tag: 0x0000, type: TYPE_BYTE, count: 4, data: [2, 3, 0, 0] },
    { tag: 0x0001, type: TYPE_ASCII, count: 2, data: ascii(gps.latitude >= 0 ? 'N' : 'S') },
    { tag: 0x0002, type: TYPE_RATIONAL, count: 3, data: rationals(dms(gps.latitude)) },
    { tag: 0x0003, type: TYPE_ASCII, count: 2, data: ascii(gps.longitude >= 0 ? 'E' : 'W') },
    { tag: 0x0004, type: TYPE_RATIONAL, count: 3, data: rationals(dms(gps.longitude)) },
    { tag: 0x001f, type: TYPE_RATIONAL, count: 1, data: rationals([[accuracy, 100]]) },
  ];
  const taken = ascii(exifDateTime(gps.takenAt));
  const offset = ascii(exifOffset(gps.takenAt));
  const exifEntries: Entry[] = [
    { tag: 0x9000, type: TYPE_UNDEFINED, count: 4, data: [...'0232'].map((char) => char.charCodeAt(0)) },
    { tag: 0x9003, type: TYPE_ASCII, count: taken.length, data: taken },
    { tag: 0x9011, type: TYPE_ASCII, count: offset.length, data: offset },
  ];
  const pointer = (tag: number, value: number): Entry => ({ tag, type: TYPE_LONG, count: 1, data: le(value, 4) });
  const software = ascii('ADA Field');
  // Orientation 1: every caller hands over pixels already upright (normalizePhoto bakes the rotation).
  const ifd0 = (exifAt: number, gpsAt: number): Entry[] => [
    { tag: 0x0112, type: TYPE_SHORT, count: 1, data: le(1, 2) },
    { tag: 0x0131, type: TYPE_ASCII, count: software.length, data: software },
    { tag: 0x0132, type: TYPE_ASCII, count: taken.length, data: taken },
    pointer(0x8769, exifAt),
    pointer(0x8825, gpsAt),
  ];
  const ifd0At = 8;
  const exifAt = ifd0At + ifd(ifd0(0, 0), 0).length;
  const gpsAt = exifAt + ifd(exifEntries, 0).length;
  return new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, ...le(ifd0At, 4),
    ...ifd(ifd0(exifAt, gpsAt), ifd0At),
    ...ifd(exifEntries, exifAt),
    ...ifd(gpsEntries, gpsAt),
  ]);
}

// True for a JFIF APP0 or any APP1 (EXIF or XMP): replaced, so no stale Orientation or GPS survives.
function isReplacedSegment(bytes: Uint8Array, at: number): boolean {
  const id = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  return (bytes[at + 1] === 0xe0 && id === 'JFIF') || bytes[at + 1] === 0xe1;
}

// The JPEG with its JFIF/EXIF/XMP headers replaced by one EXIF block, right after SOI, carrying `gps`.
export function withGpsExif(jpeg: Uint8Array, gps: ExifGps): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const kept: Uint8Array[] = [];
  let at = 2;
  // Every header segment up to the scan; the entropy-coded data after SOS is copied untouched.
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    if (jpeg[at + 1] === 0xff) {
      at += 1;
      continue;
    }
    const length = (jpeg[at + 2] << 8) | jpeg[at + 3];
    if (length < 2 || at + 2 + length > jpeg.length) throw new Error('corrupt JPEG header');
    if (!isReplacedSegment(jpeg, at)) kept.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  const tiff = buildExif(gps);
  const segmentLength = 2 + 6 + tiff.length;
  const app1 = new Uint8Array(2 + segmentLength);
  app1.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(tiff, 10);
  const rest = jpeg.subarray(at);
  const keptLength = kept.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(2 + app1.length + keptLength + rest.length);
  out.set([0xff, 0xd8], 0);
  out.set(app1, 2);
  let cursor = 2 + app1.length;
  for (const part of kept) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(rest, cursor);
  return out;
}
