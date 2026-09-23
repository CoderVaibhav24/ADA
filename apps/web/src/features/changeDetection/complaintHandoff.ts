/**
 * The hand-off from a detection to `ROUTES.complaintNew`.
 *
 * This is why the screen exists: an officer looking at a 94%-confident
 * encroachment must be able to raise the complaint without re-typing what is
 * already in front of them.
 *
 * It is a QUERY STRING, not router state. Router state is lost on reload and
 * cannot be pasted into a ticket; a link that survives both is the difference
 * between "open Change Detection, find DET-7-0042, press Create Complaint" and
 * sending someone the URL.
 *
 * Only fields the API really has travel. A change polygon has no parcel id, no
 * khasra number, no village and no tehsil — see features/complaints/parcelId.ts
 * on why the frame's `RJ-JPR-1007` is not one either — so none is sent. The
 * complaint form collects those from the officer, which it would have had to do
 * regardless.
 *
 * `parseComplaintHandoff` is exported for the Create Complaint screen, which is
 * still a placeholder. Nothing in this feature calls it; it is here so both
 * halves of the contract are written down once rather than guessed at twice.
 */

import type { DetectionRow } from "./model";

export type ComplaintHandoff = {
  detectionRef: string;
  jobId: string;
  polygonId: string;
  /** Square metres, as the worker measured it. */
  areaM2: number | null;
  /** 0-1, the model's own score. */
  confidence: number | null;
  /** EPSG:4326 decimal degrees. */
  lat: number | null;
  lon: number | null;
  status: "change" | "illegal" | null;
};

const KEYS = {
  ref: "detectionRef",
  job: "analysisId",
  polygon: "polygonId",
  area: "areaM2",
  confidence: "confidence",
  lat: "lat",
  lon: "lon",
  status: "status",
} as const;

/** Six decimal places is about a tenth of a metre; more is false precision. */
function coordinate(value: number): string {
  return value.toFixed(6);
}

export function toComplaintSearch(row: DetectionRow): string {
  const params = new URLSearchParams();
  params.set(KEYS.ref, row.ref);
  params.set(KEYS.job, row.jobId);
  params.set(KEYS.polygon, String(row.featureId));
  params.set(KEYS.area, String(Math.round(row.areaM2)));
  params.set(KEYS.confidence, row.confidence.toFixed(3));
  params.set(KEYS.status, row.status);
  if (row.centre) {
    params.set(KEYS.lon, coordinate(row.centre[0]));
    params.set(KEYS.lat, coordinate(row.centre[1]));
  }
  return `?${params.toString()}`;
}

function numberOrNull(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the hand-off back, or null when the link carries no detection.
 *
 * Every field is validated: a complaint form must not prefill an area of
 * "NaN sq.m" because somebody edited the URL.
 */
export function parseComplaintHandoff(search: string): ComplaintHandoff | null {
  const params = new URLSearchParams(search);
  const detectionRef = params.get(KEYS.ref);
  const jobId = params.get(KEYS.job);
  const polygonId = params.get(KEYS.polygon);
  if (!detectionRef || !jobId || !polygonId) return null;

  const status = params.get(KEYS.status);
  return {
    detectionRef,
    jobId,
    polygonId,
    areaM2: numberOrNull(params.get(KEYS.area)),
    confidence: numberOrNull(params.get(KEYS.confidence)),
    lat: numberOrNull(params.get(KEYS.lat)),
    lon: numberOrNull(params.get(KEYS.lon)),
    status: status === "change" || status === "illegal" ? status : null,
  };
}
