import { useLocalSearchParams, useRouter } from 'expo-router';
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DetailScreenTemplate } from '@/design-system';
import { CaseState } from '@/design-system/organisms/cases/CaseStates';
import {
  AttributeCard,
  FindingsCard,
  InstructionCard,
  MapCard,
  ResurveyCard,
  TextCard,
  type AttributeRow,
  type FindingRow,
} from '@/design-system/organisms/cases/DetailSections';
import { EvidenceGrid, type EvidenceItem } from '@/design-system/organisms/cases/EvidenceGrid';
import { caseMetrics } from '@/design-system/organisms/cases/palette';
import {
  BackGlyph,
  CaseIcon,
  CaseText,
  NavigateGlyph,
  PrimaryButton,
  PriorityBadge,
  SecondaryButton,
  SectionHeading,
  SkeletonBlock,
  distanceText,
  type StatusTone,
} from '@/design-system/organisms/cases/primitives';
import { useComplaintTypeLabel, useSqmLabel } from '@/design-system/organisms/ComplaintCard';
import {
  caseCoordinates,
  useCaseDetail,
  useCaseEvidence,
  useResurveyRequests,
  type CaseDetail,
} from '@/services/api/case-reads';
import { isNotFound } from '@/services/api/error-text';
import {
  useCaseInspections,
  useInspectionDetail,
  useInspectionEvidence,
  type InspectionDetail,
  type InspectionRow,
} from '@/services/api/inspection-reads';
import { dataAge } from '@/services/api/query-client';
import { useCapabilities } from '@/services/config/capabilities';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { fieldEntryFor, phaseOf, useWorkStatuses, type WorkPhase } from '@/services/config/work-statuses';
import { areaParts } from '@/services/format/area-units';
import { formatAge, formatDate, formatDateTime } from '@/services/format/datetime';
import { useT, type TFunction } from '@/services/i18n';
import { haversineMeters, useLastKnownPosition } from '@/services/location/last-known';
import { dialNumber, openInMaps } from '@/services/location/open-maps';

/*
 * Complaint Detail — Figma 03 (174:4991, open case), 10 (195:2657) and 11 (202:3867)
 * are one screen. Open case: map, Navigate to site, the office's instruction, facts,
 * description, evidence, and "Start Ground Inspection" as the one dominant action.
 * Completed: the same plus Inspection Findings and Remark, then a back button whose
 * words depend on where the screen was opened (`from`): the Inspections list gets
 * "Back to Inspection List" (10); the submitted screen's "View Full Report" passes
 * `from=report` and gets a plain "Back" (11). `round` picks which round's findings show.
 *
 *   GET /api/icms/cases/{ref}               GET /api/icms/cases/{ref}/evidence
 *   GET /api/icms/inspections?case_ref=     GET /api/icms/inspections/{ref}(/evidence)
 *   GET /api/icms/cases/{ref}/resurvey-requests
 */
type Origin = 'complaints' | 'inspections' | 'home' | 'report';

const BACK = {
  complaints: { key: 'caseDetail.backToComplaints', href: '/complaints' },
  inspections: { key: 'caseDetail.backToList', href: '/inspections' },
  home: { key: 'caseDetail.backToHome', href: '/home' },
  report: { key: 'common.back', href: '/inspections' },
} as const;

const DOMAINS = {
  encroachment: 'encroachment_confirmed',
  support: 'external_support',
  recommendation: 'recommendation',
} as const;

const phaseTone: Record<WorkPhase, StatusTone> = {
  to_start: 'new',
  underway: 'in_progress',
  handed_in: 'completed',
  other: 'other',
};

function originOf(value: string | string[] | undefined): Origin {
  return value === 'inspections' || value === 'home' || value === 'report' ? value : 'complaints';
}

// The latest round that has been submitted, or null.
function latestSubmitted(rounds: readonly InspectionRow[] | undefined): InspectionRow | null {
  const submitted = (rounds ?? []).filter((round) => round.submitted_at);
  return submitted.length === 0 ? null : submitted[submitted.length - 1];
}

// "Permanent Structure (RCC)" -> ["Permanent Structure", "(RCC)"], as 10 draws it.
function splitCaption(label: string): { main: string; caption: string | null } {
  const match = /^(.*?)\s*(\([^)]*\))\s*$/.exec(label);
  return match && match[1] !== '' ? { main: match[1], caption: match[2] } : { main: label, caption: null };
}

// "2,000 sq ft (185.8 sq.m)", or a dash when nothing was measured.
function areaBoth(sqm: number | null | undefined, t: TFunction): string {
  const parts = areaParts(sqm);
  if (parts === null) return '—';
  return t('cases.area.both', {
    sqft: t('cases.area.sqft', { value: parts.sqft }),
    sqm: t('cases.area.sqm', { value: parts.sqm }),
  });
}

// The rows of the Inspection Findings card, from the structured answers.
function useFindingRows(detail: CaseDetail, inspection: InspectionDetail | undefined): FindingRow[] {
  const t = useT();
  const areaType = useCodeLabel(LABEL_DOMAINS.areaType);
  const encroachment = useCodeLabel(DOMAINS.encroachment);
  const support = useCodeLabel(DOMAINS.support);
  const recommendation = useCodeLabel(DOMAINS.recommendation);
  const rows: FindingRow[] = [];
  if (inspection === undefined) return rows;
  if (detail.parcel_id) rows.push({ label: t('caseDetail.findings.parcel'), value: detail.parcel_id });
  rows.push({ label: t('caseDetail.findings.area'), value: areaBoth(inspection.measured_area_sqm, t) });
  if (inspection.area_type_cd) {
    const split = splitCaption(areaType(inspection.area_type_cd));
    rows.push({ label: t('caseDetail.findings.type'), value: split.main, caption: split.caption });
  }
  if (inspection.encroachment_confirmed_cd) {
    rows.push({
      label: t('caseDetail.findings.confirmed'),
      value: encroachment(inspection.encroachment_confirmed_cd),
    });
  }
  if (inspection.external_support_cd) {
    rows.push({ label: t('caseDetail.findings.support'), value: support(inspection.external_support_cd) });
  }
  if (inspection.recommendation_cd) {
    rows.push({
      label: t('caseDetail.findings.recommendation'),
      value: recommendation(inspection.recommendation_cd),
      pill: true,
    });
  }
  if (inspection.occupant_name) {
    rows.push({ label: t('caseDetail.findings.occupant'), value: inspection.occupant_name });
  }
  const submitted = formatDateTime(inspection.submitted_at);
  if (submitted) rows.push({ label: t('caseDetail.findings.submitted'), value: submitted });
  return rows;
}

// Findings, site photos and remark for one round (10's lower half).
function RoundReport({ detail, roundRef }: { detail: CaseDetail; roundRef: string }) {
  const t = useT();
  const inspection = useInspectionDetail(roundRef);
  const evidence = useInspectionEvidence(roundRef);
  const rows = useFindingRows(detail, inspection.data);

  if (inspection.isPending) return <SkeletonBlock height={240} />;
  if (inspection.error !== null && inspection.data === undefined) {
    if (isNotFound(inspection.error)) {
      return (
        <View style={styles.section}>
          <SectionHeading>{t('caseDetail.findings')}</SectionHeading>
          <TextCard text={t('caseDetail.findings.hidden')} />
        </View>
      );
    }
    return (
      <CaseState
        kind="error"
        title={t('caseDetail.findings.error')}
        error={inspection.error}
        onAction={() => void inspection.refetch()}
      />
    );
  }
  const data = inspection.data;
  if (data === undefined) return null;
  // Rounds from before the structured answers carry only the free-text lines.
  const notes = data.encroachment_confirmed_cd ? [] : (data.findings ?? []).map((finding) => finding.finding);
  const photos: EvidenceItem[] = (evidence.data ?? [])
    .filter((item) => item.kind === 'photo')
    .map((item) => ({
      id: item.id,
      contentUrl: item.content_url,
      isImage: item.content_type?.startsWith('image/') === true,
      name: item.original_filename ?? null,
    }));
  return (
    <>
      <View style={styles.section}>
        <SectionHeading>{t('caseDetail.findings')}</SectionHeading>
        <FindingsCard rows={rows} notes={notes} />
      </View>
      {photos.length > 0 ? (
        <View style={styles.section}>
          <SectionHeading>{t('caseDetail.sitePhotos')}</SectionHeading>
          <EvidenceGrid items={photos} />
        </View>
      ) : null}
      <View style={styles.section}>
        <SectionHeading>{t('caseDetail.remark')}</SectionHeading>
        <TextCard text={data.officer_note?.trim() ? data.officer_note : t('caseDetail.remarkNone')} />
      </View>
    </>
  );
}

// The complaint's own attachments, as 2-column tiles.
function ComplaintEvidence({ caseRef }: { caseRef: string }) {
  const t = useT();
  const evidence = useCaseEvidence(caseRef);
  let body: React.ReactNode;
  if (evidence.isPending) {
    body = <SkeletonBlock height={caseMetrics.evidenceHeight} />;
  } else if (evidence.error !== null && evidence.data === undefined) {
    body = (
      <CaseText kind="cardFoot" color="statusSentBack" accessibilityRole="alert">
        {t('caseDetail.evidenceError')}
      </CaseText>
    );
  } else if ((evidence.data ?? []).length === 0) {
    body = (
      <CaseText kind="panelSub" color="viewInk">
        {t('caseDetail.evidenceNone')}
      </CaseText>
    );
  } else {
    body = (
      <EvidenceGrid
        items={(evidence.data ?? []).map((item) => ({
          id: item.id,
          contentUrl: item.content_url,
          isImage: item.content_type?.startsWith('image/') === true,
          name: item.filename ?? item.caption ?? null,
        }))}
      />
    );
  }
  return (
    <View style={styles.section}>
      <SectionHeading>{t('caseDetail.evidence')}</SectionHeading>
      {body}
    </View>
  );
}

export function ComplaintDetailScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ caseRef: string; from?: string; round?: string }>();
  const caseRef = typeof params.caseRef === 'string' ? params.caseRef : '';
  const origin = originOf(params.from);
  const back = BACK[origin];

  const detail = useCaseDetail(caseRef);
  const capabilities = useCapabilities();
  const work = useWorkStatuses();
  const rounds = useCaseInspections(caseRef);
  const resurvey = useResurveyRequests(caseRef);
  const caseStatus = useCodeLabel(LABEL_DOMAINS.caseStatus);
  const typeLabel = useComplaintTypeLabel();
  const sqm = useSqmLabel();
  const [mapProblem, setMapProblem] = useState<string | null>(null);

  const coordinates = caseCoordinates(detail.data);
  const position = useLastKnownPosition(coordinates !== null);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(back.href);
  };
  // 10's button goes to the list itself, whatever the stack holds.
  const onBottomBack = () => {
    if (origin === 'inspections') router.navigate('/inspections');
    else onBack();
  };

  const onRefresh = () => {
    void detail.refetch();
    void rounds.refetch();
    void resurvey.refetch();
    void capabilities.refetch();
  };

  const data = detail.data;
  const entry = data ? fieldEntryFor(capabilities.data, data.allowed_actions, data.status) : null;
  const requested = typeof params.round === 'string' && params.round !== '' ? params.round : null;
  const roundRef = requested ?? latestSubmitted(rounds.data)?.inspection_ref ?? null;
  const completed = data !== undefined && entry === null && roundRef !== null;

  const age = dataAge(detail.dataUpdatedAt);
  const freshness =
    age.isStale && age.fetchedAt ? t('cases.updated', { age: formatAge(age.fetchedAt) ?? '' }) : undefined;

  const target = {
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    address: [data?.property_address, data?.landmark, data?.district].filter(Boolean).join(', '),
  };
  const openMap = async (mode: 'directions' | 'show') => {
    setMapProblem(null);
    if (coordinates === null && target.address === '') {
      setMapProblem(t('caseDetail.navigateNothing'));
      return;
    }
    const opened = await openInMaps(target, mode);
    if (!opened) setMapProblem(t('caseDetail.navigateFailed'));
  };

  let body: React.ReactNode;
  if (detail.isPending) {
    body = (
      <View style={styles.column} accessibilityLabel={t('common.loading')}>
        <SkeletonBlock height={250} />
        <SkeletonBlock height={220} />
        <SkeletonBlock height={100} />
      </View>
    );
  } else if (detail.error !== null && data === undefined) {
    body = isNotFound(detail.error) ? (
      <CaseState kind="empty" title={t('caseDetail.error.title')} body={t('caseDetail.error.gone')} />
    ) : (
      <CaseState
        kind="error"
        title={t('caseDetail.error.title')}
        error={detail.error}
        onAction={() => void detail.refetch()}
      />
    );
  } else if (data) {
    const status = completed && roundRef ? 'completed' : phaseTone[phaseOf(work.data, data.status)];
    const distance =
      coordinates !== null && position !== null ? distanceText(haversineMeters(position, coordinates), t) : null;
    const attributes: AttributeRow[] = [{ label: t('caseDetail.row.complaintId'), value: data.case_ref }];
    if (data.complainant_name) attributes.push({ label: t('caseDetail.row.complainant'), value: data.complainant_name });
    if (data.complainant_phone) {
      const number = data.complainant_phone;
      attributes.push({
        label: t('caseDetail.row.contact'),
        value: number,
        callLabel: t('caseDetail.callA11y', { number }),
        onCall: () =>
          void dialNumber(number).then((ok) => {
            if (!ok) Alert.alert(t('caseDetail.callFailed', { number }));
          }),
      });
    }
    if (data.parcel_id) attributes.push({ label: t('caseDetail.row.parcel'), value: data.parcel_id });
    const reported = sqm(data.measured_area_sqm);
    if (reported) attributes.push({ label: t('caseDetail.row.reportedArea'), value: reported });
    if (data.landmark) attributes.push({ label: t('caseDetail.row.landmark'), value: data.landmark });

    const openRound = (rounds.data ?? []).filter((round) => !round.submitted_at).at(-1);
    const assignment = data.assignment?.active ? data.assignment : null;
    const visit = formatDateTime(openRound?.scheduled_for);
    const given = formatDate(assignment?.assigned_at);
    const instructionRows = [
      ...(visit ? [{ label: t('caseDetail.visitDate'), value: visit }] : []),
      ...(given ? [{ label: t('caseDetail.givenOn'), value: given }] : []),
    ];
    const showInstruction = !completed && (Boolean(assignment?.note) || visit !== null);
    const resurveyItems = (resurvey.data ?? []).map((request) => ({
      key: String(request.id),
      reason: request.reason,
      when: formatDate(request.requested_at),
    }));

    body = (
      <View style={styles.column}>
        <MapCard
          title={typeLabel(data)}
          statusTone={status}
          statusLabel={caseStatus(data.status)}
          address={data.property_address ?? null}
          distance={distance}
          point={coordinates}
          onOpenMap={() => void openMap('show')}
        />
        {!completed ? (
          <SecondaryButton
            label={t('caseDetail.navigate')}
            accessibilityHint={t('caseDetail.navigateHint')}
            onPress={() => void openMap('directions')}
            icon={<NavigateGlyph size={20} />}
            fullWidth
            style={styles.navigate}
          />
        ) : null}
        {mapProblem ? (
          <CaseText kind="cardMeta" color="statusSentBack" accessibilityRole="alert">
            {mapProblem}
          </CaseText>
        ) : null}
        {!completed && resurveyItems.length > 0 ? <ResurveyCard items={resurveyItems} /> : null}
        {showInstruction ? <InstructionCard note={assignment?.note ?? null} rows={instructionRows} /> : null}
        <AttributeCard
          rows={attributes}
          labelColor={completed ? 'rowLabelDone' : 'rowLabel'}
          trailingDivider={completed}
          footer={!completed && data.priority ? <PriorityBadge priority={data.priority} /> : undefined}
        />
        <View style={styles.section}>
          <SectionHeading>{t('caseDetail.description')}</SectionHeading>
          <TextCard text={data.detail?.trim() ? data.detail : t('caseDetail.descriptionNone')} trailingDivider />
        </View>
        <ComplaintEvidence caseRef={caseRef} />
        {completed && roundRef ? <RoundReport detail={data} roundRef={roundRef} /> : null}
        {entry === null ? (
          <SecondaryButton
            label={t(back.key)}
            onPress={onBottomBack}
            ink={origin === 'inspections' ? 'secondaryInk' : 'white'}
            icon={<BackGlyph color={origin === 'inspections' ? 'secondaryInk' : 'white'} />}
            style={styles.bottomBack}
          />
        ) : null}
      </View>
    );
  }

  return (
    <DetailScreenTemplate
      title={t(completed ? 'caseDetail.title.done' : 'caseDetail.title.open')}
      onBack={onBack}
      backAccessibilityLabel={t(back.key)}
      subtitle={
        caseRef !== '' ? (
          <CaseText kind="panelSub" color="muted" selectable>
            {caseRef}
          </CaseText>
        ) : undefined
      }
      showPendingBanner
      freshnessLabel={freshness}
      onRefresh={onRefresh}
      refreshing={detail.isRefetching}
      footer={
        entry !== null ? (
          <PrimaryButton
            label={t(entry.kind === 'start' ? 'caseDetail.start' : 'caseDetail.resume')}
            accessibilityHint={t('caseDetail.startHint')}
            onPress={() => router.push({ pathname: '/inspection/[caseRef]', params: { caseRef } })}
            icon={<CaseIcon glyph={ClipboardCheck} size={20} color="white" />}
          />
        ) : undefined
      }
    >
      {body}
    </DetailScreenTemplate>
  );
}

const styles = StyleSheet.create({
  column: { gap: caseMetrics.sectionGap },
  section: { gap: caseMetrics.headingGap },
  navigate: { minHeight: caseMetrics.primaryHeight },
  bottomBack: { marginTop: 10 },
});
