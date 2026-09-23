import { createMMKV } from 'react-native-mmkv';

/*
 * Push's own small store. Separate from `services/storage/` on purpose: sign-out
 * clears the cache store, and the priming answer must survive a sign-out — a
 * surveyor who said "not now" is not asked again because a colleague signed in.
 */
const pushStore = createMMKV({ id: 'ada.push' });

const KEY_PRIMING = 'push:priming';
const KEY_REGISTRATION = 'push:registration';

export type PrimingAnswer = 'accepted' | 'declined';

export type RegistrationRecord = {
  readonly token: string;
  readonly subject: string;
  readonly registeredAt: number;
};

export function readPrimingAnswer(): PrimingAnswer | null {
  const value = pushStore.getString(KEY_PRIMING);
  return value === 'accepted' || value === 'declined' ? value : null;
}

export function writePrimingAnswer(answer: PrimingAnswer | null): void {
  if (answer === null) pushStore.remove(KEY_PRIMING);
  else pushStore.set(KEY_PRIMING, answer);
}

function isRegistrationRecord(value: unknown): value is RegistrationRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === 'string' &&
    typeof record.subject === 'string' &&
    typeof record.registeredAt === 'number'
  );
}

export function readRegistration(): RegistrationRecord | null {
  const raw = pushStore.getString(KEY_REGISTRATION);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRegistrationRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRegistration(record: RegistrationRecord | null): void {
  if (record === null) pushStore.remove(KEY_REGISTRATION);
  else pushStore.set(KEY_REGISTRATION, JSON.stringify(record));
}
