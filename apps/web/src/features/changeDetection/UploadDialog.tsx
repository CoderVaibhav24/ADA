/**
 * Upload a drone GeoTIFF into the current project in resumable chunks.
 *
 * `uploadRaster` reports bytes the server holds. Once the session completes,
 * the dialog follows the new flight through ingest from the store, which
 * useChangeDetection polls every 2 s while any flight is processing.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  ApiError,
  abortUpload,
  listOpenUploads,
  resumeUpload,
  uploadRaster,
  type RasterUploadFields,
} from "@/api/client";
import type { Id, Raster } from "@/api/types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Progress } from "@/components/ui/progress";
import { cn } from "cn";

import { Icon } from "@/lib/icons";
import { useStore } from "@/state/store";

import { matchesFingerprint } from "@/upload/fingerprint";
import {
  UploadAbortedError,
  UploadCompletionTimeoutError,
  UploadPausedError,
  type OpenUpload,
  type UploadProgress,
} from "@/upload/types";
import type { ChunkedUpload } from "@/upload/worker";

import type { ChangeDetectionLabels } from "./labels";
import { flightChip, progressPercent, receivedPercent, restoreHours, sid } from "./model";
import { Failure } from "./parts";
import { useBeforeUnload, type LoadFailure } from "./useChangeDetection";
import type { UploadInFlight } from "./useLayerTree";

type UploadFailure = LoadFailure & { existingId?: string };

// 409 carries the duplicate's id, a 422 naming raster_id the rejection reason; 507 and 413 get plain words.
function describeFailure(
  cause: unknown,
  labels: ChangeDetectionLabels,
  resuming = false,
): UploadFailure {
  if (cause instanceof UploadCompletionTimeoutError) {
    return { message: labels.upload.completionTimeout, requestId: null };
  }
  if (cause instanceof ApiError) {
    const body = (cause.body ?? {}) as {
      existing_raster_id?: unknown;
      detail?: unknown;
      raster_id?: unknown;
    };
    const requestId = cause.requestId;
    if (resuming && cause.status === 404) return { message: labels.upload.expired, requestId };
    if (cause.status === 409 && body.existing_raster_id !== undefined && body.existing_raster_id !== null) {
      return { message: labels.upload.duplicate, requestId, existingId: String(body.existing_raster_id) };
    }
    if (cause.status === 422 && body.raster_id !== undefined) {
      const reason = typeof body.detail === "string" ? body.detail : cause.message;
      return { message: labels.upload.rejected(reason), requestId };
    }
    if (cause.status === 507) return { message: labels.upload.diskFull, requestId };
    if (cause.status === 413) return { message: labels.upload.tooLarge, requestId };
    return { message: cause.message || labels.upload.failed, requestId };
  }
  return {
    message: cause instanceof Error && cause.message ? cause.message : labels.upload.failed,
    requestId: null,
  };
}

// Strip a trailing .tif/.tiff so the filename reads as a default name.
function nameFromFile(file: File): string {
  return file.name.replace(/\.tiff?$/i, "");
}

// Local-time ISO date; `toISOString()` alone shifts the day across timezones.
function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Parses a `YYYY-MM-DD` string as a local-time Date, or undefined if blank/invalid.
function fromIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

// Figma writes the date as 07-09-2026: day, month, year.
function formatDayMonthYear(value: Date): string {
  return toIsoDate(value).split("-").reverse().join("-");
}

export function UploadDialog({
  labels,
  projectId,
  open,
  onOpenChange,
  onTransfer,
  onUploaded,
  onUseExisting,
  onDelete,
  pollFailed,
}: {
  labels: ChangeDetectionLabels;
  projectId: Id;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The transfer as it happens, for the Drone imagery row; null once it ends. */
  onTransfer: (upload: UploadInFlight | null) => void;
  onUploaded: (raster: Raster) => void;
  /** The 409 duplicate's "Use existing": select that flight instead of uploading again. */
  onUseExisting?: (rasterId: string) => void;
  /** Absent without imagery.write. */
  onDelete?: (raster: { id: string; name: string; processing: boolean }) => void;
  pollFailed: boolean;
}) {
  const ids = useId();
  const fileId = `${ids}-file`;
  const nameId = `${ids}-name`;
  const dateId = `${ids}-date`;
  const epsgId = `${ids}-epsg`;
  const epsgHintId = `${ids}-epsg-hint`;
  const tfwId = `${ids}-tfw`;
  const prjId = `${ids}-prj`;

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [crsEpsg, setCrsEpsg] = useState("");
  const [tfw, setTfw] = useState<File | null>(null);
  const [prj, setPrj] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<UploadFailure | null>(null);
  // File inputs cannot be cleared through state; remounting the form does it.
  const [formKey, setFormKey] = useState(0);
  /** Set once the POST returns: the dialog then follows this flight's ingest. */
  const [sent, setSent] = useState<{ id: string; name: string } | null>(null);
  const [openUploads, setOpenUploads] = useState<OpenUpload[]>([]);
  const [resumeNote, setResumeNote] = useState<{ id: string; message: string } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  /** The session whose Discard is awaiting confirmation; "current" is the running transfer. */
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  /** The open session a 409 pointed at, outlined so the officer resumes it rather than starting again. */
  const [highlight, setHighlight] = useState<string | null>(null);
  const transfer = useRef<ChunkedUpload | null>(null);
  const live = useStore((s) =>
    sent ? (s.rasters.find((r) => sid(r.id) === sent.id) ?? null) : null,
  );

  useBeforeUnload(busy);

  // Leaving the screen pauses the transfer and keeps the session, so the banner can resume it later.
  useEffect(() => {
    const running = transfer;
    return () => {
      running.current?.pause();
    };
  }, []);

  // Sessions a reload or a closed tab left behind; an older API without the route simply shows none.
  useEffect(() => {
    if (!open || busy) return;
    let current = true;
    listOpenUploads(projectId)
      .then((list) => {
        if (current) setOpenUploads(list);
      })
      .catch(() => {
        if (current) setOpenUploads([]);
      });
    return () => {
      current = false;
    };
  }, [open, busy, projectId]);

  const reset = () => {
    setFile(null);
    setName("");
    setCapturedAt("");
    setCrsEpsg("");
    setTfw(null);
    setPrj(null);
    setProgress(0);
    setPaused(false);
    setError(null);
    setResumeNote(null);
    setConfirmDiscard(null);
    setHighlight(null);
    setFormKey((n) => n + 1);
    setSent(null);
  };

  const close = () => {
    if (sent) reset();
    onOpenChange(false);
  };

  const run = async (
    flightName: string,
    resuming: boolean,
    send: (
      onProgress: (fraction: number, detail: UploadProgress) => void,
      onStart: (upload: ChunkedUpload) => void,
    ) => Promise<Raster>,
  ) => {
    setBusy(true);
    setError(null);
    setResumeNote(null);
    setProgress(0);
    setPaused(false);
    onTransfer({ name: flightName, fraction: 0 });
    try {
      const raster = await send(
        (fraction, detail) => {
          const uploadId = transfer.current?.uploadId ?? null;
          setProgress(fraction);
          setPaused(detail.paused);
          onTransfer({
            name: flightName,
            fraction,
            uploadId: uploadId === null ? null : String(uploadId),
            paused: detail.paused,
          });
        },
        (upload) => {
          transfer.current = upload;
        },
      );
      onUploaded(raster);
      onTransfer(null);
      setSent({ id: sid(raster.id), name: raster.name });
    } catch (cause: unknown) {
      onTransfer(null);
      const stopped = cause instanceof UploadAbortedError || cause instanceof UploadPausedError;
      if (!stopped) setError(describeFailure(cause, labels, resuming));
    } finally {
      transfer.current = null;
      setConfirmDiscard(null);
      setBusy(false);
      setPaused(false);
    }
  };

  const fields = (picked: File, flightName: string): RasterUploadFields => ({
    name: flightName,
    capturedAt: capturedAt || undefined,
    crsEpsg: crsEpsg.trim() || undefined,
    file: picked,
    tfw,
    prj,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || file === null || name.trim() === "") return;
    const flightName = name.trim();
    const picked = file;
    await run(flightName, false, (onProgress, onStart) =>
      uploadRaster(projectId, fields(picked, flightName), onProgress, { onStart }),
    );
  };

  // The officer re-picks the file; only a fingerprint match may continue the old session.
  const resumeWith = async (session: OpenUpload, picked: File) => {
    const id = String(session.upload_id);
    setChecking(id);
    setResumeNote(null);
    let same = false;
    try {
      same = await matchesFingerprint(picked, session.fingerprint);
    } finally {
      setChecking(null);
    }
    if (!same) {
      setResumeNote({ id, message: labels.upload.mismatch(session.name) });
      return;
    }
    setOpenUploads((list) => list.filter((u) => String(u.upload_id) !== id));
    setHighlight(null);
    await run(session.name, true, (onProgress, onStart) =>
      resumeUpload(projectId, session, fields(picked, session.name), onProgress, { onStart }),
    );
  };

  const discard = async (session: OpenUpload) => {
    const id = String(session.upload_id);
    setConfirmDiscard(null);
    setOpenUploads((list) => list.filter((u) => String(u.upload_id) !== id));
    try {
      await abortUpload(session.upload_id, projectId);
    } catch (cause: unknown) {
      setError(describeFailure(cause, labels));
    }
  };

  const pause = () => {
    transfer.current?.pause();
  };

  const discardCurrent = () => {
    setConfirmDiscard(null);
    void transfer.current?.abort();
  };

  // A duplicate still uploading is resumed from its banner; anything else is handed to the screen to select.
  const pickExisting = (existing: string) => {
    const inStore = useStore.getState().rasters.find((r) => sid(r.id) === existing);
    const uploading =
      inStore?.status === "uploading" ||
      openUploads.some((u) => String(u.upload_id) === existing);
    if (uploading) {
      setError(null);
      setHighlight(existing);
      void listOpenUploads(projectId)
        .then(setOpenUploads)
        .catch(() => undefined);
      return;
    }
    reset();
    onOpenChange(false);
    onUseExisting?.(existing);
  };

  const confirmTarget = (target: string) => {
    if (target === "current") {
      discardCurrent();
      return;
    }
    const session = openUploads.find((u) => String(u.upload_id) === target);
    if (session) void discard(session);
  };

  const confirmRow = (target: string) => (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-status-danger-border bg-status-danger p-3">
      <p className="text-2xs text-pretty text-fg-muted">{labels.upload.discardConfirm}</p>
      <div className="flex gap-2">
        <Button type="button" variant="destructive" size="xs" onClick={() => confirmTarget(target)}>
          {labels.upload.discardYes}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setConfirmDiscard(null)}>
          {labels.upload.keep}
        </Button>
      </div>
    </div>
  );

  const percent = Math.round(progress * 100);

  return (
    <Dialog
      open={open}
      // Closable mid-transfer: the upload lives in this still-mounted component and the Drone imagery row keeps showing it.
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <ServerProgress
            labels={labels}
            name={sent.name}
            raster={live}
            pollFailed={pollFailed}
            onClose={close}
            onDelete={
              onDelete
                ? () => {
                    const target = {
                      id: sent.id,
                      name: sent.name,
                      processing: live?.status === "processing",
                    };
                    close();
                    onDelete(target);
                  }
                : undefined
            }
          />
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>{labels.upload.title}</DialogTitle>
          <DialogDescription className="text-pretty">
            {labels.upload.description}
          </DialogDescription>
        </DialogHeader>

        {!busy &&
          openUploads.map((session) => {
            const id = String(session.upload_id);
            const pct = String(receivedPercent(session.received.length, session.chunk_count));
            const inputId = `${ids}-resume-${id}`;
            return (
              <div
                key={id}
                role="status"
                className={cn(
                  "flex flex-col gap-2 rounded-md border border-status-info-border bg-status-info p-3",
                  highlight === id && "ring-2 ring-ring",
                )}
              >
                <p className="text-sm font-medium text-status-info-fg">
                  {labels.upload.resumeBanner(session.name, pct)}
                </p>
                <Label htmlFor={inputId} className="text-2xs text-fg-muted">
                  {checking === id ? labels.upload.checking : labels.upload.resumePick}
                </Label>
                <Input
                  id={inputId}
                  type="file"
                  accept=".tif,.tiff"
                  disabled={checking !== null}
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    if (picked) void resumeWith(session, picked);
                  }}
                />
                {resumeNote?.id === id && (
                  <p role="alert" className="text-2xs text-pretty text-status-danger-fg">
                    {resumeNote.message}
                  </p>
                )}
                {confirmDiscard === id ? (
                  confirmRow(id)
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="self-start"
                    onClick={() => setConfirmDiscard(id)}
                  >
                    {labels.upload.discard}
                  </Button>
                )}
              </div>
            );
          })}

        <form
          key={formKey}
          className="flex flex-col gap-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fileId}>{labels.upload.fileLabel}</Label>
            <Input
              id={fileId}
              type="file"
              accept=".tif,.tiff"
              required
              disabled={busy}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && name.trim() === "") setName(nameFromFile(picked));
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>{labels.upload.nameLabel}</Label>
            <Input
              id={nameId}
              required
              value={name}
              placeholder={labels.upload.namePlaceholder}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dateId}>{labels.upload.capturedAtLabel}</Label>
            <DatePicker
              id={dateId}
              value={fromIsoDate(capturedAt)}
              onChange={(value) => setCapturedAt(value ? toIsoDate(value) : "")}
              disabled={busy}
              placeholder={labels.upload.capturedAtPlaceholder}
              format={formatDayMonthYear}
              disabledDates={{ after: new Date() }}
              className="h-9 w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={epsgId}>{labels.upload.epsgLabel}</Label>
            <Input
              id={epsgId}
              inputMode="numeric"
              pattern="[0-9]*"
              value={crsEpsg}
              placeholder={labels.upload.epsgPlaceholder}
              aria-describedby={epsgHintId}
              disabled={busy}
              onChange={(event) => setCrsEpsg(event.target.value.replace(/\D/g, ""))}
            />
            <p id={epsgHintId} className="text-2xs text-fg-faint">
              {labels.upload.epsgHint}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={tfwId}>{labels.upload.tfwLabel}</Label>
            <Input
              id={tfwId}
              type="file"
              accept=".tfw"
              disabled={busy}
              onChange={(event) => setTfw(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={prjId}>{labels.upload.prjLabel}</Label>
            <Input
              id={prjId}
              type="file"
              accept=".prj"
              disabled={busy}
              onChange={(event) => setPrj(event.target.files?.[0] ?? null)}
            />
          </div>

          {busy && (
            <div className="flex flex-col gap-1.5">
              <Progress value={percent} aria-label={labels.upload.progress(String(percent))} />
              <p role="status" className="text-2xs text-fg-muted tabular">
                {paused
                  ? labels.upload.paused
                  : progress < 1
                    ? labels.upload.progress(String(percent))
                    : labels.upload.processing}
              </p>
              <p className="text-2xs text-fg-faint text-pretty">{labels.upload.leaving}</p>
              {confirmDiscard === "current" && confirmRow("current")}
            </div>
          )}

          {error && (
            <Failure
              compact
              title={labels.upload.failed}
              message={error.message}
              requestId={error.requestId}
              requestIdText={labels.error.requestId}
              requestIdMissingText={labels.error.requestIdMissing}
            />
          )}
          {error?.existingId && onUseExisting && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => pickExisting(error.existingId as string)}
            >
              {labels.upload.useExisting}
            </Button>
          )}

          <DialogFooter>
            {busy ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-status-danger-fg"
                  disabled={confirmDiscard === "current"}
                  onClick={() => setConfirmDiscard("current")}
                >
                  {labels.upload.discard}
                </Button>
                <Button type="button" variant="outline" onClick={pause}>
                  {labels.upload.stop}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={close}>
                {labels.upload.cancel}
              </Button>
            )}
            <Button type="submit" disabled={busy || file === null || name.trim() === ""}>
              <Icon
                name={busy ? "feedback.loading" : "action.upload"}
                spin={busy}
                className="size-4"
              />
              {labels.upload.submit}
            </Button>
          </DialogFooter>
        </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// After the bytes are sent: the server's stage and percent until the flight is ready or failed.
function ServerProgress({
  labels,
  name,
  raster,
  pollFailed,
  onClose,
  onDelete,
}: {
  labels: ChangeDetectionLabels;
  name: string;
  raster: Raster | null;
  pollFailed: boolean;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const status = raster?.status ?? "processing";
  const chip = flightChip(status, raster?.progress ?? 0);
  const percent = progressPercent(raster?.progress ?? 0);
  const stage = raster?.stage ?? labels.flight.stageFallback;
  const percentText = String(percent);
  const running = chip === "queued" || chip === "processing" || chip === "uploading";
  const broken = chip === "failed" || chip === "rejected";
  const hours = restoreHours(raster?.restore_eta_hours);
  const note =
    chip === "retrying"
      ? labels.flight.retryingHint
      : chip === "archived"
        ? labels.flight.archivedHint
        : chip === "restoring"
          ? hours !== null
            ? labels.flight.restoringEta(String(hours))
            : labels.flight.restoringNoEta
          : null;
  const title =
    chip === "ready"
      ? labels.upload.ready
      : running
        ? labels.upload.serverTitle
        : broken
          ? labels.upload.serverFailed
          : labels.flight[chip];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-pretty">
          {chip === "ready" ? labels.upload.readyBody(name) : (note ?? labels.upload.serverHint)}
        </DialogDescription>
      </DialogHeader>

      {running && (
        <div className="flex flex-col gap-1.5">
          <Progress
            value={percent}
            aria-label={labels.flight.progressLabel(name, stage, percentText)}
          />
          <div
            role="status"
            className="flex items-center justify-between gap-2 text-2xs text-fg-muted tabular"
          >
            <span className="truncate" title={stage}>
              {stage}
            </span>
            <span className="shrink-0">{labels.flight.percent(percentText)}</span>
          </div>
          {pollFailed && (
            <p className="text-2xs text-status-warning-fg">{labels.upload.pollFailed}</p>
          )}
        </div>
      )}

      {chip === "ready" && (
        <p role="status" className="flex items-center gap-2 text-sm text-status-success-fg">
          <Icon name="feedback.success" className="size-4" />
          {labels.upload.ready}
        </p>
      )}

      {broken && (
        <Failure
          compact
          title={labels.flight[chip]}
          message={
            chip === "rejected"
              ? labels.flight.rejectedHint(raster?.reject_reason ?? raster?.error ?? labels.flight.failedNoError)
              : (raster?.error ?? labels.flight.failedNoError)
          }
          requestId={null}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
        />
      )}

      <DialogFooter>
        {onDelete && status !== "ready" && (
          <Button type="button" variant="outline" onClick={onDelete}>
            <Icon name="action.delete" className="size-4" />
            {labels.deleteFlight.confirm}
          </Button>
        )}
        <Button type="button" onClick={onClose}>
          {running ? labels.upload.close : labels.upload.done}
        </Button>
      </DialogFooter>
    </>
  );
}
