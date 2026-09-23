import { AdaApiError } from '@/services/api/errors';
import {
  WORKABLE_ROUND_STATUSES,
  fetchRoundsForCase,
  openRound,
} from '@/services/api/inspections';
import type { InspectionDetail, InspectionRow } from '@/services/api/types';
import { bindCapturesToRound } from '@/services/storage/captures';
import { draftStore, readJson, writeJson } from '@/services/storage/kv';

/*
 * Which round the wizard is working on, and which step was open.
 *
 * The server is the record: a round exists because `POST /cases/{ref}/inspections`
 * minted it. The device remembers the answer so that a killed app, or a surveyor
 * who walked out of coverage, resumes the same round at the same step instead of
 * asking for a new one.
 *
 * How a duplicate is avoided. Opening moves the case from `assigned` (or
 * `resurvey_requested`) to `under_inspection`, and the workflow table has no
 * `open_round` out of `under_inspection` — so a second open is `409
 * invalid_transition`, never a second round. This module therefore:
 *   1. asks `GET /inspections` for this surveyor's workable round on the case and
 *      resumes it if there is one;
 *   2. otherwise opens one;
 *   3. if the open is refused as `invalid_transition` — typically because an
 *      earlier attempt landed and its answer was lost — lists again and resumes
 *      the newest round it finds.
 */
export const WIZARD_STEPS = ['check-in', 'photos', 'findings', 'review', 'done'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

// The four step names the stepper shows, in order (ui-registry.md §1).
export const STEP_TITLES = ['Check-in', 'Photographs', 'Findings', 'Review'] as const;

export type LocalRound = {
  readonly caseRef: string;
  readonly inspectionRef: string;
  readonly roundNo: number;
  /** The round's own status as the server last reported it. */
  readonly status: string;
  readonly step: WizardStep;
  readonly updatedAt: string;
};

export type ResolvedRound = LocalRound & {
  /** `device` when the server could not be reached and the remembered round is used. */
  readonly source: 'server' | 'device';
};

// Builds the storage key for one case's round.
function roundKey(caseRef: string): string {
  return `round:${caseRef}`;
}

// Runtime guard; a record from an older build that does not parse is ignored.
function isLocalRound(value: unknown): value is LocalRound {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.inspectionRef === 'string' &&
    typeof candidate.roundNo === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.step === 'string' &&
    (WIZARD_STEPS as readonly string[]).includes(candidate.step)
  );
}

// The round this device last worked on for a case, or null.
export function localRound(caseRef: string): LocalRound | null {
  return readJson(draftStore, roundKey(caseRef), isLocalRound);
}

// True while the round can still take check-ins, evidence, findings and a submit.
export function isWorkable(status: string): boolean {
  return (WORKABLE_ROUND_STATUSES as readonly string[]).includes(status);
}

// The workable round for a case, for the drain. Null until one is known, and for a finished one.
export function inspectionRefForCase(caseRef: string): string | null {
  const round = localRound(caseRef);
  return round !== null && isWorkable(round.status) ? round.inspectionRef : null;
}

// Records the server's answer. A different round from the one remembered starts at step one.
function rememberRound(
  caseRef: string,
  row: Pick<InspectionRow, 'inspection_ref' | 'round_no' | 'status'>,
): LocalRound {
  const previous = localRound(caseRef);
  const sameRound = previous?.inspectionRef === row.inspection_ref;
  const next: LocalRound = {
    caseRef,
    inspectionRef: row.inspection_ref,
    roundNo: row.round_no,
    status: row.status,
    step: sameRound && previous !== null ? previous.step : 'check-in',
    updatedAt: new Date().toISOString(),
  };
  writeJson(draftStore, roundKey(caseRef), next);
  // Captures taken before the round was known belong to it — only if it can still take evidence.
  if (isWorkable(row.status)) bindCapturesToRound(caseRef, row.inspection_ref);
  return next;
}

// Stores the step that is open, so a relaunch resumes there.
export function rememberStep(caseRef: string, step: WizardStep): void {
  const current = localRound(caseRef);
  if (current === null || current.step === step) return;
  writeJson(draftStore, roundKey(caseRef), {
    ...current,
    step,
    updatedAt: new Date().toISOString(),
  });
}

// Updates the remembered status from a fresher server answer (a submit, a GET).
export function rememberRoundDetail(caseRef: string, detail: InspectionDetail): void {
  rememberRound(caseRef, detail);
}

// Picks the newest round from a list the server sorted by `-round_no`.
function newest(rows: readonly InspectionRow[]): InspectionRow | null {
  return rows.reduce<InspectionRow | null>(
    (best, row) => (best === null || row.round_no > best.round_no ? row : best),
    null,
  );
}

/*
 * The round to work on: resumed if this surveyor has one open on the case,
 * opened otherwise. Offline, the remembered round is answered with `source:
 * 'device'`; with nothing remembered the offline error propagates, stated.
 */
export async function resolveRound(caseRef: string, surveyorUserId: string): Promise<ResolvedRound> {
  try {
    const open = newest(
      await fetchRoundsForCase(caseRef, {
        status: WORKABLE_ROUND_STATUSES,
        surveyorUserId,
      }),
    );
    if (open !== null) return { ...rememberRound(caseRef, open), source: 'server' };

    try {
      const opened = await openRound(caseRef, { surveyor_user_id: surveyorUserId });
      return { ...rememberRound(caseRef, opened), source: 'server' };
    } catch (error) {
      if (!(error instanceof AdaApiError) || error.code !== 'invalid_transition') throw error;
      // The case has already left `assigned`: resume this surveyor's newest round, if any.
      const latest = newest(await fetchRoundsForCase(caseRef, { surveyorUserId }));
      if (latest === null) throw error;
      return { ...rememberRound(caseRef, latest), source: 'server' };
    }
  } catch (error) {
    const remembered = localRound(caseRef);
    if (error instanceof AdaApiError && error.isOffline && remembered !== null) {
      return { ...remembered, source: 'device' };
    }
    throw error;
  }
}

/*
 * The line a wizard step shows about its round, or null when there is nothing to
 * say. `placeholder` is true while the remembered round is shown during a fetch,
 * which is not "offline" and gets no notice.
 */
export function roundNotice(
  round: ResolvedRound | undefined,
  error: Error | null,
  placeholder: boolean,
): string | null {
  if (round !== undefined && round.source === 'device' && !placeholder) {
    return (
      `No signal — working on ${round.inspectionRef} as saved on this device. Everything you ` +
      'capture is kept here and sent when you are back in coverage.'
    );
  }
  if (round !== undefined || error === null) return null;
  if (error instanceof AdaApiError && error.isOffline) {
    return (
      'No signal — the inspection round cannot be opened yet. You can still check in, photograph ' +
      'the site and record findings; they are kept on this device and sent once the round opens.'
    );
  }
  const code = error instanceof AdaApiError ? ` (${error.code})` : '';
  return `The inspection round could not be opened: ${error.message}${code}`;
}

// True when the round failed for a reason other than coverage — the server said no.
export function roundRefused(round: ResolvedRound | undefined, error: Error | null): boolean {
  return round === undefined && error !== null && !(error instanceof AdaApiError && error.isOffline);
}
