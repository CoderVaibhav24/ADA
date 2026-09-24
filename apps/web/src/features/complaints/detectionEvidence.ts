/**
 * The detection's own imagery as complaint evidence, as data: where the crop
 * comes from, how the server's side-by-side card splits into a BEFORE and an
 * AFTER photo, and what each is called. No React, no `@/` imports, so
 * `node --test` covers it.
 *
 * The card is drawn by services/api/app/preview.py: two square panels of side
 * P, a 4px margin round each, and an 18px label strip above them, so the image
 * is (2P + 12) wide and (P + 22) tall. P is read back from the image rather than
 * copied from the server, and a card of any other shape is attached whole.
 */

export type DetectionImageSide = "before" | "after";

export type CropRect = { x: number; y: number; width: number; height: number };

const MARGIN = 4;
const LABEL_STRIP = 18;

/** `GET /api/analyses/{job}/polygons/{id}/preview.png`, the same crop Change Detection shows. */
export function detectionPreviewPath(jobId: string, polygonId: string): string {
  return `/api/analyses/${encodeURIComponent(jobId)}/polygons/${encodeURIComponent(polygonId)}/preview.png`;
}

/** Where each panel sits in the card, label strip included, or null for an unknown layout. */
export function splitPreviewCard(
  width: number,
  height: number,
): Record<DetectionImageSide, CropRect> | null {
  const panel = (width - 3 * MARGIN) / 2;
  if (!Number.isInteger(panel) || panel <= 0) return null;
  if (height !== panel + LABEL_STRIP + MARGIN) return null;
  const rect = (index: number): CropRect => ({
    x: MARGIN + index * (panel + MARGIN),
    y: 0,
    width: panel,
    height: panel + LABEL_STRIP,
  });
  return { before: rect(0), after: rect(1) };
}

/** `DET-15-1090-after.png`; anything but letters, digits, dot and dash becomes a dash. */
export function detectionEvidenceName(
  detectionRef: string,
  side: DetectionImageSide | "before-after",
): string {
  const stem = detectionRef.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return `${stem === "" ? "detection" : stem}-${side}.png`;
}
