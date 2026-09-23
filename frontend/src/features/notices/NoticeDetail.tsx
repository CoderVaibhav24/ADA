/**
 * The Notice detail screen — `ROUTES.notice()`.
 *
 * ## There is no Figma frame for this screen, and that is on the record
 *
 * The design file draws the notice as a MODAL over the register (node 72:4743,
 * "Notice — NOT-2210"): a header with the reference, the rendered document on a
 * white sheet, and a footer with Close and "Print / Download PDF". It draws no
 * page. This screen is that modal's content as a route, because the register's
 * VIEW action needs somewhere to go, a notice reference has to be a link an
 * officer can paste into an email, and a statutory document behind a dialog
 * cannot be deep-linked or bookmarked.
 *
 * What the modal drew is all here: the reference in the heading, the document
 * itself, and the download. Three panels it has no room for are here too, and
 * each is a field the API publishes that the frame simply had nowhere to put —
 * the issuing authority, the artefact checksum, and the inspection the notice
 * was raised from.
 *
 * ## The document is fetched, not linked
 *
 * `GET /notices/{ref}/pdf` sits behind the bearer token, so `<iframe src>`
 * cannot reach it: a browser sends no Authorization header on a subresource
 * request. `useNoticeDocument` fetches the bytes and hands back an object URL
 * it revokes on unmount. See `noticePdf.ts`.
 *
 * ## There is no delivery panel
 *
 * `deliveries` is always `[]`. The Parivartan App owns delivery tracking and
 * every case status after the notice is issued (build-order §3a, decided 23
 * September 2026); `icms_notice_delivery` has no endpoint and no screen. Rather
 * than draw an empty table, this screen says so in one sentence — a control
 * with no server behind it is worse than an honest absence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toIstDateKey } from "@ada/shared/dates";
import { IcmsApiError } from "@/api/icms/http";
import { toNoticeStatus } from "@/api/icms/notices";
import { ErrorState, LoadingState } from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import {
  useNoticeDetailLabels,
  useNoticeStatusLabels,
  useNoticesLabels,
} from "./noticeLabels";
import { bodyEntries, daysRemaining, isOverdue, orderedSections } from "./noticeModel";
import { downloadNoticePdf, useNoticeDocument } from "./noticePdf";
import { NOTICE_STATUS_META } from "./noticeStatus";
import { Absent, DetailPanel, Field, Mono } from "./parts";
import { useNotice, useNoticeGate } from "./useNotices";

export default function NoticeDetail() {
  const params = useParams();
  const ref = params.noticeId ?? "";
  const navigate = useNavigate();
  const labels = useNoticeDetailLabels();
  const registerLabels = useNoticesLabels();
  const statusLabels = useNoticeStatusLabels();
  const { date, dateTime } = useFormats();

  const gate = useNoticeGate();
  const { data, isPending, error, refetch } = useNotice(ref, gate.canRead);

  const document = useNoticeDocument(ref, gate.canRead && (data?.has_artefact ?? false));

  /* ---- download --------------------------------------------------------
     Separate from the preview: the preview already holds the bytes, but asking
     the browser to save an object URL that an `<iframe>` is also displaying is
     how a revoke races a download. One fetch per intent is simpler and the
     artefact is cached by the query client anyway. */
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      downloadAbort.current?.abort();
    },
    [],
  );

  const handleDownload = useCallback(() => {
    downloadAbort.current?.abort();
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloadError(null);
    setDownloading(true);

    void downloadNoticePdf(ref, controller.signal)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setDownloadError(
          cause instanceof IcmsApiError ? cause.message : labels.document.errorTitle,
        );
      })
      .finally(() => {
        setDownloading(false);
      });
  }, [labels.document.errorTitle, ref]);

  if (gate.loading || (gate.canRead && isPending)) {
    return <LoadingState label={labels.loading} lines={6} />;
  }

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
          {registerLabels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-muted text-pretty">{registerLabels.gate.deniedBody}</p>
      </section>
    );
  }

  if (error || !data) {
    const api = error instanceof IcmsApiError ? error : null;
    // 404 is "no such notice, OR one you have no authority over" — the server
    // answers both the same way, on purpose, so that a refusal enumerates no
    // record the caller cannot already see. Neither is retryable, so neither
    // gets a retry button.
    const missing = api?.status === 404;
    return (
      <ErrorState
        title={missing ? labels.notFoundTitle : labels.errorTitle}
        description={missing ? labels.notFoundBody : (api?.message ?? labels.errorBody)}
        detail={api?.requestId ?? undefined}
        onRetry={
          missing
            ? undefined
            : () => {
                void refetch();
              }
        }
        retryLabel={missing ? undefined : labels.errorRetry}
      />
    );
  }

  const today = toIstDateKey(new Date());
  const status = toNoticeStatus(data.status);
  const late = isOverdue(data, today);
  const left = daysRemaining(data.compliance_due, today);
  const sections = orderedSections(data.section_cds);
  const entries = bodyEntries(data.body);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* ---- Back ------------------------------------------------------ */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
          onClick={() => {
            void navigate(-1);
          }}
        >
          <Icon name="action.back" className="size-4" />
          {labels.back}
        </Button>
      </div>

      {/* ---- heading --------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {data.notice_ref}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{labels.subtitle(data.case_ref)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status === null ? (
            <StatusChip status="unknown">{data.status}</StatusChip>
          ) : (
            <span data-notice-status={status}>
              <StatusChip status={NOTICE_STATUS_META[status].chip}>
                {statusLabels[status]}
              </StatusChip>
            </span>
          )}
          {/* Derived from the due date, never from the status — see noticeModel. */}
          {late && (
            <Badge
              variant="outline"
              data-derived="overdue"
              className="border-status-danger-border bg-status-danger text-status-danger-fg"
            >
              {left === null ? labels.overdue : labels.overdueBy(Math.abs(left))}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigate(ROUTES.complaint(data.case_ref));
            }}
          >
            <Icon name="nav.complaints" className="size-4" />
            {labels.openCase}
          </Button>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* ---- the document -------------------------------------------- */}
        <DetailPanel
          title={labels.document.title}
          description={labels.document.hint}
          aside={
            <Button
              size="sm"
              disabled={!data.has_artefact || downloading}
              onClick={handleDownload}
            >
              <Icon
                name={downloading ? "feedback.loading" : "action.download"}
                spin={downloading}
                className="size-4"
              />
              {downloading ? labels.document.opening : labels.document.download}
            </Button>
          }
        >
          {!data.has_artefact ? (
            // Issued with the render still queued is a real state, not an
            // error: `has_artefact` is on the row precisely so this can be said
            // rather than guessed from the status.
            <Alert>
              <Icon name="feedback.info" className="size-4" />
              <AlertTitle>{labels.document.unavailableTitle}</AlertTitle>
              <AlertDescription>{labels.document.unavailableBody}</AlertDescription>
            </Alert>
          ) : document.error ? (
            <ErrorState
              size="compact"
              title={labels.document.errorTitle}
              description={document.error.message}
              detail={document.error.requestId ?? undefined}
              onRetry={document.refetch}
              retryLabel={labels.errorRetry}
            />
          ) : document.url === null ? (
            <LoadingState label={labels.document.opening} lines={4} />
          ) : (
            // A `title` rather than a bare frame: a screen reader announces the
            // embedded document by it, and "iframe" is not a document name.
            <iframe
              src={document.url}
              title={labels.document.frameTitle(data.notice_ref)}
              className="h-[36rem] w-full rounded-md border border-line-subtle bg-surface-2"
            />
          )}

          {downloadError && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {downloadError}
            </p>
          )}
        </DetailPanel>

        {/* ---- the record ---------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <DetailPanel title={labels.summary.title}>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={labels.summary.noticeRef}>
                <Mono>{data.notice_ref}</Mono>
              </Field>
              <Field label={labels.summary.caseRef}>
                <Mono>{data.case_ref}</Mono>
              </Field>
              <Field label={labels.summary.act}>{data.act_cd}</Field>
              <Field label={labels.summary.sections}>
                {sections.length > 0 ? (
                  registerLabels.sectionList(sections.join(", "))
                ) : (
                  <Absent>{registerLabels.noSections}</Absent>
                )}
              </Field>
              <Field label={labels.summary.issuedAt}>
                {data.issued_at ? (
                  <time dateTime={data.issued_at}>{dateTime(data.issued_at)}</time>
                ) : (
                  <Absent>{registerLabels.notIssued}</Absent>
                )}
              </Field>
              <Field label={labels.summary.complianceDue}>
                {data.compliance_due ? (
                  <time
                    dateTime={data.compliance_due}
                    className={late ? "text-status-danger-fg" : undefined}
                  >
                    {date(data.compliance_due)}
                  </time>
                ) : (
                  <Absent>{registerLabels.noDueDate}</Absent>
                )}
              </Field>
              <Field label={labels.summary.issuedBy}>
                {data.issued_by ? (
                  <Mono>{data.issued_by}</Mono>
                ) : (
                  <Absent>{labels.summary.absent}</Absent>
                )}
              </Field>
              <Field label={labels.summary.zone}>
                {data.zone_cd ? <Mono>{data.zone_cd}</Mono> : <Absent>{labels.summary.absent}</Absent>}
              </Field>
              <Field label={labels.summary.address} wide>
                {data.property_address ?? <Absent>{labels.summary.absent}</Absent>}
              </Field>
              <Field label={labels.summary.authority} wide>
                {data.issuing_authority ?? <Absent>{labels.summary.absent}</Absent>}
              </Field>
              <Field label={labels.summary.inspectionRef}>
                {data.inspection_ref ? (
                  <button
                    type="button"
                    onClick={() => {
                      void navigate(ROUTES.inspection(data.inspection_ref ?? ""));
                    }}
                    className="rounded-xs font-mono text-xs break-all text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {data.inspection_ref}
                  </button>
                ) : (
                  <Absent>{labels.summary.absent}</Absent>
                )}
              </Field>
              <Field label={labels.summary.checksum}>
                {data.artefact_sha256 ? (
                  // The whole digest, not a prefix: it is the thing a court
                  // copy is checked against, and eight characters prove nothing.
                  <Mono className="text-2xs">{data.artefact_sha256}</Mono>
                ) : (
                  <Absent>{labels.summary.absent}</Absent>
                )}
              </Field>
            </dl>
          </DetailPanel>

          {/* The rendered parts as the server stored them. Not a second copy of
              the PDF: the PDF is the instrument, this is what it was built from. */}
          <DetailPanel title={labels.body.title} description={labels.body.hint}>
            {entries.length === 0 ? (
              <p className="text-sm text-fg-faint">{labels.body.empty}</p>
            ) : (
              <dl className="flex flex-col gap-3">
                {entries.map((entry) => (
                  <Field key={entry.key} label={<Mono className="text-2xs">{entry.key}</Mono>}>
                    {entry.value}
                  </Field>
                ))}
              </dl>
            )}
          </DetailPanel>

          {/* Named, not drawn. See the module comment. */}
          <DetailPanel title={labels.delivery.title}>
            <p className="max-w-prose text-sm text-fg-muted text-pretty">
              {labels.delivery.body}
            </p>
          </DetailPanel>
        </div>
      </div>
    </div>
  );
}
