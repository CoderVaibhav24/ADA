/**
 * `ROUTES.inspectionFindings()` — recording what was seen at the site.
 *
 * Figma 60:641 is the reference for the layout; `FindingsFields.tsx` documents
 * where the frame and the columns disagree and which side won. Four properties
 * here are load-bearing rather than cosmetic:
 *
 *   - **nothing on this screen decides what may be done from a status string.**
 *     Save is drawn when `available_actions` carries `record_findings` and
 *     Submit when it carries `submit`, both computed by the server for this
 *     caller's roles in this round's state. The status chip is a fact on the
 *     header, never an input to a decision — contract §5, and the reason
 *     `allows()` exists in the client at all.
 *   - **an empty findings list never reaches the wire.** `FindingsPut` has
 *     `min_length=1`, so a save with nothing written would be a 422 the officer
 *     could only read as a malfunction. The form refuses it, says which field
 *     and why, and moves the focus there. The Save button is NOT disabled: a
 *     control that cannot be pressed teaches nothing about what is missing.
 *   - **one idempotency key lives for one submit attempt.** It is minted when
 *     the officer confirms and held until the server answers, so a retry after
 *     a dropped connection replays the same intent and comes back with the
 *     round already submitted rather than submitting twice. Minting per request
 *     would break contract §4.3 silently, which is the whole reason the field
 *     app can retry. `POST /submit` answers **200 either way** and the replay
 *     is resolved from the round's state rather than from a key column, so a
 *     replayed submit is a COMPLETED submit and is handled by `onSuccess` —
 *     there is no client-side "already submitted" guard here, because one
 *     would contradict the server on who is allowed to replay.
 *   - **a half-written form is not thrown away quietly.** The inspection is not
 *     refetched under the officer's typing, leaving the tab warns, and Back
 *     asks first.
 *   - **a round short of its photographs does not reach the wire.**
 *     `minimum_photo_count` is the server's, read from `/api/icms/app-config`,
 *     and the server refuses below it. This screen says the shortfall in
 *     numbers before the press and declines to open the confirmation — the
 *     friendly half of a rule it does not own. It is a PAYLOAD check and never
 *     an authority one: `available_actions` alone decides whether Submit is
 *     drawn, the button is not disabled by a count, and a rule that has not
 *     loaded blocks nothing at all.
 *
 * The one thing the browser is not promised: an in-app navigation away from
 * here — the rail, a link — is not intercepted. `useBlocker` needs a data
 * router and this tree is `<Routes>`; `beforeunload` covers a reload or a
 * closed tab, and Back asks, but the rail does not.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  allows,
  newIdempotencyKey,
  toInspectionStatus,
  type EvidenceOut,
  type InspectionDetail,
} from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { ErrorState, LoadingState } from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
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
import { useLanguage } from "@/i18n";
import {
  useInspectionActionLabels,
  useInspectionGateLabels,
  useInspectionStatusLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { FindingsList, ObservationFields } from "./FindingsFields";
import {
  findingsFormFrom,
  hasErrors,
  isDirty,
  toFindingsBody,
  validateFindingsForm,
  type FindingsFormErrors,
  type FindingsFormState,
} from "./findingsForm";
import { useFindingsLabels, type FindingsLabels } from "./findingsLabels";
import { INSPECTION_STATUS_META } from "./inspectionStatus";
import { usePhotoRule } from "./useAppConfig";
import { useInspectionGate } from "./useInspections";
import {
  ACT_DOMAIN,
  AREA_TYPE_DOMAIN,
  CONSTRUCTION_STAGE_DOMAIN,
  SECTION_DOMAIN,
  isNotFound,
  useFindingsInspection,
  useSaveFindings,
  useSubmitInspection,
  useVocabulary,
} from "./useFindings";

const NO_ERRORS: FindingsFormErrors = {};

// One identity, so the photograph rule is not recomputed on every keystroke
// while the inspection is still loading.
const NO_EVIDENCE: readonly EvidenceOut[] = [];

/** Where a submit refused for want of photographs puts the cursor. */
const SHORTFALL_ID = "submit-photo-shortfall";

// Where a refused save puts the cursor, most specific field first.
function firstProblemId(errors: FindingsFormErrors): string | null {
  if (errors.findings !== undefined) return "findings-item-1";
  if (errors.phone !== undefined) return "occupant-phone";
  if (errors.ownerPhone !== undefined) return "owner-phone";
  if (errors.length !== undefined) return "length-m";
  if (errors.width !== undefined) return "width-m";
  if (errors.area !== undefined) return "measured-area";
  return null;
}

/**
 * A refusal the server made, said in the officer's language.
 *
 * Contract §6 maps every code this batch produces; a code with a sentence of
 * its own gets it, and the server's own message is kept underneath because it
 * names the field at fault. A code with no sentence falls back to that message
 * rather than to a guess. The request id is always shown: it is what ties this
 * failure to the server's own log line.
 */
function RefusalAlert({
  title,
  error,
  labels,
  children,
}: {
  title: string;
  error: IcmsApiError;
  labels: FindingsLabels;
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

export default function InspectionFindings() {
  const { inspectionId } = useParams<{ inspectionId: string }>();
  const inspectionRef = inspectionId ?? "";
  const navigate = useNavigate();
  const { language } = useLanguage();

  const labels = useFindingsLabels();
  const gateLabels = useInspectionGateLabels();
  const actionLabels = useInspectionActionLabels();
  const statusLabels = useInspectionStatusLabels();

  const gate = useInspectionGate();
  const query = useFindingsInspection(inspectionRef, gate.canRead);
  const detail: InspectionDetail | null = query.data ?? null;

  // The round's photographs against the server's minimum. Gates the submit's
  // payload, never whether the button exists — that is `available_actions`.
  const photos = usePhotoRule(detail?.evidence ?? NO_EVIDENCE, gate.canRead);

  const areaTypes = useVocabulary(AREA_TYPE_DOMAIN, gate.canRead, language);
  const constructionStages = useVocabulary(CONSTRUCTION_STAGE_DOMAIN, gate.canRead, language);
  const acts = useVocabulary(ACT_DOMAIN, gate.canRead, language);
  const sections = useVocabulary(SECTION_DOMAIN, gate.canRead, language);

  const [form, setForm] = useState<FindingsFormState | null>(null);
  const [baseline, setBaseline] = useState<FindingsFormState | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsSave, setNeedsSave] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const save = useSaveFindings(inspectionRef);
  const submit = useSubmitInspection(inspectionRef);

  /**
   * The key for ONE submit attempt, held across every retry of it.
   *
   * Cleared only when the server has answered. While it is set, pressing
   * Submit again replays the same intent, which the unique key server-side
   * turns into "here is the round you already submitted".
   */
  const submitKey = useRef<string | null>(null);
  const seededFor = useRef<string | null>(null);

  // Seeded once per reference. A later refetch must not overwrite the officer's
  // typing; a successful write re-seeds it from what the server answered.
  useEffect(() => {
    if (detail === null || seededFor.current === inspectionRef) return;
    seededFor.current = inspectionRef;
    const seeded = findingsFormFrom(detail);
    setForm(seeded);
    setBaseline(seeded);
  }, [detail, inspectionRef]);

  const dirty = form !== null && baseline !== null && isDirty(baseline, form);

  // Covers a reload and a closed tab. An in-app navigation cannot be
  // intercepted without a data router, which is why Back asks separately.
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

  const errors = useMemo(
    () => (form === null ? NO_ERRORS : validateFindingsForm(form)),
    [form],
  );
  // A form is not wrong before it has been used: nothing is marked until a save
  // has actually been refused.
  const shownErrors = attempted ? errors : NO_ERRORS;

  const onChange = useCallback((next: FindingsFormState) => {
    setForm(next);
    setSaved(false);
    setNeedsSave(false);
  }, []);

  const handleSave = useCallback(() => {
    if (form === null) return;
    setAttempted(true);
    setSaved(false);

    const problems = validateFindingsForm(form);
    if (hasErrors(problems)) {
      const id = firstProblemId(problems);
      if (id !== null) document.getElementById(id)?.focus();
      return;
    }

    save.mutate(toFindingsBody(form), {
      onSuccess: (next) => {
        const seeded = findingsFormFrom(next);
        setForm(seeded);
        setBaseline(seeded);
        setAttempted(false);
        setSaved(true);
      },
    });
  }, [form, save]);

  // The round is submitted as it is STORED. Unsaved text on screen is not part
  // of it, and saying so beats submitting something the officer did not mean.
  const askSubmit = useCallback(() => {
    if (dirty) {
      setNeedsSave(true);
      return;
    }
    setNeedsSave(false);
    // The server refuses a round below its minimum. The count is already on
    // screen, so the press moves the officer to it rather than to a 422.
    if (photos.shortfall > 0) {
      document.getElementById(SHORTFALL_ID)?.focus();
      return;
    }
    setConfirming(true);
  }, [dirty, photos.shortfall]);

  const runSubmit = useCallback(() => {
    setConfirming(false);
    submitKey.current ??= newIdempotencyKey();
    submit.mutate(
      { idempotency_key: submitKey.current },
      {
        onSuccess: () => {
          submitKey.current = null;
          // The round is no longer editable here; the detail screen is where
          // its new state, its evidence and the verification live.
          void navigate(ROUTES.inspection(inspectionRef));
        },
      },
    );
  }, [inspectionRef, navigate, submit]);

  const goBack = useCallback(() => {
    if (dirty) {
      setLeaving(true);
      return;
    }
    void navigate(ROUTES.inspection(inspectionRef));
  }, [dirty, inspectionRef, navigate]);

  if (gate.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.loading" spin className="size-4" />
          {gateLabels.checking}
        </span>
      </div>
    );
  }

  // Not a redirect to the login screen: the officer IS signed in, they are
  // simply not allowed here, and a login form they already passed reads as a bug.
  if (!gate.canRead) {
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[40vh] max-w-prose flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
          <Icon name="user.password" className="size-5" />
        </span>
        <h1 className="font-display text-xl font-bold text-balance text-fg-strong">
          {gateLabels.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{gateLabels.deniedBody}</p>
      </section>
    );
  }

  if (query.error) {
    const loadError = query.error instanceof IcmsApiError ? query.error : null;
    const missing = isNotFound(query.error);
    return (
      <ErrorState
        title={missing ? labels.load.notFoundTitle : labels.load.errorTitle}
        description={
          missing ? labels.load.notFoundBody : (loadError?.message ?? labels.load.errorBody)
        }
        // The request id is what ties this failure to the server's own log line.
        detail={loadError?.requestId ?? undefined}
        onRetry={
          missing
            ? undefined
            : () => {
                void query.refetch();
              }
        }
        retryLabel={missing ? undefined : labels.load.retry}
      />
    );
  }

  if (detail === null || form === null) {
    return <LoadingState label={labels.load.loading} lines={6} />;
  }

  const chip = toInspectionStatus(detail.status);
  const canRecord = allows(detail, "record_findings");
  const canSubmit = allows(detail, "submit");
  const busy = save.isPending || submit.isPending;
  const saveError = save.error instanceof IcmsApiError ? save.error : null;
  const submitError = submit.error instanceof IcmsApiError ? submit.error : null;

  return (
    // No gutter and no max-width here: AppShell's `main` supplies both, once,
    // for every screen.
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-fg-canvas-muted">
            {labels.subtitle(detail.inspection_ref, detail.round_no)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* A fact on the header, never an input to a decision. The chip carries
              a glyph as well as a tone, and its label is the status in words. */}
          <StatusChip status={chip === null ? "unknown" : INSPECTION_STATUS_META[chip].chip}>
            {chip === null ? detail.status : statusLabels[chip]}
          </StatusChip>
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
      </header>

      <form
        className="flex min-w-0 flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <FindingsList
          labels={labels}
          state={form}
          onChange={onChange}
          disabled={!canRecord || busy}
          errors={shownErrors}
        />

        <ObservationFields
          labels={labels}
          state={form}
          onChange={onChange}
          disabled={!canRecord || busy}
          errors={shownErrors}
          areaTypes={areaTypes}
          constructionStages={constructionStages}
          acts={acts}
          sections={sections}
        />

        {saveError && (
          <RefusalAlert title={labels.errorTitle} error={saveError} labels={labels} />
        )}

        {submitError && (
          <RefusalAlert title={labels.submitErrorTitle} error={submitError} labels={labels}>
            {/* Retries the ATTEMPT, not the request: `submitKey` still holds
                the key the refused attempt used, so this replays it. A replay
                the server accepts comes back 200 with the round already
                submitted, which is a completed submit and lands in the same
                success path as the first attempt would have. */}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={runSubmit}>
              <Icon name="action.retry" className="size-4" />
              {labels.load.retry}
            </Button>
          </RefusalAlert>
        )}

        <footer className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              {/* Both states are announced, and both are words rather than a
                  colour: "unsaved" and "saved" are what an officer leaving this
                  screen has to know. */}
              {dirty && (
                <p role="status" className="flex items-center gap-2 text-xs text-fg-muted">
                  <Icon name="feedback.warning" className="size-3.5" />
                  {labels.unsaved}
                </p>
              )}
              {saved && !dirty && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-xs text-status-success-fg"
                >
                  <Icon name="feedback.success" className="size-3.5" />
                  {labels.saved}
                </p>
              )}
              {needsSave && (
                <p role="status" className="max-w-prose text-xs text-fg-muted text-pretty">
                  {labels.submitNeedsSave}
                </p>
              )}
              {/* Standing, not only after a refused press: an officer who can
                  see the shortfall before pressing never meets the refusal. */}
              {canSubmit && photos.shortfall > 0 && photos.minimum !== null && (
                <p
                  id={SHORTFALL_ID}
                  tabIndex={-1}
                  role="status"
                  className="max-w-prose text-xs text-status-warning-fg text-pretty"
                >
                  {labels.photos.shortfall(photos.count, photos.minimum)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canRecord && (
                // Deliberately not disabled on an empty list: pressing it is
                // what produces the sentence explaining what is missing.
                <Button type="submit" disabled={busy}>
                  <Icon
                    name={save.isPending ? "feedback.loading" : "action.save"}
                    spin={save.isPending}
                    className="size-4"
                  />
                  {save.isPending ? labels.saving : labels.save}
                </Button>
              )}
              {canSubmit && (
                <Button type="button" variant="secondary" disabled={busy} onClick={askSubmit}>
                  <Icon
                    name={submit.isPending ? "feedback.loading" : "action.send"}
                    spin={submit.isPending}
                    className="size-4"
                  />
                  {submit.isPending
                    ? actionLabels.pending("submit")
                    : actionLabels.label("submit")}
                </Button>
              )}
            </div>
          </div>

          {!canRecord && (
            <p className="max-w-prose text-xs text-fg-muted text-pretty">{labels.readOnly}</p>
          )}
          {!canRecord && !canSubmit && (
            <p className="max-w-prose text-xs text-fg-muted text-pretty">{actionLabels.none}</p>
          )}
          {/* The rule did not arrive, so nothing here blocks anything: the
              officer is told that the server decides it on the request. */}
          {canSubmit && !photos.stated && !photos.loading && (
            <p className="max-w-prose text-2xs text-fg-faint text-pretty">
              {labels.photos.unknown}
            </p>
          )}
          <p className="max-w-prose text-2xs text-fg-faint text-pretty">{actionLabels.advisory}</p>
        </footer>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {labels.submitConfirmTitle(detail.inspection_ref)}
            </AlertDialogTitle>
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
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLeaving(false);
                void navigate(ROUTES.inspection(inspectionRef));
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
