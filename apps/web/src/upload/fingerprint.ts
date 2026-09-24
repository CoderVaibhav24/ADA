export const FINGERPRINT_EDGE_BYTES = 1024 * 1024;

/** The two File members the fingerprint reads; a Blob with a name is enough. */
export type Fingerprintable = Pick<Blob, "size" | "slice"> & { name: string };

// Lower-case hex, the form the server compares and X-Chunk-SHA256 carries.
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Whole-buffer SHA-256 as hex; crypto.subtle exists in browsers on https/localhost and in Node 20+.
export async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", data));
}

// `${size}:${sha256(first 1 MiB + last 1 MiB)[:32]}`; the name is not hashed so a renamed copy still dedupes.
export async function fingerprintFile(file: Fingerprintable): Promise<string> {
  const size = file.size;
  const head = await file.slice(0, Math.min(FINGERPRINT_EDGE_BYTES, size)).arrayBuffer();
  const tail = await file.slice(Math.max(0, size - FINGERPRINT_EDGE_BYTES), size).arrayBuffer();
  const joined = new Uint8Array(head.byteLength + tail.byteLength);
  joined.set(new Uint8Array(head), 0);
  joined.set(new Uint8Array(tail), head.byteLength);
  const hex = await sha256Hex(joined);
  return `${size}:${hex.slice(0, 32)}`;
}

// A picked file matches a stored session only when size and edge hash agree.
export async function matchesFingerprint(file: Fingerprintable, expected: string | null): Promise<boolean> {
  if (!expected) return false;
  const sizeOf = Number(expected.split(":", 1)[0]);
  if (Number.isFinite(sizeOf) && sizeOf !== file.size) return false;
  return (await fingerprintFile(file)) === expected;
}
