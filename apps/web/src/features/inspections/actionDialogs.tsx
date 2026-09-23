/**
 * The four write dialogs the Inspection detail screen opens.
 *
 * None of them decides whether it may be opened. The action bar draws a button
 * only when the server put its code in `available_actions`, and the server
 * decides again when the request arrives; a dialog that re-derived permission
 * from `status` would be a third opinion nobody asked for.
 *
 * ## The idempotency key is minted when the dialog opens
 *
 * Contract §4.3: `icms_check_in.idempotency_key` and
 * `icms_evidence.idempotency_key` are unique, and a replayed key returns the
 * ORIGINAL row with 200 rather than a duplicate. That is what makes "press
 * Upload again" safe on a field connection — but only if the second press
 * carries the same key. Minting inside the submit handler would produce a fresh
 * key per attempt and turn one retried photograph into two evidence rows, with
 * nothing on screen to show it happened. So the key belongs to the INTENT: one
 * per opening of the dialog, reused until it succeeds or the officer closes it.
 *
 * ## A desk upload has no fix, and a photograph cannot be uploaded without one
 *
 * `EvidenceCreate` carries an optional position and this screen sends none: the
 * browser on an officer's desk is not where the photograph was taken, and
 * inventing that coordinate is precisely the lie contract §4.1 exists to
 * prevent. For every kind but one the server stores such a file FLAGGED, which
 * is correct and visible in the gallery.
 *
 * A photograph is the exception. Contract amendment 7: `icms_evidence_geotag_ck`
 * refuses a photograph with any capture field missing, so it comes back 422
 * `geotag_required` with `allowed` naming the fields — it is never stored
 * flagged, because it is never stored. The dialog says that when `photo` is
 * chosen rather than after a 5 MB upload has been refused, and the refusal
 * itself reads the missing field names out (see `WriteOutcome`).
 *
 * The button is NOT disabled on that notice. The rule is the server's, the
 * portal's copy of it can go stale, and an officer told plainly why something
 * will fail is better served than one holding a dead control.
 *
 * ## A full round is the one refusal this dialog makes itself
 *
 * `maximum_photo_count` arrives from `/api/icms/app-config`, and a round at it
 * cannot take another photograph — evidence is append-only, so there is no
 * removing one to make room. That is a payload rule, never an authority one:
 * `available_actions` still decides whether `add_evidence` is offered at all,
 * and this dialog only declines to send a file the server would refuse. The
 * sentence is on screen before the press, the press moves the focus to it, and
 * a rule that has not loaded refuses nothing — the server judges instead.
 */

import { useEffect, useId, useState } from "react";
import {
  EVIDENCE_KINDS,
  newIdempotencyKey,
  type CheckInCreate,
  type EvidenceCreate,
  type ResurveyCreate,
  type VerifyDecision,
  type VerifyRequest,
} from "@/api/icms/inspections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useEvidenceKindLabels,
  useInspectionActionLabels,
  useInspectionEvidenceLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import type { InspectionDetailLabels } from "./detailLabels";
import { WriteOutcome } from "./detailParts";
import { usePhotoRuleLabels } from "./photoRuleLabels";
import type { PhotoRuleState } from "./useAppConfig";

/* ---- check-in ------------------------------------------------------------ */

type Fix = { lat: number; lon: number; accuracyM: number; at: string };
type FixState =
  | { phase: "locating"; fix: null }
  | { phase: "ready"; fix: Fix }
  | { phase: "denied"; fix: null }
  | { phase: "unavailable"; fix: null };

const LOCATING: FixState = { phase: "locating", fix: null };
const UNAVAILABLE: FixState = { phase: "unavailable", fix: null };

// Whether this browser can report a position at all is a fact about the
// browser, not a thing to discover in an effect: it is the same answer on every
// render, so it is the initial state rather than a second one.
function geolocationOf(): Geolocation | null {
  if (typeof navigator === "undefined") return null;
  return navigator.geolocation ?? null;
}

/**
 * The browser's position, asked for once when the dialog mounts.
 *
 * The dialog is mounted on demand rather than kept open={false} in the tree, so
 * "each time it opens" and "each time this runs" are the same moment and no
 * effect has to reset anything.
 *
 * `enableHighAccuracy` because the server measures the answer against a
 * threshold in metres and refuses a poor one outright (§4.1) — a cached
 * network-derived fix would be refused for being exactly what it is.
 */
function useFix(): FixState {
  const [state, setState] = useState<FixState>(() =>
    geolocationOf() === null ? UNAVAILABLE : LOCATING,
  );

  useEffect(() => {
    const geolocation = geolocationOf();
    if (geolocation === null) return;

    let live = true;
    geolocation.getCurrentPosition(
      (position) => {
        if (!live) return;
        setState({
          phase: "ready",
          fix: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            at: new Date(position.timestamp).toISOString(),
          },
        });
      },
      (error) => {
        if (!live) return;
        setState({
          phase: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
          fix: null,
        });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );

    return () => {
      live = false;
    };
  }, []);

  return state;
}

export function CheckInDialog({
  open,
  onOpenChange,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: InspectionDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: CheckInCreate) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const fix = useFix();
  // One key per opening of the dialog — see the note at the top of this file.
  // A lazy initialiser rather than an effect: the dialog is mounted when it
  // opens, so this runs exactly once per intent and survives every retry.
  const [key] = useState(newIdempotencyKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.checkIn.title}</DialogTitle>
          <DialogDescription className="text-pretty">{labels.checkIn.body}</DialogDescription>
        </DialogHeader>

        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          {fix.phase === "locating" && (
            <span className="flex items-center gap-2 text-fg-muted">
              <Icon name="feedback.loading" spin className="size-4" />
              {labels.checkIn.locating}
            </span>
          )}
          {fix.phase === "ready" && (
            <span className="flex items-center gap-2 text-fg-strong">
              <Icon name="map.target" className="size-4 text-status-success-fg" />
              <span className="tabular">{labels.checkIn.accuracy(fix.fix.accuracyM)}</span>
            </span>
          )}
          {fix.phase === "denied" && (
            <span className="text-pretty text-status-danger-fg">{labels.checkIn.denied}</span>
          )}
          {fix.phase === "unavailable" && (
            <span className="text-pretty text-status-danger-fg">
              {labels.checkIn.unavailable}
            </span>
          )}
        </div>

        <WriteOutcome error={error} saved={false} labels={labels} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {labels.checkIn.cancel}
          </Button>
          <Button
            disabled={fix.phase !== "ready" || pending}
            onClick={() => {
              if (fix.phase !== "ready") return;
              onSubmit({
                latitude: fix.fix.lat,
                longitude: fix.fix.lon,
                accuracy_m: fix.fix.accuracyM,
                device_timestamp: fix.fix.at,
                // What `navigator.geolocation` actually is: the platform's own
                // blend of GNSS, wifi and cell. Not "gps".
                capture_source: "fused",
                idempotency_key: key,
              });
            }}
          >
            {pending && <Icon name="feedback.loading" spin className="size-4" />}
            {pending ? actionLabels.pending("check_in") : actionLabels.label("check_in")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- evidence ------------------------------------------------------------ */

export function EvidenceUploadDialog({
  open,
  onOpenChange,
  labels,
  photos,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: InspectionDetailLabels;
  /** The round's photographs against the server's published bounds. */
  photos: PhotoRuleState;
  pending: boolean;
  error: unknown;
  onSubmit: (input: EvidenceCreate) => void;
}) {
  const evidenceLabels = useInspectionEvidenceLabels();
  const kindLabels = useEvidenceKindLabels();
  const actionLabels = useInspectionActionLabels();
  const photoLabels = usePhotoRuleLabels();
  const fileId = useId();
  const kindId = useId();
  const docTypeId = useId();
  const ceilingId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>(EVIDENCE_KINDS[0]);
  const [docType, setDocType] = useState("");
  const [key] = useState(newIdempotencyKey);

  // `GEOTAGGED_KINDS` is `{"photo"}` server-side. One kind, named once.
  const photo = kind === "photo";
  // Only a photograph is bounded, and only when the server has said by how
  // much: an unpublished ceiling is not a ceiling this dialog may enforce.
  const full = photo && photos.atCeiling && photos.maximum !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{evidenceLabels.add}</DialogTitle>
          {/* Said before the upload rather than after it. Which sentence
              depends on the kind: a photograph is refused outright, everything
              else is kept and flagged. */}
          <DialogDescription className="text-pretty">
            {photo ? labels.upload.photoNotice : evidenceLabels.flaggedReason}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fileId}>{evidenceLabels.fileLabel}</Label>
            <Input
              id={fileId}
              type="file"
              required
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={kindId}>{evidenceLabels.kindLabel}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id={kindId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {kindLabels[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {photo && (
            <p
              role="status"
              className="rounded-md border border-status-warning-border bg-status-warning px-3 py-2 text-2xs text-status-warning-fg text-pretty"
            >
              {labels.upload.photoNotice}
            </p>
          )}

          {/* Said before a file is chosen, not after a 5 MB upload comes back
              refused. Focusable, because pressing Upload lands the officer
              here rather than doing nothing. */}
          {full && photos.maximum !== null && (
            <p
              id={ceilingId}
              tabIndex={-1}
              role="alert"
              className="rounded-md border border-status-danger-border bg-status-danger px-3 py-2 text-2xs text-status-danger-fg text-pretty"
            >
              {photoLabels.ceilingBlocked(photos.maximum)}
            </p>
          )}

          {photo && !photos.stated && !photos.loading && (
            <p className="text-2xs text-fg-faint text-pretty">{photoLabels.uploadUnknown}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={docTypeId}>{evidenceLabels.docTypeLabel}</Label>
            <Input
              id={docTypeId}
              value={docType}
              onChange={(event) => {
                setDocType(event.target.value);
              }}
            />
          </div>
        </div>

        <WriteOutcome error={error} saved={false} labels={labels} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {labels.cancel}
          </Button>
          <Button
            // Not disabled on a full round: the reason is beside the button and
            // the press takes the officer to it. A dead control teaches nothing.
            aria-describedby={full ? ceilingId : undefined}
            disabled={file === null || pending}
            onClick={() => {
              if (file === null) return;
              if (full) {
                document.getElementById(ceilingId)?.focus();
                return;
              }
              onSubmit({
                file,
                kind,
                idempotency_key: key,
                doc_type_cd: docType.trim() === "" ? undefined : docType.trim(),
                capture_source: "upload",
              });
            }}
          >
            {pending && <Icon name="feedback.loading" spin className="size-4" />}
            {pending ? evidenceLabels.adding : actionLabels.label("add_evidence")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- verify -------------------------------------------------------------- */

export function VerifyDialog({
  open,
  onOpenChange,
  decision,
  inspectionRef,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decision: VerifyDecision;
  inspectionRef: string;
  labels: InspectionDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: VerifyRequest) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const rejecting = decision === "reject";
  const missing = rejecting && reason.trim() === "";
  const actionCd = rejecting ? "verify_reject" : "verify_accept";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {rejecting
              ? labels.verify.confirmRejectTitle(inspectionRef)
              : labels.verify.confirmAcceptTitle(inspectionRef)}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {rejecting ? labels.verify.confirmRejectBody : labels.verify.confirmAcceptBody}
          </DialogDescription>
        </DialogHeader>

        {/* Only the rejection takes a reason, and the server requires it too —
            the surveyor reads it before the next round starts. */}
        {rejecting && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>{labels.verify.reasonLabel}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              rows={3}
              aria-describedby={`${reasonId}-hint`}
              aria-invalid={touched && missing}
              onBlur={() => {
                setTouched(true);
              }}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p id={`${reasonId}-hint`} className="text-2xs text-fg-muted text-pretty">
              {touched && missing ? labels.verify.reasonRequired : labels.verify.reasonHint}
            </p>
          </div>
        )}

        <WriteOutcome error={error} saved={false} labels={labels} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {labels.verify.cancel}
          </Button>
          <Button
            variant={rejecting ? "destructive" : "default"}
            disabled={missing || pending}
            onClick={() => {
              onSubmit({ decision, reason: rejecting ? reason.trim() : null });
            }}
          >
            {pending && <Icon name="feedback.loading" spin className="size-4" />}
            {pending ? actionLabels.pending(actionCd) : actionLabels.label(actionCd)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- request a re-survey -------------------------------------------------- */

export function ResurveyRequestDialog({
  open,
  onOpenChange,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: InspectionDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: ResurveyCreate) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const missing = reason.trim() === "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.resurvey.title}</DialogTitle>
          <DialogDescription className="text-pretty">{labels.rounds.body}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={reasonId}>{labels.resurvey.reasonLabel}</Label>
          <Textarea
            id={reasonId}
            value={reason}
            rows={3}
            aria-invalid={touched && missing}
            aria-describedby={touched && missing ? `${reasonId}-error` : undefined}
            onBlur={() => {
              setTouched(true);
            }}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          {touched && missing && (
            <p id={`${reasonId}-error`} className="text-2xs text-status-danger-fg">
              {labels.resurvey.reasonRequired}
            </p>
          )}
        </div>

        <WriteOutcome error={error} saved={false} labels={labels} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {labels.resurvey.cancel}
          </Button>
          <Button
            disabled={missing || pending}
            onClick={() => {
              onSubmit({ reason: reason.trim() });
            }}
          >
            {pending && <Icon name="feedback.loading" spin className="size-4" />}
            {pending
              ? actionLabels.pending("request_resurvey")
              : actionLabels.label("request_resurvey")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
