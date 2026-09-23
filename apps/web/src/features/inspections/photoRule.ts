/**
 * How many photographs a round holds, measured against the rule the server
 * publishes at `/api/icms/app-config`.
 *
 * Pure, so it can be tested without a server and without React. Two properties
 * it must keep:
 *
 *   - **only photographs are counted.** A round carries documents, signatures
 *     and video as well, all of them evidence, none of them a photograph. The
 *     `kind` is on every `EvidenceOut`, so there is nothing to infer.
 *   - **an unpublished bound is `null`, and `null` decides nothing.** With no
 *     maximum there is no ceiling to be at; with no minimum there is no
 *     shortfall. The server is the judge in both cases, which is the honest
 *     answer when the portal has not been told the rule.
 */

import type { AppConfig } from "@/api/icms/appConfig";
import type { EvidenceOut } from "@/api/icms/inspections";

/** `icms_evidence.kind` for a photograph — the only kind either bound counts. */
export const PHOTO_KIND = "photo";

export type PhotoRule = {
  /** Photographs this round holds now. */
  count: number;
  /** The server's bounds, or `null` where it has not published one. */
  minimum: number | null;
  maximum: number | null;
  /** Both bounds are in hand, so the rule can be said in full. */
  stated: boolean;
  /** At the ceiling. Evidence is append-only, so there is no way back from it. */
  atCeiling: boolean;
  /** Photographs still needed before a submit can be expected to pass. */
  shortfall: number;
};

/** Photographs only: a document or a signature is evidence, not a photograph. */
export function countPhotographs(evidence: readonly EvidenceOut[]): number {
  return evidence.filter((item) => item.kind === PHOTO_KIND).length;
}

/** The rule as it stands for this round. Every bound is the server's or `null`. */
export function photoRuleOf(config: AppConfig | null, count: number): PhotoRule {
  const minimum = config?.minimum_photo_count ?? null;
  const maximum = config?.maximum_photo_count ?? null;
  return {
    count,
    minimum,
    maximum,
    stated: minimum !== null && maximum !== null,
    atCeiling: maximum !== null && count >= maximum,
    shortfall: minimum === null ? 0 : Math.max(0, minimum - count),
  };
}
