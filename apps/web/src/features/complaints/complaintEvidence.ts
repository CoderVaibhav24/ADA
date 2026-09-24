/**
 * Photos chosen on Create Complaint, as data: which files are accepted, and the
 * upload pass that runs once the case exists. No React, no `@/` imports, so
 * `node --test` covers it the same way it covers `complaintForm.ts`.
 */

/** The server's own limits for `POST /cases/{ref}/evidence`. */
export const MAX_EVIDENCE_FILES = 10;
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type EvidenceRejection = "type" | "size" | "count";

/** The two facts about a `File` these rules read, so tests need no DOM. */
export type FileFacts = { name: string; type: string; size: number };

/** Why one file cannot be attached, or null when it can. */
export function checkEvidenceFile(file: FileFacts): EvidenceRejection | null {
  if (!(EVIDENCE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_EVIDENCE_BYTES) return "size";
  return null;
}

/** Splits a new selection into what fits beside `existing` files and what does not. */
export function acceptEvidence<T extends FileFacts>(
  existing: number,
  incoming: readonly T[],
): { accepted: T[]; rejected: { file: T; reason: EvidenceRejection }[] } {
  const accepted: T[] = [];
  const rejected: { file: T; reason: EvidenceRejection }[] = [];
  for (const file of incoming) {
    const reason = checkEvidenceFile(file);
    if (reason !== null) rejected.push({ file, reason });
    else if (existing + accepted.length >= MAX_EVIDENCE_FILES) {
      rejected.push({ file, reason: "count" });
    } else accepted.push(file);
  }
  return { accepted, rejected };
}

export type UploadOutcome = { uploaded: string[]; failed: string[] };

/**
 * Uploads each item in turn and never throws: a failure is recorded, not raised,
 * because the case already exists and must not be lost to a photo.
 */
export async function uploadEach<T extends { id: string }>(
  items: readonly T[],
  upload: (item: T) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { uploaded: [], failed: [] };
  let done = 0;
  for (const item of items) {
    try {
      await upload(item);
      outcome.uploaded.push(item.id);
    } catch {
      outcome.failed.push(item.id);
    }
    done += 1;
    onProgress?.(done, items.length);
  }
  return outcome;
}
