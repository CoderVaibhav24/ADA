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
 *     polygon, point and a suggested type are filled; the reference, the area and the confidence
 *     are shown as the case's origin because `CaseCreate` has no column for
 *     them. Everything else is the officer's to enter, exactly as a manual
 *     complaint would be — which is the normal case, not the fallback.
 *
 * Two tabs, `?mode=detection|manual`, share one form state and one submit: a
 * switch loses nothing typed, and `forMode` decides what each tab files. The
 * detection tab files as the signed-in officer; the manual tab's complainant is
 * typed, because a citizen may be the one complaining.
 *
 * A detection's before/after crops are fetched and pre-added as evidence; a
 * failed fetch says so beside the drop zone and never blocks the submit.
 *
 * Photos are chosen before submit and uploaded only once the case exists, each
 * with its own idempotency key. A failed upload never loses the case: the
 * screen says how many failed and offers a retry and the way to the case.
 *
 * The one thing the browser is not promised: an in-app navigation away from
 * here — the rail, a link — is not intercepted. `useBlocker` needs a data
 * router and this tree is `<Routes>`; `beforeunload` covers a reload or a
 * closed tab, and Back and Cancel ask, but the rail does not.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { newIdempotencyKey, uploadCaseEvidence } from "@/api/icms/cases";
import type { ParcelLookup } from "@/api/icms/geo";
import { IcmsApiError } from "@/api/icms/http";
import { currentUser } from "@/auth/oidc";
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Read-only: the hand-off contract is written down once, in the feature that
// produces it, rather than guessed at twice.
import { parseComplaintHandoff } from "@/features/changeDetection/complaintHandoff";
import { useFormats } from "@/i18n";
import { usePriorityLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { uploadEach } from "./complaintEvidence";
import {
  COMPLAINT_PRIORITIES,
  MORE_DETAIL_FIELDS,
  blankComplaintForm,
  fieldId,
  firstProblem,
  forMode,
  hasLocation,
  hasErrors,
  initialMode,
  isComplaintMode,
  isDirty,
  officerContact,
  requiredFields,
  seedComplaintForm,
  toComplaintBody,
  validateComplaintForm,
  withOfficer,
  type ComplaintField,
  type ComplaintFormErrors,
  type ComplaintFormState,
  type OfficerContact,
} from "./complaintForm";
import {
  ComplainantSection,
  ComplaintTypeField,
  DescriptionAndDate,
  DetectionOriginFields,
  GeographicalDetails,
  MoreDetails,
  OriginPanel,
  PropertySection,
} from "./CreateComplaintFields";
import { EvidencePicker } from "./EvidencePicker";
import { LocationPicker } from "./LocationPicker";
import { useComplaintNewLabels, type ComplaintNewLabels } from "./complaintLabels";
import {
  COMPLAINT_TYPE_DOMAIN,
  useComplaintVocabulary,
  useCreateCase,
  useRaiseGate,
  useZoneOptions,
} from "./useCreateComplaint";
import { useDetectionEvidence } from "./useDetectionEvidence";
import { useLocationSuggestion } from "./useLocationSuggestion";
import {
  applySuggestion,
  suggestedFields,
  withoutSuggestion,
  type LocationSuggestion,
} from "./locationSuggestion";
import {
  applyParcel,
  foreignZone,
  parcelFields,
  parcelIsPlot,
  parcelSuggestionFrom,
  withoutParcel,
  type ParcelSuggestion,
} from "./parcelSuggestion";
import { useEvidenceSelection, type ChosenPhoto } from "./useEvidenceSelection";

const NO_ERRORS: ComplaintFormErrors = {};
// Nothing is read-only by account any more: the detection tab draws its locked block itself.
const NOT_LOCKED: ReadonlySet<ComplaintField> = new Set();

/** The case exists; its photos are uploading, or some of them failed. */
type Filed = {
  caseRef: string;
  phase: "uploading" | "partial";
  done: number;
  total: number;
  failed: readonly string[];
};

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

/** Replaces the form once the case exists and photos are uploading or have partly failed. */
function FiledPanel({
  filed,
  photos,
  labels,
  onRetry,
  onOpen,
}: {
  filed: Filed;
  photos: readonly ChosenPhoto[];
  labels: ComplaintNewLabels;
  onRetry: () => void;
  onOpen: () => void;
}) {
  const failedNames = photos
    .filter((photo) => filed.failed.includes(photo.id))
    .map((photo) => photo.file.name);
  const uploading = filed.phase === "uploading";

  return (
    <section
      aria-labelledby="complaint-filed-title"
      className="flex max-w-3xl flex-col gap-4 rounded-md border border-line-subtle bg-surface-1 p-5 sm:p-7"
    >
      <h2
        id="complaint-filed-title"
        className="flex items-center gap-2 font-display text-lg font-semibold text-fg-strong"
      >
        <Icon name="feedback.success" className="size-5 text-status-success-fg" />
        {labels.filed.title(filed.caseRef)}
      </h2>

      {uploading ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Icon name="feedback.loading" spin className="size-4" />
            {labels.filed.uploading(filed.done, filed.total)}
          </p>
          <Progress
            value={filed.total === 0 ? 0 : (filed.done / filed.total) * 100}
            aria-label={labels.filed.uploading(filed.done, filed.total)}
          />
        </div>
      ) : (
        <Alert role="alert" className="border-status-warning-border">
          <Icon name="feedback.warning" className="size-4" />
          <AlertTitle className="text-pretty">{labels.filed.failed(filed.failed.length)}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span className="text-pretty">{labels.filed.saved}</span>
            {failedNames.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-fg-muted">
                {failedNames.map((name, index) => (
                  <li key={`${name}-${String(index)}`}>{name}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={onOpen}>
                <Icon name="action.forward" className="size-4" />
                {labels.filed.open}
              </Button>
              <Button type="button" variant="outline" onClick={onRetry}>
                <Icon name="action.retry" className="size-4" />
                {labels.filed.retry}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export default function CreateComplaint() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const formats = useFormats();
  const labels = useComplaintNewLabels();
  const priorityLabels = usePriorityLabels();

  const gate = useRaiseGate();
  const create = useCreateCase();

  const handoff = useMemo(() => parseComplaintHandoff(search), [search]);
  const mode = initialMode(params.get("mode"), handoff !== null);
  const selectMode = useCallback(
    (next: string) => {
      if (!isComplaintMode(next)) return;
      // `replace`, not push: flipping tabs must not make Back walk through each one.
      const updated = new URLSearchParams(params);
      updated.set("mode", next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

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
          labels.origin.seedDetail(handoff.detectionRef, handoff.status, area, confidence),
        ),
  );

  const [form, setForm] = useState<ComplaintFormState>(baseline);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [officer, setOfficer] = useState<OfficerContact | null>(null);
  const [located, setLocated] = useState<LocationSuggestion | null>(null);
  const [landRecord, setLandRecord] = useState<ParcelLookup | null>(null);
  const [parcelled, setParcelled] = useState<ParcelSuggestion | null>(null);

  // The signed-in officer: the detection tab's complainant, and the manual
  // tab's "Use my details". Never written into the state, so the manual tab
  // starts blank and nothing here makes the form "unsaved".
  useEffect(() => {
    let live = true;
    void currentUser().then((user) => {
      if (live) setOfficer(officerContact(user?.profile));
    });
    return () => {
      live = false;
    };
  }, []);
  // The chip the detection chose, until the officer picks another or clears it.
  const suggested =
    mode === "detection" &&
    handoff !== null &&
    baseline.complaintTypeCd !== "" &&
    form.complaintTypeCd === baseline.complaintTypeCd;
  const photos = useEvidenceSelection();
  const addPhotos = photos.add;
  const addDetectionPhotos = useCallback(
    (files: File[]) => {
      addPhotos(files, "detection");
    },
    [addPhotos],
  );
  const detectionEvidence = useDetectionEvidence(handoff, addDetectionPhotos);
  // The detection's crops belong to the detection tab; a manual complaint files only the officer's.
  const submittedPhotos = useMemo(
    () =>
      mode === "detection"
        ? photos.items
        : photos.items.filter((photo) => photo.origin === "officer"),
    [mode, photos.items],
  );

  // A focus request for a field inside "More details", served once it has opened.
  const pendingFocus = useRef<ComplaintField | null>(null);
  useEffect(() => {
    if (!moreOpen || pendingFocus.current === null) return;
    document.getElementById(fieldId(pendingFocus.current))?.focus();
    pendingFocus.current = null;
  }, [moreOpen]);

  // Uploads outlive a navigation away; they must not navigate a screen that is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
  const zones = useZoneOptions(gate.canRaise, language);
  // The zones this officer can file in; null while that is not known yet.
  const assignable = useMemo(
    () =>
      zones.loading || zones.unavailable
        ? null
        : new Set(zones.options.map((option) => option.value)),
    [zones],
  );

  // The pin — a hand-off's on mount, or a map click — suggests state, district, LGD code and pin
  // code from the locator, and zone, village, khasra and ULPIN from the imported land record.
  const lastLocated = useRef<LocationSuggestion | null>(null);
  const lastParcel = useRef<ParcelSuggestion | null>(null);
  const takeParcel = (answer: ParcelLookup) => {
    const next = parcelSuggestionFrom(answer, assignable);
    const previous = lastParcel.current;
    lastParcel.current = next;
    setForm((current) => applyParcel(current, previous, next));
    setParcelled(next);
    setLandRecord(answer);
  };
  useLocationSuggestion(
    form.latitude,
    form.longitude,
    gate.canRaise,
    (next) => {
      const previous = lastLocated.current;
      lastLocated.current = next;
      setForm((current) => applySuggestion(current, previous, next));
      setLocated(next);
    },
    takeParcel,
  );
  // The zone list can answer after the land record did; its zone is suggested then.
  const retakeParcel = useEffectEvent(() => {
    if (landRecord !== null) takeParcel(landRecord);
  });
  useEffect(() => {
    retakeParcel();
  }, [assignable]);
  const fromLocation = useMemo(() => suggestedFields(form, located), [form, located]);
  const fromLandRecord = useMemo(() => parcelFields(form, parcelled), [form, parcelled]);
  const fromPlotNo = parcelIsPlot(form, parcelled);
  const pinZone = hasLocation(form) ? foreignZone(landRecord, assignable) : null;
  const zoneNote =
    pinZone === null
      ? undefined
      : labels.location.foreignZone(
          pinZone.name === "" ? pinZone.code : `${pinZone.name} (${pinZone.code})`,
        );

  const priorities = useMemo(
    () => COMPLAINT_PRIORITIES.map((value) => ({ value, label: priorityLabels[value] })),
    [priorityLabels],
  );

  // The detection's own crops arrive unasked, so only the officer's photos count.
  // A location suggestion arrives unasked too, until the officer edits it.
  const dirty =
    isDirty(baseline, withoutParcel(withoutSuggestion(form, located, baseline), parcelled, baseline)) ||
    photos.items.some((photo) => photo.origin === "officer");
  // Once the case exists, only an upload still in flight is worth a warning.
  const guarded = filed === null ? dirty : filed.phase === "uploading";

  // Covers a reload and a closed tab. An in-app navigation cannot be
  // intercepted without a data router, which is why Back and Cancel ask
  // separately.
  useEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [guarded]);

  // What the open tab would file; validation and the body both read this.
  const filing = useMemo(() => forMode(form, mode, officer), [form, mode, officer]);
  const errors = useMemo(() => validateComplaintForm(filing), [filing]);
  const requiredSet = useMemo(() => requiredFields(filing), [filing]);
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
    const problems = validateComplaintForm(filing);
    if (hasErrors(problems)) {
      const field = firstProblem(problems, mode);
      if (field !== null && MORE_DETAIL_FIELDS.includes(field) && !moreOpen) {
        pendingFocus.current = field;
        setMoreOpen(true);
      } else if (field !== null) {
        document.getElementById(fieldId(field))?.focus();
      }
      return;
    }
    setConfirming(true);
  }, [filing, mode, moreOpen]);

  // Never throws and never blocks: the case already exists when this runs.
  const uploadPhotos = useCallback(
    async (caseRef: string, items: readonly ChosenPhoto[]) => {
      setFiled({ caseRef, phase: "uploading", done: 0, total: items.length, failed: [] });
      const outcome = await uploadEach(
        items,
        (item) => uploadCaseEvidence(caseRef, item.file, { idempotencyKey: item.id }),
        (done, total) => {
          if (mounted.current) {
            setFiled((current) => (current === null ? current : { ...current, done, total }));
          }
        },
      );
      if (!mounted.current) return;
      if (outcome.failed.length === 0) {
        void navigate(ROUTES.complaint(caseRef));
        return;
      }
      setFiled({
        caseRef,
        phase: "partial",
        done: items.length,
        total: items.length,
        failed: outcome.failed,
      });
    },
    [navigate],
  );

  const runSubmit = useCallback(() => {
    setConfirming(false);
    submitKey.current ??= newIdempotencyKey();
    create.mutate(toComplaintBody(filing, submitKey.current), {
      onSuccess: (detail) => {
        submitKey.current = null;
        // The case exists now; its detail screen is where the assignment and
        // everything after it lives. Photos go first, when there are any.
        if (submittedPhotos.length === 0) {
          void navigate(ROUTES.complaint(detail.case_ref));
          return;
        }
        void uploadPhotos(detail.case_ref, submittedPhotos);
      },
    });
  }, [create, filing, navigate, submittedPhotos, uploadPhotos]);

  const goBack = useCallback(() => {
    if (filed === null && dirty) {
      setLeaving(true);
      return;
    }
    void navigate(ROUTES.complaints);
  }, [dirty, filed, navigate]);

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
        <p className="text-sm text-fg-canvas-muted text-pretty">{labels.gate.deniedBody}</p>
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
  const fields = {
    labels,
    state: form,
    onChange,
    disabled: busy,
    errors: shownErrors,
    requiredSet,
    locked: NOT_LOCKED,
    fromLocation,
    fromLandRecord,
    fromPlotNo,
  };
  // The detection tab opened by hand, with nothing handed over to raise it from.
  const noHandoff = mode === "detection" && handoff === null;
  const copyMine =
    officer !== null && (officer.name !== "" || officer.email !== "")
      ? () => {
          setForm((current) => withOfficer(current, officer));
        }
      : undefined;

  return (
    // No gutter and no max-width here: AppShell's `main` supplies both, once,
    // for every screen.
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-fg-canvas-muted text-pretty">{labels.subtitle}</p>
        </div>
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
      </header>

      {handoff !== null && filed === null && mode === "detection" && (
        <OriginPanel
          labels={labels}
          detectionRef={handoff.detectionRef}
          area={area}
          confidence={confidence}
          status={handoff.status}
        />
      )}

      {filed !== null ? (
        <FiledPanel
          filed={filed}
          photos={submittedPhotos}
          labels={labels}
          onOpen={() => {
            void navigate(ROUTES.complaint(filed.caseRef));
          }}
          onRetry={() => {
            void uploadPhotos(
              filed.caseRef,
              submittedPhotos.filter((photo) => filed.failed.includes(photo.id)),
            );
          }}
        />
      ) : (
        <form
          className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            askSubmit();
          }}
        >
          <div className="flex min-w-0 flex-col gap-4 rounded-md border border-line-subtle bg-surface-1 p-4 sm:p-7">
            <Tabs value={mode} onValueChange={selectMode} className="min-w-0 gap-4">
              <TabsList aria-label={labels.mode.label} className="max-w-full">
                <TabsTrigger value="detection" disabled={handoff === null}>
                  <Icon name="nav.changeDetection" className="size-4" />
                  {labels.mode.detection}
                </TabsTrigger>
                <TabsTrigger value="manual">
                  <Icon name="nav.createComplaint" className="size-4" />
                  {labels.mode.manual}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detection" className="flex min-w-0 flex-col gap-4">
                {noHandoff ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
                    <Icon name="feedback.info" className="size-4" />
                    {labels.mode.noHandoff}
                  </p>
                ) : (
                  <>
                    <DetectionOriginFields labels={labels} state={filing} />
                    <ComplaintTypeField {...fields} types={types} suggested={suggested} />
                    <DescriptionAndDate {...fields} priorities={priorities} />
                    <PropertySection {...fields} mode="detection" />
                  </>
                )}
              </TabsContent>

              <TabsContent value="manual" className="flex min-w-0 flex-col gap-4">
                <ComplainantSection {...fields} onUseMine={copyMine} />
                <PropertySection {...fields} mode="manual" />
                <ComplaintTypeField {...fields} types={types} suggested={false} />
                <DescriptionAndDate {...fields} priorities={priorities} />
              </TabsContent>
            </Tabs>

            {!noHandoff && (
              <>
                <MoreDetails {...fields} open={moreOpen} onOpenChange={setMoreOpen} />
                <EvidencePicker
                  labels={labels}
                  items={submittedPhotos}
                  rejected={photos.rejected}
                  disabled={busy}
                  detection={mode === "detection" ? detectionEvidence : "idle"}
                  onAdd={photos.add}
                  onRemove={photos.remove}
                />
              </>
            )}

            {failure && (
              <RefusalAlert title={labels.errorTitle} error={failure} labels={labels}>
                {/* Retries the ATTEMPT, not the request: `submitKey` still holds the
                    key the refused attempt used, so this replays it. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={runSubmit}
                >
                  <Icon name="action.retry" className="size-4" />
                  {labels.retry}
                </Button>
              </RefusalAlert>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-3 pt-2">
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

              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || noHandoff} className="h-11 px-4">
                  <Icon
                    name={busy ? "feedback.loading" : "feedback.success"}
                    spin={busy}
                    className="size-4"
                  />
                  {busy ? labels.submitting : labels.submit}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={goBack}
                  className="h-11"
                >
                  {labels.cancel}
                </Button>
              </div>
            </footer>
          </div>

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
            <LocationPicker
              labels={labels}
              latitude={form.latitude}
              longitude={form.longitude}
              disabled={busy}
              onPick={(latitude, longitude) => {
                setForm((current) => ({ ...current, latitude, longitude }));
              }}
            />
            <GeographicalDetails {...fields} zones={zones} zoneNote={zoneNote} />
          </aside>
        </form>
      )}

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
