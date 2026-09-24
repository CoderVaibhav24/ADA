/**
 * Administration → Boundaries: one KML/KMZ in, zones, villages, parcels and red zones out.
 *
 * "Validate only" sends the same file with `dry_run=true`, so the officer sees
 * exactly what an import would do before it touches anything. The permission
 * check here only decides what is drawn; the import route decides again.
 */

import { useId, useState } from "react";
import type { BoundaryCounts, BoundaryImportResult, PlacemarkIssue } from "@/api/icms/geo";
import { IcmsApiError } from "@/api/icms/http";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ActorName } from "@/components/icms/ActorName";
import {
  BOUNDARY_ACCEPT,
  FOLDER_ORDER,
  isBoundaryFile,
  reportedFolders,
  sizeText,
  totalCounts,
  type Folder,
} from "./boundaryFile";
import { useBoundaryLabels, type BoundaryLabels } from "./labels";
import { useBoundaryImports, useImportBoundaries } from "./useBoundaries";

type Outcome = { dryRun: boolean; result: BoundaryImportResult };

// The folder's own name when it is one of the four, else what the server called it.
function folderName(labels: BoundaryLabels, folder: string): string {
  return (FOLDER_ORDER as readonly string[]).includes(folder)
    ? labels.folders[folder as Folder].name
    : folder;
}

// Inserted, updated, deactivated and rejected per folder, as a table.
function CountsTable({ labels, counts }: { labels: BoundaryLabels; counts: BoundaryCounts }) {
  const { number } = useFormats();
  return (
    <div className="overflow-x-auto rounded-md border border-line-subtle">
      <Table>
        <TableCaption className="sr-only">{labels.countsCaption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.folder}</TableHead>
            <TableHead className="text-right">{labels.inserted}</TableHead>
            <TableHead className="text-right">{labels.updated}</TableHead>
            <TableHead className="text-right">{labels.deactivated}</TableHead>
            <TableHead className="text-right">{labels.rejected}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reportedFolders(counts).map((folder) => {
            const row = counts[folder];
            if (row === undefined) return null;
            return (
              <TableRow key={folder}>
                <TableCell className="font-medium text-fg-strong">
                  {labels.folders[folder].name}
                </TableCell>
                <TableCell className="tabular text-right">{number(row.inserted)}</TableCell>
                <TableCell className="tabular text-right">{number(row.updated)}</TableCell>
                <TableCell className="tabular text-right">{number(row.deactivated)}</TableCell>
                <TableCell
                  className={
                    row.rejected > 0
                      ? "tabular text-right font-semibold text-status-danger-fg"
                      : "tabular text-right"
                  }
                >
                  {number(row.rejected)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// Placemarks with the server's reasons, scrolling rather than pushing the page; `muted` for warnings.
function IssueTable({
  labels,
  title,
  issues,
  muted = false,
}: {
  labels: BoundaryLabels;
  title: string;
  issues: PlacemarkIssue[];
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 className={muted ? "text-sm font-semibold text-fg-muted" : "text-sm font-semibold text-fg-strong"}>
        {title}
      </h4>
      <div
        className={
          muted
            ? "max-h-80 overflow-auto rounded-md border border-line-subtle text-fg-muted"
            : "max-h-80 overflow-auto rounded-md border border-line-subtle"
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.folder}</TableHead>
              <TableHead>{labels.placemark}</TableHead>
              <TableHead>{labels.reason}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((row, index) => (
              <TableRow key={`${row.folder}-${row.index}-${index}`}>
                <TableCell className="whitespace-nowrap">{folderName(labels, row.folder)}</TableCell>
                <TableCell className="font-mono text-xs break-all">
                  {row.name ?? row.key ?? labels.unnamed}
                </TableCell>
                <TableCell className="whitespace-normal text-pretty">{row.reasons.join("; ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// The refused placemarks, then those loaded with a warning.
function IssueLists({
  labels,
  rejected,
  warnings,
}: {
  labels: BoundaryLabels;
  rejected: PlacemarkIssue[];
  warnings: PlacemarkIssue[];
}) {
  return (
    <>
      {rejected.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.success" className="size-4 text-fg-link" />
          {labels.rejectedNone}
        </p>
      ) : (
        <IssueTable labels={labels} title={labels.rejectedTitle(rejected.length)} issues={rejected} />
      )}
      {warnings.length > 0 && (
        <IssueTable
          labels={labels}
          title={labels.warningsTitle(warnings.length)}
          issues={warnings}
          muted
        />
      )}
    </>
  );
}

// The past imports, newest first, each with its counts added up.
function ImportHistory({ labels }: { labels: BoundaryLabels }) {
  const formats = useFormats();
  const { data, status, error, refetch } = useBoundaryImports(true);

  return (
    <section aria-labelledby="boundary-history-title" className="flex min-w-0 flex-col gap-3">
      <div>
        <h3
          id="boundary-history-title"
          className="font-display text-base font-semibold text-fg-strong"
        >
          {labels.historyTitle}
        </h3>
        <p className="text-xs text-fg-faint">{labels.historySubtitle}</p>
      </div>

      {status === "pending" && <LoadingState label={labels.historyLoading} lines={3} />}

      {status === "error" && (
        <ErrorState
          size="compact"
          title={labels.historyError}
          description={error.message}
          retryLabel={labels.retry}
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {status === "success" && data.length === 0 && (
        <EmptyState size="compact" icon="map.layers" title={labels.historyEmpty} />
      )}

      {status === "success" && data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.file}</TableHead>
                <TableHead>{labels.importedBy}</TableHead>
                <TableHead>{labels.importedAt}</TableHead>
                <TableHead>{labels.counts}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => {
                const total = totalCounts(row.counts);
                return (
                  <TableRow key={row.id}>
                    <TableCell
                      className="max-w-64 truncate font-medium text-fg-strong"
                      title={row.filename}
                    >
                      {row.filename}
                    </TableCell>
                    <TableCell>
                      {row.imported_by_name === null && row.imported_by === null ? (
                        labels.someone
                      ) : (
                        <ActorName name={row.imported_by_name} id={row.imported_by} />
                      )}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      {row.imported_at === "" ? "—" : formats.dateTime(row.imported_at)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal text-fg-muted">
                      {labels.summary(
                        formats.number(total.inserted),
                        formats.number(total.updated),
                        formats.number(total.deactivated),
                        formats.number(total.rejected),
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

const FOLDER_ICON = {
  zones: "map.polygon",
  villages: "map.layers",
  parcels: "map.parcel",
  reserved: "map.encroachment",
} as const satisfies Record<Folder, string>;

/** The Boundaries tab. `canImport` is the advisory permission check from the capability gate. */
export default function BoundaryImport({ canImport }: { canImport: boolean }) {
  const labels = useBoundaryLabels();
  const formats = useFormats();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [wrongFile, setWrongFile] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const upload = useImportBoundaries();

  if (!canImport) {
    return (
      <EmptyState
        size="compact"
        icon="user.password"
        title={labels.deniedTitle}
        description={labels.deniedBody}
      />
    );
  }

  const busy = upload.isPending;
  const failure = upload.error;
  const requestId = failure instanceof IcmsApiError ? failure.requestId : null;
  const percent = Math.round(progress * 100);

  const send = (dryRun: boolean) => {
    if (file === null) return;
    setProgress(0);
    setOutcome(null);
    upload.mutate(
      { file, dryRun, onProgress: setProgress },
      {
        onSuccess: (result) => {
          setOutcome({ dryRun, result });
        },
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section
        aria-labelledby="boundary-title"
        className="flex min-w-0 flex-col gap-4 rounded-md border border-line-subtle bg-surface-1 p-4 sm:p-6"
      >
        <div className="min-w-0">
          <h2 id="boundary-title" className="font-display text-lg font-semibold text-fg-strong">
            {labels.title}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-fg-canvas-muted text-pretty">
            {labels.subtitle}
          </p>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {FOLDER_ORDER.map((folder) => (
            <li
              key={folder}
              className="flex min-w-0 gap-2 rounded-md border border-line-subtle bg-surface-2 p-3"
            >
              <Icon name={FOLDER_ICON[folder]} className="mt-0.5 size-4 shrink-0 text-fg-link" />
              <span className="min-w-0 text-sm">
                <span className="font-semibold text-fg-strong">{labels.folders[folder].name}</span>{" "}
                <code className="text-2xs text-fg-faint">{folder}/</code>
                <span className="block text-xs text-fg-muted text-pretty">
                  {labels.folders[folder].body}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-xs text-fg-faint text-pretty">{labels.spec}</p>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={fileId}>{labels.fileLabel}</Label>
          <Input
            id={fileId}
            type="file"
            accept={BOUNDARY_ACCEPT}
            disabled={busy}
            // The shared Input leaves the file button's text light on its light dark-mode fill.
            className="h-11 py-2 dark:file:text-earth-900"
            aria-describedby={wrongFile ? `${fileId}-hint ${fileId}-error` : `${fileId}-hint`}
            aria-invalid={wrongFile}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              const ok = chosen === null || isBoundaryFile(chosen.name);
              setWrongFile(!ok);
              setFile(ok ? chosen : null);
              setOutcome(null);
              upload.reset();
            }}
          />
          <p id={`${fileId}-hint`} className="text-xs text-fg-faint text-pretty">
            {file === null ? labels.fileHint : labels.chosen(file.name, sizeText(file.size))}
          </p>
          {wrongFile && (
            <p id={`${fileId}-error`} role="alert" className="text-xs text-status-danger-fg">
              {labels.wrongFile}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy || file === null}
            onClick={() => {
              send(true);
            }}
          >
            <Icon name="feedback.success" className="size-4" />
            {labels.validate}
          </Button>
          <Button
            type="button"
            disabled={busy || file === null}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <Icon
              name={busy ? "feedback.loading" : "action.upload"}
              spin={busy}
              className="size-4"
            />
            {labels.import}
          </Button>
        </div>

        {busy && (
          <div className="flex min-w-0 flex-col gap-1.5" aria-live="polite">
            <Progress value={percent} aria-label={labels.fileLabel} />
            <p className="text-xs text-fg-muted">
              {progress >= 1
                ? labels.processing
                : labels.uploading(`${formats.number(percent)}%`)}
            </p>
          </div>
        )}

        {failure !== null && (
          <Alert variant="destructive" role="alert">
            <Icon name="feedback.error" />
            <AlertTitle>{labels.errorTitle}</AlertTitle>
            <AlertDescription>
              <p>{failure.message}</p>
              {requestId !== null && (
                <p className="font-mono text-2xs">{labels.requestId(requestId)}</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {outcome !== null && (
          <section
            aria-live="polite"
            className="flex min-w-0 flex-col gap-3 border-t border-line-subtle pt-4"
          >
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-semibold text-fg-strong">
                <Icon
                  name={outcome.dryRun ? "feedback.info" : "feedback.success"}
                  className="size-4 text-fg-link"
                />
                {outcome.dryRun ? labels.dryRunTitle : labels.importedTitle}
              </h3>
              <p className="text-xs text-fg-muted">
                {outcome.dryRun ? labels.dryRunBody : labels.importedBody}
              </p>
            </div>
            <CountsTable labels={labels} counts={outcome.result.counts} />
            <IssueLists
              labels={labels}
              rejected={outcome.result.rejected}
              warnings={outcome.result.warnings}
            />
          </section>
        )}
      </section>

      <ImportHistory labels={labels} />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {labels.confirmBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                send(false);
              }}
            >
              {labels.confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
