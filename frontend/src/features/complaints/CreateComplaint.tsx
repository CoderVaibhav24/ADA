/**
 * `ROUTES.complaintNew` — raising a case. Figma node 23:1343.
 *
 * Stage 1 of the spine, and the first step of everything downstream: no
 * inspection, no notice and no register row exists until this screen posts.
 *
 * Five properties here are load-bearing rather than cosmetic:
 *
 *   - **nothing on this screen decides authority from a status string, or from
 *     a permission code.** The form is drawn when `/me/capabilities` offers the
 *     `raise` ACTION to this caller's roles — the transition table's own
 *     answer, computed server-side. There is no `case.create` permission to
 *     read instead, deliberately: a Super Admin holds every permission and no
 *     transition, so gating on permissions would draw the form for exactly the
 *     role the server will refuse. `useRaiseGate` is where that is decided,
 *     once.
 *   - **one idempotency key lives for one submit attempt.** It is minted when
 *     the officer confirms and held until the server answers, so a retry after
 *     a dropped connection replays the same intent and comes back with the case
 *     the first attempt raised rather than raising a second one. A replay
 *     answers **200 where the first attempt answered 201**, and both carry the
 *     same `CaseDetail` — so both land in `onSuccess` and there is no
 *     client-side "already raised" branch, because one would contradict the
 *     server about a case it has already filed.
 *   - **a half-written complaint is not thrown away quietly.** Leaving the tab
 *     warns, and Back and Cancel both ask first.
 *   - **the zone refusal is not decoded.** `zone_not_found` is the server's one
 *     answer for a zone that does not exist and a zone outside the caller's
 *     scope alike; this screen renders one sentence for it and makes no attempt
 *     to say which, because the response carries nothing to say it with and
 *     guessing would be guessing about someone else's jurisdiction.
 *   - **a detection hands over what it actually knows, and no more.** Source,
 *     polygon and point are filled; the reference, the area and the confidence
 *     are shown as the case's origin because `CaseCreate` has no column for
 *     them. Everything else is the officer's to enter, exactly as a manual
 *     complaint would be — which is the normal case, not the fallback.
 *
 * The one thing the browser is not promised: an in-app navigation away from
 * here — the rail, a link — is not intercepted. `useBlocker` needs a data
 * router and this tree is `<Routes>`; `beforeunload` covers a reload or a
 * closed tab, and Back and Cancel ask, but the rail does not.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { newIdempotencyKey } from "@/api/icms/cases";
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
// Read-only: the hand-off contract is written down once, in the feature that
// produces it, rather than guessed at twice.
import { parseComplaintHandoff } from "@/features/changeDetection/complaintHandoff";
import { useFormats } from "@/i18n";
import { usePriorityLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import {
  COMPLAINT_PRIORITIES,
  blankComplaintForm,
  fieldId,
  firstProblem,
  hasErrors,
  isDirty,
  seedComplaintForm,
  toComplaintBody,
  validateComplaintForm,
  type ComplaintFormErrors,
  type ComplaintFormState,
} from "./complaintForm";
import {
  ComplaintTypePanel,
  DescriptionPanel,
  LocationPanel,
  OriginPanel,
  ParcelPanel,
  PropertyPanel,
  SourceAndComplainant,
} from "./CreateComplaintFields";
import { useComplaintNewLabels, type ComplaintNewLabels } from "./complaintLabels";
import {
  COMPLAINT_TYPE_DOMAIN,
  PROPERTY_TYPE_DOMAIN,
  useComplaintVocabulary,
  useCreateCase,
  useRaiseGate,
  useZoneOptions,
} from "./useCreateComplaint";

const NO_ERRORS: ComplaintFormErrors = {};

/**
 * A refusal the server made, said in the officer's language.
 *
 * A code with a sentence of its own gets it, and the server's own message is
 * kept underneath because it names the field at fault. A code with no sentence
 * falls back to that message rather than to a guess. The request id is always
 * shown: it is what ties this failure to the server's own log line.
 */
function RefusalAlert({
  title,
  error,
  labels,
  children,
}: {
  title: string;
  error: IcmsApiError;
  labels: ComplaintNewLabels;
  children?: ReactNode;
}) {
  const mapped = labels.refusal(error.code);
  return (
    <Alert role="alert" variant="destructive" className="border-status-danger-border">
      <Icon name="feedback.error" className="size-4" />
      <AlertTitle className="text-pretty">{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span className="text-pretty">{mapped ?? error.message ?? labels.errorBody}</span>
        {mapped !== null && error.message !== "" && (
          <span className="text-2xs text-fg-faint text-pretty">{error.message}</span>
        )}
        {error.requestId && (
          <span className="text-2xs text-fg-faint">
            {labels.requestId}{" "}
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono break-all">
              {error.requestId}
            </code>
          </span>
        )}
        {children}
      </AlertDescription>
    </Alert>
  );
}

export default function CreateComplaint() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const formats = useFormats();
  const labels = useComplaintNewLabels();
  const priorityLabels = usePriorityLabels();

  const gate = useRaiseGate();
  const create = useCreateCase();

  const handoff = useMemo(() => parseComplaintHandoff(search), [search]);

  // Square metres and a percentage, formatted once and used by both the origin
  // panel and the description it seeds, so the two cannot disagree.
  const area = useMemo(() => {
    const value = handoff?.areaM2;
    return value === null || value === undefined ? null : formats.number(Math.round(value));
  }, [formats, handoff]);

  const confidence = useMemo(() => {
    const value = handoff?.confidence;
    return value === null || value === undefined
      ? null
      : formats.number(Math.round(value * 100));
  }, [formats, handoff]);

  // Seeded ONCE, at mount, by a lazy initialiser. A later language change must
  // not rewrite a description the officer has already edited — and `baseline`
  // is the same object the form starts from, so an untouched form is not dirty.
  const [baseline] = useState<ComplaintFormState>(() =>
    handoff === null
      ? blankComplaintForm()
      : seedComplaintForm(
          handoff,
          labels.origin.seedDetail(handoff.detectionRef, area ?? "", confidence ?? ""),
        ),
  );

  const [form, setForm] = useState<ComplaintFormState>(baseline);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /**
   * The key for ONE submit attempt, held across every retry of it.
   *
   * Cleared only when the server has answered. While it is set, pressing Submit
   * again replays the same intent, which the unique key server-side turns into
   * "here is the case you already raised".
   */
  const submitKey = useRef<string | null>(null);

  const language = formats.language;
  const types = useComplaintVocabulary(COMPLAINT_TYPE_DOMAIN, gate.canRaise, language);
  const propertyTypes = useComplaintVocabulary(PROPERTY_TYPE_DOMAIN, gate.canRaise, language);
  const zones = useZoneOptions(gate.canRaise, language);

  const priorities = useMemo(
    () => COMPLAINT_PRIORITIES.map((value) => ({ value, label: priorityLabels[value] })),
    [priorityLabels],
  );

  const dirty = isDirty(baseline, form);

  // Covers a reload and a closed tab. An in-app navigation cannot be
  // intercepted without a data router, which is why Back and Cancel ask
  // separately.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  const errors = useMemo(() => validateComplaintForm(form), [form]);
  // A form is not wrong before it has been used: nothing is marked until a
  // submit has actually been refused.
  const shownErrors = attempted ? errors : NO_ERRORS;

  const onChange = useCallback((next: ComplaintFormState) => {
    setForm(next);
  }, []);

  // The press is what produces the sentence explaining what is missing, so the
  // button is never disabled by a validation state.
  const askSubmit = useCallback(() => {
    setAttempted(true);
    const problems = validateComplaintForm(form);
    if (hasErrors(problems)) {
      const field = firstProblem(problems);
      if (field !== null) document.getElementById(fieldId(field))?.focus();
      return;
    }
    setConfirming(true);
  }, [form]);

  const runSubmit = useCallback(() => {
    setConfirming(false);
    submitKey.current ??= newIdempotencyKey();
    create.mutate(toComplaintBody(form, submitKey.current), {
      onSuccess: (detail) => {
        submitKey.current = null;
        // The case exists now; its detail screen is where the assignment and
        // everything after it lives.
        void navigate(ROUTES.complaint(detail.case_ref));
      },
    });
  }, [create, form, navigate]);

  const goBack = useCallback(() => {
    if (dirty) {
      setLeaving(true);
      return;
    }
    void navigate(ROUTES.complaints);
  }, [dirty, navigate]);

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

  // Not a redirect to the login screen: the officer IS signed in, they are
  // simply not allowed to raise a case, and a login form they already passed
  // reads as a bug.
  if (!gate.canRaise) {
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[40vh] max-w-prose flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
          <Icon name="nav.createComplaint" className="size-5" />
        </span>
        <h1 className="font-display text-xl font-bold text-balance text-fg-strong">
          {labels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-muted text-pretty">{labels.gate.deniedBody}</p>
        {gate.refused?.requestId && (
          <p className="text-2xs text-fg-faint">
            {labels.requestId}{" "}
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono break-all">
              {gate.refused.requestId}
            </code>
          </p>
        )}
      </section>
    );
  }

  const busy = create.isPending;
  const failure = create.error instanceof IcmsApiError ? create.error : null;
  const fields = { labels, state: form, onChange, disabled: busy, errors: shownErrors };

  return (
    // No gutter and no max-width here: AppShell's `main` supplies both, once,
    // for every screen.
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
          onClick={goBack}
        >
          <Icon name="action.back" className="size-4" />
          {labels.back}
        </Button>
      </div>

      <header className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
          {labels.title}
        </h1>
        <p className="mt-1 text-sm text-fg-muted text-pretty">{labels.subtitle}</p>
      </header>

      {handoff !== null && (
        <OriginPanel
          labels={labels}
          detectionRef={handoff.detectionRef}
          area={area}
          confidence={confidence}
          status={handoff.status}
        />
      )}

      <form
        className="flex min-w-0 flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          askSubmit();
        }}
      >
        <SourceAndComplainant {...fields} />
        <LocationPanel {...fields} zones={zones} />
        <ComplaintTypePanel {...fields} types={types} />
        <PropertyPanel {...fields} propertyTypes={propertyTypes} />
        <ParcelPanel {...fields} />
        <DescriptionPanel {...fields} priorities={priorities} />

        {failure && (
          <RefusalAlert title={labels.errorTitle} error={failure} labels={labels}>
            {/* Retries the ATTEMPT, not the request: `submitKey` still holds the
                key the refused attempt used, so this replays it. A replay the
                server accepts comes back 200 with the case already raised,
                which is a completed raise and lands in the same success path
                the first attempt would have. */}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={runSubmit}>
              <Icon name="action.retry" className="size-4" />
              {labels.retry}
            </Button>
          </RefusalAlert>
        )}

        <footer className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              {/* In words, not a colour: "unsaved" is what an officer leaving
                  this screen has to know. */}
              {dirty && (
                <p role="status" className="flex items-center gap-2 text-xs text-fg-muted">
                  <Icon name="feedback.warning" className="size-3.5" />
                  {labels.unsaved}
                </p>
              )}
              {attempted && hasErrors(errors) && (
                <p
                  role="status"
                  className="max-w-prose text-xs text-status-danger-fg text-pretty"
                >
                  {labels.errorBody}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={goBack}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                <Icon
                  name={busy ? "feedback.loading" : "action.send"}
                  spin={busy}
                  className="size-4"
                />
                {busy ? labels.submitting : labels.submit}
              </Button>
            </div>
          </div>
        </footer>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.submitConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {labels.submitConfirmBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={runSubmit}>
              {labels.submitConfirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.unsaved}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {labels.unsavedBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.stay}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLeaving(false);
                void navigate(ROUTES.complaints);
              }}
            >
              {labels.unsavedLeave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
