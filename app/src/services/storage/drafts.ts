import { draftStore, readJson, writeJson } from './kv';

/*
 * Findings drafts. There is no offline write queue in this build
 * (progress-tracker.md §6, 2026-09-22) — a draft is the one local write that
 * survives, because a form filled in the sun is not retyped.
 *
 * Saved on every field blur (code-standards.md §5), keyed by case and step, so a
 * killed app resumes at the step that was open with the values that were typed.
 * MMKV writes are synchronous, which is the point: a blur followed immediately by
 * a process kill still lands.
 */
export type DraftScope = {
  readonly caseRef: string;
  readonly step: string;
};

export type DraftValues = Record<string, string | number | boolean | null>;

export type Draft = {
  readonly values: DraftValues;
  readonly updatedAt: string;
};

// Builds the storage key for one case and step.
function draftKey(scope: DraftScope): string {
  return `draft:${scope.caseRef}:${scope.step}`;
}

// Runtime guard; a draft written by an older build that no longer parses is discarded, not crashed on.
function isDraft(value: unknown): value is Draft {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.updatedAt === 'string' &&
    candidate.values !== null &&
    typeof candidate.values === 'object'
  );
}

// Reads the whole draft for one step.
export function readDraft(scope: DraftScope): Draft | null {
  return readJson(draftStore, draftKey(scope), isDraft);
}

// Replaces one field and stamps the draft. Call this from a field's onBlur, not onChange.
export function saveDraftField(
  scope: DraftScope,
  field: string,
  value: DraftValues[string],
): Draft {
  const existing = readDraft(scope);
  const next: Draft = {
    values: { ...(existing?.values ?? {}), [field]: value },
    updatedAt: new Date().toISOString(),
  };
  writeJson(draftStore, draftKey(scope), next);
  return next;
}

// Replaces every value in one step's draft.
export function saveDraft(scope: DraftScope, values: DraftValues): Draft {
  const next: Draft = { values, updatedAt: new Date().toISOString() };
  writeJson(draftStore, draftKey(scope), next);
  return next;
}

/*
 * Discards a draft. Call it only once the round it belongs to has been accepted
 * by the server — a draft cleared on submit and then lost to a failed request is
 * the form retyped.
 */
export function clearDraft(scope: DraftScope): void {
  draftStore.remove(draftKey(scope));
}

// Every draft held for a case, newest first. Feeds "resume where you left off".
export function draftsForCase(caseRef: string): { scope: DraftScope; draft: Draft }[] {
  const prefix = `draft:${caseRef}:`;
  return draftStore
    .getAllKeys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({ key, draft: readJson(draftStore, key, isDraft) }))
    .filter((entry): entry is { key: string; draft: Draft } => entry.draft !== null)
    .map((entry) => ({
      scope: { caseRef, step: entry.key.slice(prefix.length) },
      draft: entry.draft,
    }))
    .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
}

// The stored draft as its raw string: stable by value, so React can subscribe to it.
export function draftSnapshot(scope: DraftScope): string {
  return draftStore.getString(draftKey(scope)) ?? '';
}

// Parses a snapshot taken by `draftSnapshot`; null for none or one that no longer parses.
export function parseDraft(snapshot: string): Draft | null {
  if (snapshot === '') return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Calls `listener` whenever this draft is written or cleared.
export function subscribeToDraft(scope: DraftScope, listener: () => void): () => void {
  const key = draftKey(scope);
  const subscription = draftStore.addOnValueChangedListener((changed) => {
    if (changed === key) listener();
  });
  return () => subscription.remove();
}
