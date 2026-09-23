/**
 * The Inspection detail screen — Figma 60:641, `ROUTES.inspection()`.
 *
 * ## What Figma draws and what this screen draws
 *
 * The frame is one state of one inspection: a COMPLETED round, read-only, with
 * a summary strip, a two-column grid of labelled values, a photo strip and a
 * map card. All four are here, in the same order, at the same density. Four
 * things are here that the frame has no room for, and contract §5 requires
 * every one:
 *
 *   - **the round history**, because a case surveyed twice is two inspections
 *     and the frame only ever shows one of them;
 *   - **the check-ins with their accuracy**, which is the proof the surveyor
 *     stood at the site;
 *   - **the flagged-geotag state on each evidence tile**;
 *   - **the action bar**, driven by `available_actions`. The frame's only
 *     button is "Back", because it draws a finished round.
 *
 * Two of the frame's own fields are NOT here, and their absence is a shape
 * rather than an oversight. "Encroachment Confirmed" and "External Support
 * Required" have no column in `icms_inspection` and no field in
 * `InspectionDetail`; the nearest thing the API has is the findings list, which
 * is free text. Drawing a Yes/No control over a field that does not exist would
 * be inventing a record.
 *
 * ## Everything on this screen is read-only
 *
 * Editing the findings, the occupant and the measurement is the findings form
 * at `ROUTES.inspectionFindings()`, which this screen links to when the server
 * offers `record_findings`. One screen owns those fields, and it is not this
 * one.
 *
 * ## The shell
 *
 * No 82px rail, no top account bar, no page gutter and no max width. `AppShell`
 * mounts all four once in `ProtectedLayout`, for every screen.
 */

import { Link, useNavigate, useParams } from "react-router-dom";
import type { CaseStatus } from "@/api/icms/cases";
import { IcmsApiError } from "@/api/icms/http";
import {
  allows,
  toInspectionStatus,
  type CheckInOut,
  type InspectionDetail as InspectionDetailRow,
} from "@/api/icms/inspections";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormats } from "@/i18n";
import {
  useCaptureSourceLabels,
  useCaseStatusLabels,
  useInspectionGateLabels,
  useInspectionStatusLabels,
  useInspectionsLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { EvidenceGallery } from "./EvidenceGallery";
import { InspectionActions } from "./InspectionActions";
import { ResurveyPanel } from "./ResurveyPanel";
import { RoundHistory } from "./RoundHistory";
import { useInspectionDetailLabels, type InspectionDetailLabels } from "./detailLabels";
import { roundsOf, telHref } from "./detailModel";
import { Absent, DetailPanel, Field, Mono } from "./detailParts";
import { INSPECTION_STATUS_META } from "./inspectionStatus";
import {
  useCaseRounds,
  useDecideResurvey,
  useEvidenceGate,
  useInspection,
  useInspectionEvidence,
  useResurveyRequests,
} from "./useInspectionDetail";
import { useInspectionGate } from "./useInspections";

/**
 * A surveyor's display name, or the id that is always there instead.
 *
 * Contract amendment 6: `surveyor_name` is always null — Keycloak is the user
 * store and there is no local users table to join — so the field is in the
 * shape and never populated. The id is what an officer has to work with, and a
 * blank cell where a name belongs reads as a failed load.
 */
function personOf(name: string | null, userId: string): string {
  return name ?? userId;
}

/** Six decimal places is about a tenth of a metre; more is false precision. */
function coordinate(value: number): string {
  return value.toFixed(6);
}

function CheckInRow({
  checkIn,
  labels,
  formatDateTime,
}: {
  checkIn: CheckInOut;
  labels: InspectionDetailLabels;
  formatDateTime: (value: string) => string;
}) {
  const sourceLabels = useCaptureSourceLabels();

  // `inside_zone` is three-valued: in, out, and "there was no boundary to test
  // against". The third is not a failure and must not read as one.
  const zone =
    checkIn.inside_zone === null
      ? labels.checkIns.zoneUnknown
      : checkIn.inside_zone
        ? labels.checkIns.insideZone
        : labels.checkIns.outsideZone;

  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-md border border-line-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-fg-strong">
          {labels.summary.coordinates(coordinate(checkIn.lat), coordinate(checkIn.lon))}
        </Mono>
        <Badge variant="outline" className="tabular">
          {labels.checkIns.accuracy(checkIn.accuracy_m)}
        </Badge>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
        <Icon
          name={checkIn.inside_zone === false ? "feedback.warning" : "map.pin"}
          className="size-3.5 shrink-0"
        />
        {zone}
      </p>

      <dl className="flex flex-col gap-0.5 text-2xs text-fg-muted">
        <div className="flex flex-wrap gap-1">
          <dt>{labels.checkIns.source}:</dt>
          <dd>{sourceLabels[checkIn.capture_source] ?? checkIn.capture_source}</dd>
        </div>
        <div className="flex flex-wrap gap-1">
          <dt>{labels.checkIns.deviceTime}:</dt>
          <dd>
            <time dateTime={checkIn.device_timestamp}>
              {formatDateTime(checkIn.device_timestamp)}
            </time>
          </dd>
        </div>
        <div className="flex flex-wrap gap-1">
          <dt>{labels.checkIns.serverTime}:</dt>
          <dd>
            <time dateTime={checkIn.server_timestamp}>
              {formatDateTime(checkIn.server_timestamp)}
            </time>
          </dd>
        </div>
        <div className="flex flex-wrap gap-1">
          <dt className="sr-only">{labels.summary.surveyor}</dt>
          <dd>{checkIn.user_id}</dd>
        </div>
      </dl>
    </li>
  );
}

/** Figma's summary strip (60:694), widened to everything the row carries. */
function SummaryStrip({
  detail,
  labels,
  formatDate,
}: {
  detail: InspectionDetailRow;
  labels: InspectionDetailLabels;
  formatDate: (value: string) => string;
}) {
  const register = useInspectionsLabels();
  const caseStatusLabels = useCaseStatusLabels();

  const date = (value: string | null) =>
    value === null ? (
      <Absent>{register.notRecorded}</Absent>
    ) : (
      <time dateTime={value} className="tabular">
        {formatDate(value)}
      </time>
    );

  return (
    <DetailPanel title={labels.summary.title} className="bg-surface-2">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={labels.summary.caseRef}>
          <Link
            to={ROUTES.complaint(detail.case_ref)}
            className="rounded-xs font-medium text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {detail.case_ref}
          </Link>
        </Field>

        {/* `case_title` is `icms_case.property_address` — amendment 5. */}
        <Field label={labels.summary.caseTitle} wide>
          {detail.case_title ?? <Absent>{register.notRecorded}</Absent>}
        </Field>

        <Field label={labels.summary.caseStatus}>
          {caseStatusLabels[detail.case_status as CaseStatus] ?? detail.case_status}
        </Field>

        <Field label={labels.summary.surveyor}>
          {personOf(detail.surveyor_name, detail.surveyor_user_id)}
        </Field>

        <Field label={labels.summary.zone}>
          {detail.zone_name ?? detail.zone_cd ?? <Absent>{register.notRecorded}</Absent>}
        </Field>

        <Field label={labels.summary.scheduled}>
          {detail.scheduled_for === null ? (
            <Absent>{register.notScheduled}</Absent>
          ) : (
            date(detail.scheduled_for)
          )}
        </Field>

        <Field label={labels.summary.started}>{date(detail.started_at)}</Field>
        <Field label={labels.summary.submitted}>{date(detail.submitted_at)}</Field>
      </dl>
    </DetailPanel>
  );
}

export default function InspectionDetail() {
  const { inspectionId = "" } = useParams<{ inspectionId: string }>();
  const navigate = useNavigate();
  const labels = useInspectionDetailLabels();
  const register = useInspectionsLabels();
  const gateLabels = useInspectionGateLabels();
  const statusLabels = useInspectionStatusLabels();
  const { date, dateTime, number } = useFormats();

  const gate = useInspectionGate();
  const evidenceGate = useEvidenceGate();

  const inspection = useInspection(inspectionId, gate.canRead);
  const detail = inspection.data ?? null;
  const caseRef = detail?.case_ref ?? null;

  const rounds = useCaseRounds(caseRef, gate.canRead);
  const evidence = useInspectionEvidence(inspectionId, gate.canRead && evidenceGate.canRead);
  const resurveys = useResurveyRequests(caseRef, gate.canRead);
  const decide = useDecideResurvey(inspectionId, caseRef);

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
        <p className="text-sm text-fg-muted text-pretty">{gateLabels.deniedBody}</p>
      </section>
    );
  }

  const back = (
    <div className="flex justify-end">
      <Button
        variant="outline"
        size="sm"
        className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
        onClick={() => {
          void navigate(ROUTES.inspections);
        }}
      >
        <Icon name="action.back" className="size-4" />
        {labels.back}
      </Button>
    </div>
  );

  if (inspection.isPending) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {back}
        <LoadingState label={labels.loading} lines={6} />
      </div>
    );
  }

  if (inspection.isError || detail === null) {
    const api = inspection.error instanceof IcmsApiError ? inspection.error : null;
    // 404 is "no such inspection, or outside your zones" — §6 makes the two
    // indistinguishable on purpose, and so does this sentence.
    const missing = api?.status === 404;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {back}
        <ErrorState
          icon={missing ? "feedback.noResults" : "feedback.error"}
          title={missing ? labels.notFoundTitle : labels.errorTitle}
          description={missing ? labels.notFoundBody : (api?.message ?? labels.errorBody)}
          detail={api?.requestId ?? undefined}
          onRetry={
            missing
              ? undefined
              : () => {
                  void inspection.refetch();
                }
          }
          retryLabel={missing ? undefined : labels.errorRetry}
        />
      </div>
    );
  }

  const status = toInspectionStatus(detail.status);
  const history = roundsOf(rounds.data ?? [], detail);
  const phone = telHref(detail.occupant_phone);
  const mayRecordFindings = allows(detail, "record_findings");

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {back}

      {/* ---- title, state, and what may be done to it -------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
              {detail.inspection_ref}
            </h1>
            {/* Chip AND label: the tone repeats the state, it never carries it. */}
            {status === null ? (
              <Badge variant="outline">{detail.status}</Badge>
            ) : (
              <StatusChip status={INSPECTION_STATUS_META[status].chip}>
                {statusLabels[status]}
              </StatusChip>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted text-pretty">
            {labels.subtitle(detail.round_no, detail.case_ref)}
          </p>
        </div>

        <InspectionActions detail={detail} labels={labels} />
      </header>

      <SummaryStrip detail={detail} labels={labels} formatDate={date} />

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- the loop, the findings, the evidence ---------------------- */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <RoundHistory
            rounds={history}
            currentRef={detail.inspection_ref}
            status={rounds.isPending ? "pending" : rounds.isError ? "error" : "success"}
            error={rounds.error}
            onRetry={() => {
              void rounds.refetch();
            }}
            labels={labels}
            formatDate={date}
          />

          <ResurveyPanel
            detail={detail}
            requests={resurveys.data ?? []}
            status={resurveys.isPending ? "pending" : resurveys.isError ? "error" : "success"}
            error={resurveys.error}
            onRetry={() => {
              void resurveys.refetch();
            }}
            labels={labels}
            formatDateTime={dateTime}
            decidePending={decide.isPending}
            decideError={decide.error}
            onDecide={(id, body) => {
              decide.mutate({ id, body });
            }}
          />

          <DetailPanel
            title={labels.findings.title}
            aside={
              <>
                <span className="text-2xs text-fg-faint tabular">
                  {labels.findings.count(detail.findings.length)}
                </span>
                {mayRecordFindings && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={ROUTES.inspectionFindings(detail.inspection_ref)}>
                      <Icon name="inspection.record" className="size-4" />
                      {labels.findings.emptyAction}
                    </Link>
                  </Button>
                )}
              </>
            }
          >
            {detail.findings.length === 0 ? (
              <EmptyState
                size="compact"
                icon="inspection.findings"
                title={labels.findings.emptyTitle}
                description={labels.findings.emptyBody}
              />
            ) : (
              <ol className="flex flex-col gap-2">
                {detail.findings.map((finding) => (
                  <li
                    key={finding.seq}
                    className="flex min-w-0 gap-3 rounded-md border border-line-subtle bg-surface-2 p-3"
                  >
                    <span className="shrink-0 text-sm font-semibold text-fg-muted tabular">
                      {labels.findings.seq(finding.seq)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-fg-strong text-pretty">{finding.finding}</p>
                      <p className="mt-0.5 text-2xs text-fg-faint">
                        {labels.findings.recordedAt(dateTime(finding.created_at))}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
              <h3 className="text-2xs font-semibold text-fg-muted">{labels.sections.title}</h3>
              {detail.sections.length === 0 ? (
                <p className="text-sm text-fg-faint">{labels.sections.none}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {detail.sections.map((section) => (
                    <li key={`${section.act_cd}/${section.section_cd}`}>
                      <Badge variant="secondary">
                        {labels.sections.item(section.act_cd, section.section_cd)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1 border-t border-line-subtle pt-3">
              <h3 className="text-2xs font-semibold text-fg-muted">
                {labels.officerNote.title}
              </h3>
              <p className="text-sm text-pretty">
                {detail.officer_note ?? <Absent>{labels.officerNote.none}</Absent>}
              </p>
            </div>
          </DetailPanel>

          <EvidenceGallery
            evidence={evidence.data ?? []}
            status={
              evidenceGate.loading || evidence.isPending
                ? "pending"
                : evidence.isError
                  ? "error"
                  : "success"
            }
            error={evidence.error}
            onRetry={() => {
              void evidence.refetch();
            }}
            canRead={evidenceGate.canRead}
            formatDateTime={dateTime}
          />
        </div>

        {/* ---- where it happened, and who was standing there -------------- */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Figma's map card, without the map: `InspectionDetail` carries a
              point and an accuracy, and a basemap that cannot be told where the
              parcel boundary is would be decoration over a coordinate. */}
          <DetailPanel title={labels.summary.location}>
            {detail.location === null ? (
              <p className="text-sm text-fg-faint">{labels.summary.noLocation}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-2">
                  <Icon name="map.pin" className="size-4 shrink-0 text-fg-muted" />
                  <Mono className="text-fg-strong">
                    {labels.summary.coordinates(
                      coordinate(detail.location.lat),
                      coordinate(detail.location.lon),
                    )}
                  </Mono>
                </p>
                {detail.location_accuracy_m !== null && (
                  <Badge variant="outline" className="w-fit tabular">
                    {labels.summary.accuracy(detail.location_accuracy_m)}
                  </Badge>
                )}
              </div>
            )}
          </DetailPanel>

          <DetailPanel
            title={labels.checkIns.title}
            aside={
              <span className="text-2xs text-fg-faint tabular">
                {labels.checkIns.count(detail.check_ins.length)}
              </span>
            }
          >
            {detail.check_ins.length === 0 ? (
              <EmptyState
                size="compact"
                icon="inspection.checkIn"
                title={labels.checkIns.emptyTitle}
                description={labels.checkIns.emptyBody}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.check_ins.map((checkIn) => (
                  <CheckInRow
                    key={checkIn.id}
                    checkIn={checkIn}
                    labels={labels}
                    formatDateTime={dateTime}
                  />
                ))}
              </ul>
            )}
          </DetailPanel>

          <DetailPanel title={labels.occupant.title}>
            {detail.occupant_name === null && detail.occupant_phone === null ? (
              <p className="text-sm text-fg-faint">{labels.occupant.none}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label={labels.occupant.name}>
                  {detail.occupant_name ?? <Absent>{register.notRecorded}</Absent>}
                </Field>
                <Field label={labels.occupant.phone}>
                  {detail.occupant_phone === null ? (
                    <Absent>{register.notRecorded}</Absent>
                  ) : phone === null ? (
                    <Mono>{detail.occupant_phone}</Mono>
                  ) : (
                    <a
                      href={phone}
                      className="rounded-xs font-mono text-xs text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {detail.occupant_phone}
                    </a>
                  )}
                </Field>
              </dl>
            )}
          </DetailPanel>

          <DetailPanel title={labels.measurement.title}>
            {detail.measured_area_sqm === null &&
            detail.area_type_cd === null &&
            detail.notice_required === null ? (
              <p className="text-sm text-fg-faint">{labels.measurement.none}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label={labels.measurement.areaType}>
                  {detail.area_type_cd ?? <Absent>{register.notRecorded}</Absent>}
                </Field>
                <Field label={labels.measurement.area}>
                  {detail.measured_area_sqm === null ? (
                    <Absent>{register.notRecorded}</Absent>
                  ) : (
                    // Lakh/crore grouping on `hi-IN`, thousands on `en-IN`:
                    // an area is a quantity and is read like one.
                    <span className="tabular">
                      {labels.measurement.areaValue(number(detail.measured_area_sqm))}
                    </span>
                  )}
                </Field>
                <Field label={labels.measurement.noticeRequired}>
                  {detail.notice_required === null ? (
                    <Absent>{labels.measurement.undecided}</Absent>
                  ) : detail.notice_required ? (
                    labels.measurement.yes
                  ) : (
                    labels.measurement.no
                  )}
                </Field>
                {detail.notice_act_cd !== null && (
                  <Field label={labels.measurement.noticeAct}>{detail.notice_act_cd}</Field>
                )}
              </dl>
            )}
          </DetailPanel>
        </div>
      </div>
    </div>
  );
}
