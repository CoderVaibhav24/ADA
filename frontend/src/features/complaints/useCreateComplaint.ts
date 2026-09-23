/**
 * The Create Complaint screen's data layer: one gate, three vocabularies, one write.
 *
 * Same shape as `features/inspections/useFindings.ts` — TanStack Query, an
 * `AbortSignal` through to `fetch`, no retry on a 4xx because a 403 is a verdict
 * rather than a blip. Three things are specific to raising a case:
 *
 *   - **the gate is a workflow ACTION, not a permission code and never a
 *     status.** There is no `case.create` in `policy.PERMISSIONS`, deliberately:
 *     who may raise a case is a row in the transition table, and
 *     `/me/capabilities` already answers it per caller as `actions[].action ==
 *     "raise"`. That is why a Super Admin — which holds every permission,
 *     `case.read` and `case.export` included — is correctly refused here: it
 *     holds no transition, so administration is not enforcement. Reading
 *     `permissions` instead would draw the form for exactly the role that
 *     cannot use it.
 *   - **capabilities are fetched under the SAME query key as the registers'.**
 *     `["icms","capabilities"]`, so one small request answers every screen's
 *     gate and two keys cannot disagree after a grant changes.
 *   - **the write is not retried by the library.** `POST /cases` is idempotent
 *     only with the SAME `idempotency_key`, so retrying is the officer's
 *     decision taken with the key the screen is still holding — not something a
 *     library does quietly with whatever it has.
 *
 * The single-case cache key is `["icms","case",ref]`, the natural key the
 * Complaint detail screen uses, so a raise seeds the detail it navigates to
 * without a second request.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCase, type CaseDetail } from "@/api/icms/cases";
import { IcmsApiError } from "@/api/icms/http";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";
import {
  COMPLAINT_TYPE_DOMAIN,
  listCodeValues,
  listZones,
  type CodeValue,
  type Zone,
} from "@/api/icms/reference";
import type { ComplaintBody } from "./complaintForm";

/** `icms_code_value.domain`. Both are seeded by migration 0001's `SEED`. */
export { COMPLAINT_TYPE_DOMAIN };
export const PROPERTY_TYPE_DOMAIN = "property_type";

/** `workflow.Action.RAISE`, as `/me/capabilities` spells it. */
export const RAISE_ACTION = "raise";

// The detail screen's key, spelled the same way on purpose rather than
// imported: that file is being written beside this one, and a shared cache key
// is a smaller coupling than a shared import.
export function caseQueryKey(ref: string): readonly unknown[] {
  return ["icms", "case", ref];
}

/** A 4xx is a verdict, not a blip. Retrying a 403 asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type RaiseGate = {
  loading: boolean;
  /** The server offered `raise` to THIS caller's roles. The only gate. */
  canRaise: boolean;
  refused: IcmsApiError | null;
};

/** Whether this officer holds the `raise` transition at all. Advisory; re-checked. */
export function useRaiseGate(): RaiseGate {
  const { data, isPending, error } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    // Short: a colleague can change this officer's grants at any moment, and
    // the cost is one small request.
    staleTime: 30_000,
    retry: shouldRetry,
  });

  return {
    loading: isPending,
    canRaise: (data?.actions ?? []).some((action) => action.action === RAISE_ACTION),
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

export type CodeOption = {
  value: string;
  label: string;
};

export type Vocabulary = {
  options: CodeOption[];
  loading: boolean;
  /** Answered empty, or failed. Either way there is nothing here to pick. */
  unavailable: boolean;
};

// `label_hi` and `name_hi` are both nullable, so a row nobody has translated
// falls back to English rather than to a blank option.
function pickLabel(language: string, english: string, hindi: string | null | undefined): string {
  return language.startsWith("hi") && hindi ? hindi : english;
}

function useCodeValues(domain: string, enabled: boolean) {
  return useQuery<CodeValue[], Error>({
    // The register's key for the same domain, so the two share one entry.
    queryKey: ["icms", "code-values", domain],
    queryFn: ({ signal }) => listCodeValues(domain, signal),
    enabled,
    // A vocabulary changes when someone edits a settings screen, not between
    // two page views.
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}

/** A picker's worth of `icms_code_value`, in the active language. */
export function useComplaintVocabulary(
  domain: string,
  enabled: boolean,
  language: string,
): Vocabulary {
  const { data, isPending, error } = useCodeValues(domain, enabled);

  return useMemo(() => {
    const options = (data ?? []).map((value) => ({
      value: value.code,
      label: pickLabel(language, value.label, value.label_hi),
    }));
    const loading = enabled && isPending;
    return {
      options,
      loading,
      unavailable: enabled && !loading && (error !== null || options.length === 0),
    };
  }, [data, enabled, error, isPending, language]);
}

/**
 * The zone picker. Already narrowed server-side to this caller's assignments.
 *
 * Which is why an empty list is a legible state rather than an empty dropdown:
 * an officer with no active zone assignment can file no case anywhere, and
 * saying that beats a control that does nothing.
 */
export function useZoneOptions(enabled: boolean, language: string): Vocabulary {
  const { data, isPending, error } = useQuery<Zone[], Error>({
    queryKey: ["icms", "zones"],
    queryFn: ({ signal }) => listZones(signal),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });

  return useMemo(() => {
    const options = (data ?? []).map((zone) => ({
      value: zone.zone_cd,
      // The code as well as the name: `zone_cd` is what the officer will see
      // again on the case, and two zones can share a colloquial name.
      label: `${pickLabel(language, zone.name, zone.name_hi)} (${zone.zone_cd})`,
    }));
    const loading = enabled && isPending;
    return {
      options,
      loading,
      unavailable: enabled && !loading && (error !== null || options.length === 0),
    };
  }, [data, enabled, error, isPending, language]);
}

/**
 * `RAISE`. 201, or 200 with the original case when the key is replayed.
 *
 * Both answers carry the same `CaseDetail` and both land here, which is the
 * whole point of the key: a retry after a dropped connection resolves to the
 * case the first attempt created instead of a second complaint about the same
 * wall. The body arrives already carrying that key — this hook does not mint
 * one, because minting inside the mutation would hand every retry a fresh key.
 */
export function useCreateCase() {
  const client = useQueryClient();
  return useMutation<CaseDetail, Error, ComplaintBody>({
    mutationFn: (body) => createCase(body),
    onSuccess: (detail) => {
      // The detail screen this navigates to reads the same key, so it opens on
      // what the server just answered rather than fetching it again.
      client.setQueryData(caseQueryKey(detail.case_ref), detail);
      // The register gained a row; every page and filter combination of it is
      // now one row out of date.
      void client.invalidateQueries({ queryKey: ["icms", "cases"] });
    },
  });
}
