/**
 * The Complaint detail screen — `ROUTES.complaint()`. No Figma frame.
 *
 * The register's "VIEW" action implies this screen and the workflow needs it,
 * but `ui-registry.md` §5 lists it first among the six the design never drew.
 * So it is built in the visual language of the Inspection detail screen, its
 * closest sibling: the same summary strip over a two-column grid of panels, the
 * same `Field` pairs, the same chips, the same action bar at the top right.
 * Nothing here invents a second vocabulary for something that already has one.
 *
 * ## A case outside your authority does not exist
 *
 * `repository.case_detail` narrows a Field Surveyor holding no supervisory role
 * to their own open assignment, and answers `None` when the row falls outside
 * it — which the router turns into 404 `case_not_found`, not 403. That is
 * deliberate: a refusal that distinguished "not yours" from "no such case"
 * would confirm the case exists to someone with no authority over it. This
 * screen renders that as "no such complaint" and offers NO retry, because
 * retrying cannot succeed.
 *
 * ## What is here that a register row cannot show
 *
 * The assignment and the means to change it; the rounds, ascending, so the
 * re-survey loop stays readable after round 2 opens; the evidence count against
 * the round it belongs to; and the amendable fields, behind one dialog.
 *
 * ## The shell
 *
 * No rail, no account bar, no page gutter and no max width. `AppShell` mounts
 * all four once in `ProtectedLayout`, for every screen.
 */

import { Link, useNavigate, useParams } from "react-router-dom";
import { IcmsApiError } from "@/api/icms/http";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import { PriorityChip, StatusChip } from "@/components/icms/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormats, useLanguage } from "@/i18n";
import {
  useCaseStatusLabels,
  useComplaintsLabels,
  useParcelKindLabels,
  usePriorityLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { ActorName } from "@/components/icms/ActorName";
import { CASE_STATUS_META, toCaseStatus, toPriority } from "./caseStatus";
import { ComplaintDetailActionNotes, ComplaintDetailActions } from "./ComplaintDetailActions";
import { useCase, useCaseGate } from "./ComplaintDetailData";
import { useComplaintDetailLabels } from "./ComplaintDetailLabels";
import { evidenceRound, pointOf, telHref } from "./ComplaintDetailModel";
import { Absent, DetailPanel, Field, Mono } from "./ComplaintDetailParts";
import { ComplaintDetailRounds } from "./ComplaintDetailRounds";
import { ComplaintDetailSurvey } from "./ComplaintDetailSurvey";
import { resolveParcelId } from "./parcelId";

/** Six decimal places is about a tenth of a metre; more is false precision. */
function coordinate(value: number): string {
  return value.toFixed(6);
}

export default function ComplaintDetail() {
  // `paths.ts` names the parameter `:complaintId`; the brief calls it
  // `:caseRef`. Both are read so the screen survives whichever name the route
  // is finally declared with — they carry the same case reference either way.
  const params = useParams<{ caseRef?: string; complaintId?: string }>();
  const caseRef = params.caseRef ?? params.complaintId ?? "";

  const navigate = useNavigate();
  const labels = useComplaintDetailLabels();
  const register = useComplaintsLabels();
  const statusLabels = useCaseStatusLabels();
  const priorityLabels = usePriorityLabels();
  const parcelKinds = useParcelKindLabels();
  const { date, dateTime, number } = useFormats();
  const { language } = useLanguage();

  const gate = useCaseGate();
  const complaint = useCase(caseRef, gate.canRead);
  const detail = complaint.data ?? null;

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
          {labels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{labels.gate.deniedBody}</p>
      </section>
    );
  }

  const backButton = (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
      onClick={() => {
        void navigate(ROUTES.complaints);
      }}
    >
      <Icon name="action.back" className="size-4" />
      {labels.back}
    </Button>
  );
  const back = <div className="flex justify-end">{backButton}</div>;

  if (complaint.isPending) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {back}
        <LoadingState label={labels.loading} lines={6} />
      </div>
    );
  }

  if (complaint.isError || detail === null) {
    const api = complaint.error instanceof IcmsApiError ? complaint.error : null;
    // 404 is "no such case, OR one you have no authority over" — the server
    // makes the two indistinguishable on purpose, and so does this sentence.
    // No retry: the same request will be refused the same way every time.
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
                  void complaint.refetch();
                }
          }
          retryLabel={missing ? undefined : labels.errorRetry}
        />
      </div>
    );
  }

  const status = toCaseStatus(detail.status);
  const priority = toPriority(detail.priority);
  const parcel = resolveParcelId(detail);
  const point = pointOf(detail.location);
  const assignment = detail.assignment ?? null;
  const evidenceAt = evidenceRound(detail.rounds ?? [], detail.current_round);

  const complainantPhone = telHref(detail.complainant_phone);
  const ownerPhone = telHref(detail.owner_phone);

  const absent = <Absent>{register.notRecorded}</Absent>;

  const phoneValue = (value: string | null | undefined, href: string | null) => {
    if (!value) return absent;
    if (href === null) return <Mono>{value}</Mono>;
    return (
      <a
        href={href}
        className="rounded-xs font-mono text-xs text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {value}
      </a>
    );
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* ---- title, state, and what may be done to it -------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
              {detail.case_ref}
            </h1>
            {/* Chip AND label: the tone repeats the state, it never carries it. */}
            {status === null ? (
              <Badge variant="outline">{detail.status}</Badge>
            ) : (
              <StatusChip status={CASE_STATUS_META[status].chip}>
                {statusLabels[status]}
              </StatusChip>
            )}
            {priority !== null && (
              <PriorityChip priority={priority}>{priorityLabels[priority]}</PriorityChip>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted text-pretty">
            {labels.subtitle(detail.zone_name || detail.zone_cd)}
          </p>
          <ComplaintDetailActionNotes detail={detail} labels={labels} />
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2">
          <ComplaintDetailActions detail={detail} gate={gate} labels={labels} />
          {backButton}
        </div>
      </header>

      {/* ---- the case, at a glance --------------------------------------- */}
      <DetailPanel title={labels.panels.case} className="bg-surface-2">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={labels.fields.complaint_type_cd}>
            {detail.complaint_type_label ?? detail.complaint_type_cd ?? absent}
          </Field>

          {detail.other_type && (
            <Field label={labels.fields.other_type}>{detail.other_type}</Field>
          )}

          <Field label={labels.fields.zone}>{detail.zone_name || detail.zone_cd}</Field>

          <Field label={labels.fields.stage_no}>{labels.values.stage(detail.stage_no)}</Field>

          <Field label={labels.fields.source}>{labels.values.source(detail.source)}</Field>

          <Field label={labels.fields.raised_at}>
            <time dateTime={detail.raised_at} className="tabular">
              {dateTime(detail.raised_at)}
            </time>
          </Field>

          <Field label={labels.fields.created_by}>
            {detail.created_by ? (
              <ActorName name={detail.created_by_name} id={detail.created_by} />
            ) : (
              absent
            )}
          </Field>

          <Field label={labels.fields.updated_at}>
            <time dateTime={detail.updated_at} className="tabular">
              {dateTime(detail.updated_at)}
            </time>
          </Field>

          <Field label={labels.fields.current_round}>
            {detail.current_round === 0 ? absent : labels.values.round(detail.current_round)}
          </Field>

          {detail.closed_at && (
            <Field label={labels.fields.closed_at}>
              <time dateTime={detail.closed_at} className="tabular">
                {dateTime(detail.closed_at)}
              </time>
            </Field>
          )}

          {detail.closed_by && (
            <Field label={labels.fields.closed_by}>
              <ActorName name={detail.closed_by_name} id={detail.closed_by} />
            </Field>
          )}

          {/* Why it was rejected, or how it was closed: the server's label, in this language. */}
          {detail.outcome_cd && (
            <Field label={labels.fields.outcome_cd}>
              {(language === "hi-IN" ? detail.outcome_label_hi : detail.outcome_label) ??
                detail.outcome_cd}
            </Field>
          )}

          {detail.outcome_reason && (
            <Field label={labels.fields.outcome_reason} wide>
              <span className="text-pretty">{detail.outcome_reason}</span>
            </Field>
          )}

          {detail.measured_area_sqm !== null && detail.measured_area_sqm !== undefined && (
            <Field label={register.columns.area}>
              <span className="tabular">
                {labels.values.area(number(detail.measured_area_sqm))}
              </span>
            </Field>
          )}
        </dl>
      </DetailPanel>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- what was reported, where, and what happened next ---------- */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <DetailPanel title={labels.panels.property}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={labels.fields.property_address} wide>
                {detail.property_address ?? absent}
              </Field>
              <Field label={labels.fields.landmark}>{detail.landmark ?? absent}</Field>
              <Field label={labels.fields.police_station}>
                {detail.police_station ?? absent}
              </Field>
              <Field label={labels.fields.district}>{detail.district ?? absent}</Field>
              <Field label={labels.fields.state}>{detail.state ?? absent}</Field>
              <Field label={labels.fields.pin_code}>
                {detail.pin_code ? <Mono>{detail.pin_code}</Mono> : absent}
              </Field>
              <Field label={labels.fields.country}>{detail.country ?? absent}</Field>
              <Field label={labels.fields.property_type_cd}>
                {detail.property_type_cd ?? absent}
              </Field>
              <Field label={labels.fields.floor_count}>
                {detail.floor_count === null || detail.floor_count === undefined
                  ? absent
                  : number(detail.floor_count)}
              </Field>

              <Field label={labels.fields.location} wide>
                {point === null ? (
                  <Absent>{labels.values.noLocation}</Absent>
                ) : (
                  <span className="flex items-center gap-2">
                    <Icon name="map.pin" className="size-4 shrink-0 text-fg-muted" />
                    <Mono className="text-fg-strong">
                      {labels.values.coordinates(coordinate(point.lat), coordinate(point.lon))}
                    </Mono>
                  </span>
                )}
              </Field>
            </dl>

            <div className="flex flex-col gap-1 border-t border-line-subtle pt-3">
              <h3 className="text-2xs font-semibold text-fg-muted">{labels.fields.detail}</h3>
              <p className="text-sm text-pretty">
                {detail.detail ?? <Absent>{labels.values.noDetail}</Absent>}
              </p>
            </div>
          </DetailPanel>

          <ComplaintDetailRounds
            rounds={detail.rounds ?? []}
            currentRound={detail.current_round}
            status={complaint.isPending ? "pending" : complaint.isError ? "error" : "success"}
            error={complaint.error}
            onRetry={() => {
              void complaint.refetch();
            }}
            labels={labels}
            notRecorded={register.notRecorded}
            formatDate={date}
            formatNumber={number}
          />

          {/* Counted per CASE, so it links to the round that holds the newest
              of it rather than pretending to know which round each file is on. */}
          <DetailPanel
            title={labels.panels.evidence}
            description={labels.evidence.body}
            aside={
              <span className="text-2xs text-fg-faint tabular">
                {labels.evidence.count(detail.evidence_count)}
              </span>
            }
          >
            {detail.evidence_count === 0 ? (
              <EmptyState
                size="compact"
                icon="inspection.photo"
                title={labels.evidence.none}
                description={labels.evidence.body}
              />
            ) : evidenceAt === null ? (
              <p className="text-sm text-fg-faint text-pretty">{labels.evidence.noRound}</p>
            ) : (
              <Button variant="outline" size="sm" className="w-fit" asChild>
                <Link to={ROUTES.inspection(evidenceAt.inspection_ref)}>
                  <Icon name="inspection.photo" className="size-4" />
                  {labels.evidence.link(evidenceAt.round_no)}
                </Link>
              </Button>
            )}
          </DetailPanel>
        </div>

        {/* ---- who holds it, who reported it, whose land it is ----------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <DetailPanel title={labels.panels.assignment} description={labels.assignment.body}>
            {assignment === null ? (
              <EmptyState
                size="compact"
                icon="case.assign"
                title={labels.assignment.noneTitle}
                description={labels.assignment.noneBody}
              />
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label={labels.rounds.columns.surveyor}>
                  <span className="flex flex-wrap items-center gap-2">
                    <ActorName
                      className="text-fg-strong"
                      name={assignment.assignee_name}
                      id={assignment.assignee_user_id}
                    />
                    {/* Their own case, said in words rather than by a tint. */}
                    {gate.userId === assignment.assignee_user_id && (
                      <Badge variant="secondary" className="text-2xs">
                        {labels.assignment.kind}
                      </Badge>
                    )}
                  </span>
                </Field>

                <Field label={labels.assignment.assignedAt}>
                  <time dateTime={assignment.assigned_at} className="tabular">
                    {dateTime(assignment.assigned_at)}
                  </time>
                </Field>

                <Field label={labels.fields.created_by}>
                  <ActorName name={assignment.assigned_by_name} id={assignment.assigned_by} />
                </Field>

                {assignment.note && (
                  <Field label={labels.assign.noteLabel}>{assignment.note}</Field>
                )}

                {!assignment.active && (
                  <p className="text-2xs text-fg-faint text-pretty">
                    {labels.assignment.releasedNote}
                  </p>
                )}
              </dl>
            )}
          </DetailPanel>

          <DetailPanel title={labels.panels.complainant}>
            {!detail.complainant_name &&
            !detail.complainant_phone &&
            !detail.complainant_email ? (
              <p className="text-sm text-fg-faint text-pretty">{labels.values.noComplainant}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label={labels.fields.complainant_name}>
                  {detail.complainant_name ?? absent}
                </Field>
                <Field label={labels.fields.complainant_phone}>
                  {phoneValue(detail.complainant_phone, complainantPhone)}
                </Field>
                <Field label={labels.fields.complainant_email}>
                  {detail.complainant_email ? (
                    <a
                      href={`mailto:${detail.complainant_email}`}
                      className="rounded-xs text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {detail.complainant_email}
                    </a>
                  ) : (
                    absent
                  )}
                </Field>
              </dl>
            )}
          </DetailPanel>

          <DetailPanel title={labels.panels.owner}>
            {!detail.owner_name && !detail.owner_phone ? (
              <p className="text-sm text-fg-faint text-pretty">{labels.values.noOwner}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Field label={labels.fields.owner_name}>{detail.owner_name ?? absent}</Field>
                <Field label={labels.fields.owner_phone}>
                  {phoneValue(detail.owner_phone, ownerPhone)}
                </Field>
              </dl>
            )}
          </DetailPanel>

          <ComplaintDetailSurvey
            rounds={detail.rounds ?? []}
            labels={labels}
            notRecorded={register.notRecorded}
          />

          <DetailPanel title={labels.panels.parcel}>
            {parcel.value === null ? (
              <p className="text-sm text-fg-faint text-pretty">{labels.values.noParcel}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-3">
                {/* The caption says WHICH identifier this is: a ULPIN and a
                    Khasra number are different kinds of number. */}
                <Field label={parcelKinds[parcel.kindKey] ?? labels.fields.parcel_id}>
                  <Mono className="text-fg-strong">{parcel.value}</Mono>
                </Field>
                {detail.village_lgd_code && (
                  <Field label={labels.fields.village_lgd_code}>
                    <Mono>{detail.village_lgd_code}</Mono>
                  </Field>
                )}
                {detail.district_lgd_code && (
                  <Field label={labels.fields.district_lgd_code}>
                    <Mono>{detail.district_lgd_code}</Mono>
                  </Field>
                )}
              </dl>
            )}
          </DetailPanel>
        </div>
      </div>
    </div>
  );
}
