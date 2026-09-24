/**
 * The findings form's data layer: one read, two writes, three vocabularies.
 *
 * Same shape as `useInspections.ts` beside it — TanStack Query, an
 * `AbortSignal` through to `fetch`, no retry on a 4xx. Three things are
 * specific to a form rather than to a register:
 *
 *   - **the inspection is not refetched behind the officer's back.** A
 *     register may refresh under a scroll position; a form may not refresh
 *     under half-typed text. `refetchOnWindowFocus` is off and the screen seeds
 *     its state once, then re-seeds it only from what a write returns.
 *   - **both writes answer with the whole `InspectionDetail`**, including a
 *     fresh `available_actions`. That response goes straight into the cache, so
 *     the buttons drawn after a save are the ones the server has just said are
 *     allowed rather than the ones that were allowed before it.
 *   - **neither mutation retries by itself.** `POST /submit` is idempotent and
 *     safe to replay, but only with the SAME key. Retrying is therefore the
 *     officer's decision, taken with the key the screen is still holding, and
 *     not something a library does quietly with whatever it has.
 *
 * The cache key is `["icms", "inspection", ref]` — the same natural key
 * `useInspectionDetail.ts` uses, so the detail screen and this form share one
 * entry and a save here is visible there without a second request.
 *
 * The act and section vocabularies are `icms_code_value` domains that no
 * migration seeds yet: `0001_baseline.py` `SEED` carries `complaint_type`,
 * `property_type`, `area_type` and `delivery_mode`, and nothing else. So the
 * section picker has to render "no vocabulary" as a legible state rather than
 * as an empty dropdown.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInspection,
  putFindings,
  submitInspection,
  type FindingsPut,
  type InspectionDetail,
  type SubmitRequest,
} from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { listCodeValues, type CodeValue } from "@/api/icms/reference";

/** `icms_code_value.domain`. `area_type` is seeded; the other two are not, yet. */
export const AREA_TYPE_DOMAIN = "area_type";
export const ACT_DOMAIN = "act";
export const SECTION_DOMAIN = "section";
export const CONSTRUCTION_STAGE_DOMAIN = "construction_stage";

// The detail screen's key, spelled the same way on purpose. Not imported from
// its module: that file is being written beside this one, and a shared cache
// key is a smaller coupling than a shared import.
function inspectionQueryKey(ref: string): readonly unknown[] {
  return ["icms", "inspection", ref];
}

/** A 4xx is a verdict, not a blip. Retrying a 403 asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** A reference that does not exist — or one outside the caller's zones. */
export function isNotFound(error: unknown): boolean {
  return error instanceof IcmsApiError && error.status === 404;
}

export function useFindingsInspection(ref: string, enabled: boolean) {
  return useQuery<InspectionDetail, Error>({
    queryKey: inspectionQueryKey(ref),
    queryFn: ({ signal }) => fetchInspection(ref, signal),
    enabled: enabled && ref !== "",
    staleTime: 30_000,
    // A refetch while the officer is typing would either discard their edits or
    // leave the screen disagreeing with itself. Writes re-seed it instead.
    refetchOnWindowFocus: false,
    retry: shouldRetry,
  });
}

/**
 * One vocabulary, under the key the Complaints register already uses.
 *
 * `listCodeValues` pins `size` to the 200-row ceiling, which every domain in
 * this schema is far inside. A vocabulary that ever outgrew it would need a
 * searchable picker rather than a longer dropdown.
 */
function useCodeValues(domain: string, enabled: boolean) {
  return useQuery<CodeValue[], Error>({
    queryKey: ["icms", "code-values", domain],
    queryFn: ({ signal }) => listCodeValues(domain, signal),
    enabled,
    // A vocabulary changes when someone edits a settings screen, not between
    // two page views.
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}

export type CodeOption = {
  value: string;
  label: string;
  /** `icms_code_value.parent_code` — what narrows sections to their act. */
  parent: string | null;
};

export type Vocabulary = {
  options: CodeOption[];
  loading: boolean;
  /** Answered empty, or failed. Either way there is nothing here to pick. */
  unavailable: boolean;
  /** Code to label, so a stored code renders as words even if it is retired. */
  label: (code: string) => string;
};

// `label_hi` is nullable, so a value nobody has translated falls back to
// English rather than to a blank option.
function pickLabel(language: string, value: CodeValue): string {
  return language.startsWith("hi") && value.label_hi ? value.label_hi : value.label;
}

/** A dropdown's worth of `icms_code_value`, in the active language. */
export function useVocabulary(
  domain: string,
  enabled: boolean,
  language: string,
): Vocabulary {
  const { data, isPending, error } = useCodeValues(domain, enabled);

  return useMemo(() => {
    const options = (data ?? []).map((value) => ({
      value: value.code,
      label: pickLabel(language, value),
      parent: value.parent_code ?? null,
    }));
    const byCode = new Map(options.map((option) => [option.value, option.label]));
    const loading = enabled && isPending;

    return {
      options,
      loading,
      unavailable: enabled && !loading && (error !== null || options.length === 0),
      // The raw code is the fallback: a section cited last year under a value
      // since retired must still read as something rather than as blank.
      label: (code: string) => byCode.get(code) ?? code,
    };
  }, [data, enabled, error, isPending, language]);
}

/** `RECORD_FINDINGS`. The response replaces the cached inspection outright. */
export function useSaveFindings(ref: string) {
  const client = useQueryClient();
  return useMutation<InspectionDetail, Error, FindingsPut>({
    mutationFn: (body) => putFindings(ref, body),
    onSuccess: (detail) => {
      client.setQueryData(inspectionQueryKey(ref), detail);
      // The register renders `finding_count` and the round's status, and this
      // write moves both.
      void client.invalidateQueries({ queryKey: ["icms", "inspections"] });
    },
  });
}

/**
 * `SUBMIT`. The key is the caller's to mint and to hold.
 *
 * Contract §4.3: a replayed key returns the round already submitted with 200,
 * which is what lets a dropped connection be retried rather than guessed at.
 * So this takes the key instead of making one — minting inside the mutation
 * would hand every retry a fresh key and destroy the property silently.
 */
export function useSubmitInspection(ref: string) {
  const client = useQueryClient();
  return useMutation<InspectionDetail, Error, SubmitRequest>({
    mutationFn: (body) => submitInspection(ref, body),
    onSuccess: (detail) => {
      client.setQueryData(inspectionQueryKey(ref), detail);
      void client.invalidateQueries({ queryKey: ["icms", "inspections"] });
    },
  });
}
