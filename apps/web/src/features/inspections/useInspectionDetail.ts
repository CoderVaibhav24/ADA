/**
 * The Inspection detail screen's data layer.
 *
 * Same shape as `useInspections.ts` — TanStack Query, an `AbortSignal` through
 * to `fetch`, and no retry on a 4xx because a 403 is a verdict rather than a
 * blip. Three things are specific to this screen:
 *
 *   - **the round history is the register, filtered to one case.** There is no
 *     "rounds of a case" endpoint and this batch does not invent one:
 *     `GET /inspections?case_ref=…` already returns every round, zone-scoped,
 *     and `roundsOf` merges the open round in so the list can never omit the
 *     row the officer is looking at.
 *   - **every idempotency key is minted by the caller, not here.** Contract §4.3
 *     makes a replayed key return the ORIGINAL row with 200, which is what lets
 *     a failed upload be retried safely — and only if the key is the same one.
 *     A key minted inside `mutationFn` would be fresh on every attempt and
 *     would turn one retried photograph into two rows, silently. So the dialogs
 *     mint on open and pass it in.
 *   - **capabilities are fetched under the SAME key as the register's**,
 *     `["icms","capabilities"]`, so asking "may this officer see evidence" costs
 *     no extra request and cannot disagree with the register's answer.
 */

import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EVIDENCE_READ,
  addEvidence,
  checkIn,
  createResurveyRequest,
  decideResurveyRequest,
  fetchInspection,
  listInspectionEvidence,
  listInspections,
  listResurveyRequests,
  openInspectionRound,
  verifyInspection,
  type CheckInCreate,
  type CheckInOut,
  type EvidenceCreate,
  type EvidenceOut,
  type InspectionDetail,
  type InspectionOpen,
  type InspectionRow,
  type ResurveyCreate,
  type ResurveyDecide,
  type ResurveyRequestOut,
  type VerifyRequest,
} from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";

/** A 4xx is a verdict. Retrying a 403 only asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function inspectionKey(ref: string): readonly unknown[] {
  return ["icms", "inspection", ref];
}

/** The row itself. `available_actions` on it is what gates every write button. */
export function useInspection(ref: string, enabled: boolean) {
  return useQuery<InspectionDetail, Error>({
    queryKey: inspectionKey(ref),
    queryFn: ({ signal }) => fetchInspection(ref, signal),
    enabled: enabled && ref !== "",
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

/**
 * Every round of the case, for the history table.
 *
 * `size: 50` rather than a paginator: a case that has been re-surveyed fifty
 * times is a different problem from a missing page control, and the history is
 * a panel on a detail screen rather than a register.
 */
export function useCaseRounds(caseRef: string | null, enabled: boolean) {
  return useQuery<InspectionRow[], Error>({
    queryKey: ["icms", "inspections", "case", caseRef ?? ""],
    queryFn: async ({ signal }) => {
      const page = await listInspections(
        { case_ref: [caseRef ?? ""], sort: "round_no", size: 50 },
        signal,
      );
      return page.items;
    },
    enabled: enabled && caseRef !== null && caseRef !== "",
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

/** `evidence.read`. Append-only, so a refetch only ever grows the gallery. */
export function useInspectionEvidence(ref: string, enabled: boolean) {
  return useQuery<EvidenceOut[], Error>({
    queryKey: ["icms", "inspection", ref, "evidence"],
    queryFn: ({ signal }) => listInspectionEvidence(ref, signal),
    enabled: enabled && ref !== "",
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

/** The re-survey requests on the case, decided and pending alike, newest first. */
export function useResurveyRequests(caseRef: string | null, enabled: boolean) {
  return useQuery<ResurveyRequestOut[], Error>({
    queryKey: ["icms", "resurvey-requests", caseRef ?? ""],
    queryFn: ({ signal }) => listResurveyRequests(caseRef ?? "", signal),
    enabled: enabled && caseRef !== null && caseRef !== "",
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

export type EvidenceGate = {
  loading: boolean;
  /** True only once capabilities have answered. Never optimistic. */
  canRead: boolean;
};

/** `evidence.read` — the gallery's own gate. The rest of the screen is unaffected. */
export function useEvidenceGate(): EvidenceGate {
  const { data, isPending } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: 30_000,
    retry: shouldRetry,
  });
  return {
    loading: isPending,
    canRead: (data?.permissions ?? []).includes(EVIDENCE_READ),
  };
}

/**
 * What every write on this screen invalidates.
 *
 * All four, every time, deliberately. A check-in moves `status` to
 * `in_progress`, which changes `available_actions` on the detail, the status
 * chip in the history and the counts in the register; approving a re-survey
 * opens a round that exists in none of them yet. Refetching one and guessing
 * about the rest is how a screen ends up showing a button the server will
 * refuse.
 */
export function useInvalidateInspection(ref: string, caseRef: string | null) {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: inspectionKey(ref) }),
      client.invalidateQueries({ queryKey: ["icms", "inspections"] }),
      client.invalidateQueries({ queryKey: ["icms", "resurvey-requests", caseRef ?? ""] }),
    ]);
  }, [client, ref, caseRef]);
}

/* ---- the writes -----------------------------------------------------------
   One hook per transition, each taking its body whole so the idempotency key
   is the caller's to mint and to reuse. None of them takes a permission code:
   `workflow.check` refuses the caller whose roles do not hold the transition in
   the row's current status, which is the same rule that decided whether the
   button was drawn. ------------------------------------------------------ */

/** `CHECK_IN`. A fix worse than the threshold comes back 422 `poor_accuracy`. */
export function useCheckIn(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<CheckInOut, Error, CheckInCreate>({
    mutationFn: (body) => checkIn(ref, body),
    onSuccess: () => invalidate(),
  });
}

/** `ADD_EVIDENCE`. A capture with no fix is stored flagged, not refused. */
export function useAddEvidence(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<EvidenceOut, Error, EvidenceCreate>({
    mutationFn: (input) => addEvidence(ref, input),
    onSuccess: () => invalidate(),
  });
}

/** `VERIFY_ACCEPT` or `VERIFY_REJECT`, chosen by the body's `decision`. */
export function useVerifyInspection(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<InspectionDetail, Error, VerifyRequest>({
    mutationFn: (body) => verifyInspection(ref, body),
    onSuccess: () => invalidate(),
  });
}

/** `REQUEST_RESURVEY`. Raised against the CASE, not against this round. */
export function useRequestResurvey(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<ResurveyRequestOut, Error, ResurveyCreate>({
    mutationFn: (body) => createResurveyRequest(caseRef ?? "", body),
    onSuccess: () => invalidate(),
  });
}

/** Approving runs `OPEN_ROUND` and fills `resulting_round`; refusing does not. */
export function useDecideResurvey(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<ResurveyRequestOut, Error, { id: number; body: ResurveyDecide }>({
    mutationFn: ({ id, body }) => decideResurveyRequest(id, body),
    onSuccess: () => invalidate(),
  });
}

/** `OPEN_ROUND`. 201, and the new round is a different inspection reference. */
export function useOpenRound(ref: string, caseRef: string | null) {
  const invalidate = useInvalidateInspection(ref, caseRef);
  return useMutation<InspectionDetail, Error, InspectionOpen>({
    mutationFn: (body) => openInspectionRound(caseRef ?? "", body),
    onSuccess: () => invalidate(),
  });
}
