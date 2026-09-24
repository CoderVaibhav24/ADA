/**
 * The Complaint detail screen's data layer.
 *
 * Same shape as `useCases.ts` — TanStack Query, an `AbortSignal` through to
 * `fetch`, and no retry on a 4xx because a 404 is a verdict rather than a blip.
 * Three things are specific to this screen:
 *
 *   - **capabilities are fetched under the SAME key as the register's**,
 *     `["icms","capabilities"]`, so asking "may this officer read a case, and
 *     what does the workflow demand of them" costs no extra request and cannot
 *     disagree with the register's answer.
 *   - **the gate hands back `actions`, not just `permissions`.**
 *     `/me/capabilities` publishes the live transition table filtered to this
 *     caller, `requires` included, which is what lets the assign dialog ask for
 *     a reason because the SERVER says so rather than because a tuple compiled
 *     into this build says so.
 *   - **every write returns the whole case, so the answer is planted rather
 *     than refetched.** `assign` and `amend` both respond with `CaseDetail`;
 *     writing it straight into the cache means the status chip, the assignment
 *     panel and `allowed_actions` all move together in one paint.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CASE_AMEND,
  CASE_READ,
  amendCase,
  assignCase,
  closeCase,
  fetchAssignees,
  fetchCase,
  rejectCase,
  type AssigneeOptions,
  type CaseAmend,
  type CaseAssign,
  type CaseClose,
  type CaseDetail,
  type CaseReject,
} from "@/api/icms/cases";
import { IcmsApiError } from "@/api/icms/http";
import {
  fetchCapabilities,
  type Capabilities,
  type CapabilityAction,
} from "@/api/icms/policy";

/** Distinct from the register's `["icms","cases",…]`, which keys a page of rows. */
export function caseKey(caseRef: string): readonly unknown[] {
  return ["icms", "case", caseRef];
}

/** A 4xx is a verdict. Retrying a 404 only asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type CaseGate = {
  loading: boolean;
  /** True only once capabilities have answered. Never optimistic. */
  canRead: boolean;
  /** `case.amend`. The case's own `allowed_actions` still decides per case. */
  canAmend: boolean;
  permissions: readonly string[];
  /** The caller's own id, for marking their own assignment on the screen. */
  userId: string | null;
  /** The live transition table for this caller — the source of every `requires`. */
  actions: CapabilityAction[] | undefined;
};

/** `case.read` — the gate in front of this screen, the same one the register uses. */
export function useCaseGate(): CaseGate {
  const { data, isPending } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    // Short: a colleague can change this officer's grants at any moment, and
    // the cost is one small request.
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: 30_000,
    retry: shouldRetry,
  });

  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
    canRead: permissions.includes(CASE_READ),
    canAmend: permissions.includes(CASE_AMEND),
    permissions,
    userId: data?.user_id ?? null,
    actions: data?.actions,
  };
}

/** The case itself. `allowed_actions` on it is what gates every write button. */
export function useCase(caseRef: string, enabled: boolean) {
  return useQuery<CaseDetail, Error>({
    queryKey: caseKey(caseRef),
    queryFn: ({ signal }) => fetchCase(caseRef, signal),
    enabled: enabled && caseRef !== "",
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

/** Who the assign dialog may offer; fetched only while the dialog is open. */
export function useCaseAssignees(caseRef: string, enabled: boolean) {
  return useQuery<AssigneeOptions, Error>({
    queryKey: [...caseKey(caseRef), "assignees"],
    queryFn: ({ signal }) => fetchAssignees(caseRef, signal),
    enabled: enabled && caseRef !== "",
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/**
 * What a write on this screen invalidates — the register as well as the case.
 * An assignment moves `status` and `assignee_user_id`, which are two columns of
 * the grid the officer came from.
 */
function useSettleCase(caseRef: string) {
  const client = useQueryClient();
  return (updated: CaseDetail) => {
    client.setQueryData(caseKey(caseRef), updated);
    void client.invalidateQueries({ queryKey: ["icms", "cases"] });
    // A reassignment closes one assignment row and opens another, which the
    // inspection register reads as the case's surveyor.
    void client.invalidateQueries({ queryKey: ["icms", "inspections"] });
    // Reject and close move a case out of the open counts.
    void client.invalidateQueries({ queryKey: ["icms", "dashboard"] });
  };
}

/** `POST /cases/{ref}/assign` — one endpoint for both `assign` and `reassign`. */
export function useAssignCase(caseRef: string) {
  const settle = useSettleCase(caseRef);
  return useMutation<CaseDetail, Error, CaseAssign>({
    mutationFn: (body) => assignCase(caseRef, body),
    onSuccess: settle,
  });
}

/** `PATCH /cases/{ref}` — the descriptive fields, never the status. */
export function useAmendCase(caseRef: string) {
  const settle = useSettleCase(caseRef);
  return useMutation<CaseDetail, Error, CaseAmend>({
    mutationFn: (body) => amendCase(caseRef, body),
    onSuccess: settle,
  });
}

/** `POST /cases/{ref}/reject` — terminal; releases the survey assignment. */
export function useRejectCase(caseRef: string) {
  const settle = useSettleCase(caseRef);
  return useMutation<CaseDetail, Error, CaseReject>({
    mutationFn: (body) => rejectCase(caseRef, body),
    onSuccess: settle,
  });
}

/** `POST /cases/{ref}/close` — terminal, after the notice. */
export function useCloseCase(caseRef: string) {
  const settle = useSettleCase(caseRef);
  return useMutation<CaseDetail, Error, CaseClose>({
    mutationFn: (body) => closeCase(caseRef, body),
    onSuccess: settle,
  });
}
