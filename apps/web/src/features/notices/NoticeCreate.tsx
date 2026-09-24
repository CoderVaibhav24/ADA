/**
 * `ROUTES.noticeNew` — issuing a notice. Figma node 69:2961.
 *
 * Stage 7 of the spine and the last thing this portal does to a case: the
 * Parivartan App owns everything after the notice exists (build-order §3a).
 *
 * Four properties here are load-bearing rather than cosmetic:
 *
 *   - **nothing on this screen decides authority from a status string.** The
 *     submit button is drawn when the CASE's `allowed_actions` — the field name
 *     on `CaseDetail`; `available_actions` is the inspection row's — contains
 *     `issue_notice`. That is the transition table's own answer, computed
 *     server-side for this caller's roles in this case's state. Comparing
 *     `case.status` to `"confirmed"` would reimplement a table this screen
 *     cannot see and would draw the button for exactly the role the server is
 *     about to refuse.
 *   - **the gate is per-CASE, so it is re-read when the case changes.** Unlike
 *     Create Complaint, whose `raise` gate is a property of the officer, this
 *     one is a property of the pair. Switching the picker to another complaint
 *     re-asks the server.
 *   - **there is no idempotency key, so there is no automatic retry.**
 *     `icms_notice` has no `idempotency_key` column: the guard against a double
 *     issue is the transition itself, which stops offering `issue_notice` the
 *     moment the case reaches `notice_issued`. A library retry after a timeout
 *     would file a second statutory notice if the first one landed, so
 *     `useCreateNotice` sets `retry: false` and a retry is the officer's
 *     decision, taken after reading what the server said.
 *   - **a half-written notice is not thrown away quietly.** Leaving the tab
 *     warns, and Back and Cancel both ask first.
 *
 * The one thing the browser is not promised: an in-app navigation away from
 * here — the rail, a link — is not intercepted. `useBlocker` needs a data
 * router and this tree is `<Routes>`; `beforeunload` covers a reload or a
 * closed tab, and Back and Cancel ask, but the rail does not. The same
 * limitation Create Complaint records.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toIstDateKey } from "@ada/shared/dates";
import { allowsIssueNotice, GROUNDS_KEY } from "@/api/icms/notices";
import { IcmsApiError } from "@/api/icms/http";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
import { useCaseStatusLabels } from "@/i18n/labels";
import { CASE_STATUS_META, toCaseStatus } from "@/features/complaints/caseStatus";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { NoticeFields, NoticeTemplatePanel } from "./NoticeCreateFields";
import {
  blankNoticeForm,
  fieldId,
  firstProblem,
  hasErrors,
  isDirty,
  toNoticeBody,
  validateNoticeForm,
  type NoticeFormErrors,
  type NoticeFormState,
} from "./noticeForm";
import { useNoticeNewLabels, type NoticeNewLabels } from "./noticeLabels";
import { Absent, DetailPanel, Field, Mono } from "./parts";
import {
  useActOptions,
  useCaseForNotice,
  useConfirmedCases,
  useCreateNotice,
  useNoticeGate,
  useSectionOptions,
} from "./useNotices";

const NO_ERRORS: NoticeFormErrors = {};

/**
 * A refusal the server made, said where the officer is looking.
 *
 * The server's own message is what is rendered: contract §6 writes those to be
 * read, and inventing a friendlier sentence for a code this screen does not
 * recognise would mean guessing. The request id is always shown — it is the one
 * thing on screen that ties the refusal to a line in the server's log.
 */
function RefusalAlert({ error, labels }: { error: IcmsApiError; labels: NoticeNewLabels }) {
  return (
    <Alert variant="destructive" role="alert">
      <Icon name="feedback.error" className="size-4" />
      <AlertTitle>{labels.refusedTitle}</AlertTitle>
      <AlertDescription>
        <p className="text-pretty">{error.message}</p>
        {error.requestId && (
          <p className="mt-1 font-mono text-2xs break-all">
            {labels.requestId} {error.requestId}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default function NoticeCreate() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const labels = useNoticeNewLabels();
  const caseStatusLabels = useCaseStatusLabels();
  const { language, date } = useFormats();

  // A link from the complaint carries the case it was opened from; typing the
  // route by hand carries nothing, and the picker is how it is chosen then.
  const seededCase = search.get("case_ref") ?? "";
  const initial = useMemo(() => blankNoticeForm(seededCase), [seededCase]);
  const [state, setState] = useState<NoticeFormState>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const gate = useNoticeGate();
  const mayOpen = !gate.loading && gate.canIssue;
  const acts = useActOptions(mayOpen, language);
  const sections = useSectionOptions(state.actCd, mayOpen, language);
  const cases = useConfirmedCases(mayOpen && gate.canReadCases);

  // The case is re-read whenever the picker moves: `allowed_actions` is a
  // property of the pair (this officer, this case), not of the officer.
  const caseQuery = useCaseForNotice(state.caseRef, mayOpen && state.caseRef !== "");
  const mayIssue = allowsIssueNotice(caseQuery.data);

  const create = useCreateNotice(state.caseRef);
  const submitting = create.isPending;

  const today = toIstDateKey(new Date());
  const errors = submitted ? validateNoticeForm(state, today) : NO_ERRORS;
  const dirty = isDirty(state, initial);

  // Covers a reload and a closed tab. An in-app navigation is not interceptable
  // in a `<Routes>` tree — see the module comment.
  useEffect(() => {
    if (!dirty || submitting) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, submitting]);

  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitted(true);

      const problems = validateNoticeForm(state, today);
      if (hasErrors(problems)) {
        // Focus lands on the first field in FORM order that is wrong, so the
        // officer starts reading where the problem is rather than at the top.
        const field = firstProblem(problems);
        if (field) {
          const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
          element?.focus();
        }
        return;
      }

      create.mutate(toNoticeBody(state, GROUNDS_KEY), {
        onSuccess: (detail) => {
          void navigate(ROUTES.notice(detail.notice_ref), { replace: true });
        },
      });
    },
    [create, navigate, state, today],
  );

  const leave = useCallback(() => {
    void navigate(ROUTES.notices);
  }, [navigate]);

  const askToLeave = useCallback(() => {
    if (dirty) setDiscarding(true);
    else leave();
  }, [dirty, leave]);

  if (gate.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.loading" spin className="size-4" />
          {labels.gate.checking}
        </span>
      </div>
    );
  }

  // The per-case `issue_notice` gate below still applies once this one passes.
  if (!gate.canIssue) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
              {labels.title}
            </h1>
  
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
          onClick={askToLeave}
        >
          <Icon name="action.back" className="size-4" />
          {labels.back}
        </Button>
      </header>
        <Alert variant="destructive" role="alert">
          <Icon name="feedback.error" className="size-4" />
          <AlertTitle>{labels.gate.noIssueTitle}</AlertTitle>
          <AlertDescription>
            <p className="text-pretty">{labels.gate.noIssueBody}</p>
          </AlertDescription>
        </Alert>
        <div>
          <Button variant="outline" size="sm" onClick={leave}>
            <Icon name="action.back" className="size-4" />
            {labels.back}
          </Button>
        </div>
      </div>
    );
  }

  const refusal = create.error instanceof IcmsApiError ? create.error : null;
  const caseError = caseQuery.error instanceof IcmsApiError ? caseQuery.error : null;
  const caseMissing = caseError?.status === 404;
  const caseStatus = toCaseStatus(caseQuery.data?.status ?? null);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
          {labels.title}
        </h1>
        <p className="mt-1 text-sm text-fg-canvas-muted">{labels.subtitle}</p>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          className="flex min-w-0 flex-col gap-6"
        >
          <DetailPanel title={labels.formTitle}>
            <NoticeFields
              labels={labels}
              state={state}
              onChange={setState}
              disabled={submitting}
              errors={errors}
              acts={acts}
              sections={sections}
              cases={cases.data ?? []}
              casesLoading={cases.isPending && gate.canReadCases}
              casePickerAvailable={gate.canReadCases}
              formatDate={date}
            />
          </DetailPanel>

          {/* ---- the case, read-only ----------------------------------
              Figma collects the recipient, the address, the khasra number and
              the encroached area on this form. `NoticeCreate` stores none of
              them — they are the case's, and the server reads them from
              `icms_case` when it renders. Showing them here is how an officer
              checks they are issuing against the right property; collecting
              them would be a form lying about what it stores. */}
          {state.caseRef !== "" && (
            <DetailPanel title={labels.caseSummary.title} description={labels.caseSummary.hint}>
              {caseQuery.isPending ? (
                <LoadingState label={labels.caseSummary.loading} lines={2} />
              ) : caseError ? (
                <Alert variant="destructive" role="alert">
                  <Icon name="feedback.error" className="size-4" />
                  <AlertTitle>
                    {caseMissing
                      ? labels.caseSummary.notFoundTitle
                      : labels.caseSummary.errorTitle}
                  </AlertTitle>
                  <AlertDescription>
                    {caseMissing ? labels.caseSummary.notFoundBody : caseError.message}
                  </AlertDescription>
                </Alert>
              ) : caseQuery.data ? (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={labels.caseSummary.status}>
                    {caseStatus ? (
                      <StatusChip status={CASE_STATUS_META[caseStatus].chip} size="sm">
                        {caseStatusLabels[caseStatus]}
                      </StatusChip>
                    ) : (
                      <Mono>{caseQuery.data.status}</Mono>
                    )}
                  </Field>
                  <Field label={labels.caseSummary.zone}>
                    <Mono>{caseQuery.data.zone_cd}</Mono>
                  </Field>
                  <Field label={labels.caseSummary.complainant}>
                    {caseQuery.data.complainant_name ?? (
                      <Absent>{labels.caseSummary.absent}</Absent>
                    )}
                  </Field>
                  <Field label={labels.caseSummary.khasra}>
                    {caseQuery.data.khasra_no ? (
                      <Mono>{caseQuery.data.khasra_no}</Mono>
                    ) : (
                      <Absent>{labels.caseSummary.absent}</Absent>
                    )}
                  </Field>
                  <Field label={labels.caseSummary.address} wide>
                    {caseQuery.data.property_address ?? (
                      <Absent>{labels.caseSummary.absent}</Absent>
                    )}
                  </Field>
                </dl>
              ) : null}
            </DetailPanel>
          )}

          {refusal && <RefusalAlert error={refusal} labels={labels} />}

          {/* The gate, said out loud rather than silently disabling a button.
              A control with no explanation is the single most common
              accessibility complaint on a government form. */}
          {state.caseRef !== "" && caseQuery.data && !mayIssue && (
            <Alert role="status">
              <Icon name="feedback.info" className="size-4" />
              <AlertTitle>{labels.gate.deniedTitle}</AlertTitle>
              <AlertDescription>{labels.gate.deniedBody}</AlertDescription>
            </Alert>
          )}

          {state.caseRef === "" && (
            <Alert role="status">
              <Icon name="feedback.info" className="size-4" />
              <AlertTitle>{labels.gate.noCaseTitle}</AlertTitle>
              <AlertDescription>{labels.gate.noCaseBody}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="ghost" disabled={submitting} onClick={askToLeave}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !mayIssue}>
              <Icon
                name={submitting ? "feedback.loading" : "notice.issue"}
                spin={submitting}
                className="size-4"
              />
              {submitting ? labels.submitting : labels.submit}
            </Button>
          </div>
        </form>

        <NoticeTemplatePanel labels={labels} />
      </div>

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.discardCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={leave}>{labels.discardConfirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
