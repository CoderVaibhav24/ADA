import { t, type PlainKey } from '@/services/i18n';

import { AdaApiError } from './errors';

// What kind of failure it was, in the terms the surveyor can act on.
export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'server'
  | 'busy'
  | 'loggedOut'
  | 'forbidden'
  | 'notFound'
  | 'update'
  | 'refused'
  | 'unknown';

export type ErrorText = {
  /** A short, translated sentence: what happened and what to do next. Never the raw server line. */
  readonly message: string;
  /** The server log line this refers to, when the server issued one. */
  readonly requestId: string | null;
  readonly offline: boolean;
  readonly kind: ErrorKind;
};

const MESSAGE = {
  offline: 'error.offline',
  timeout: 'error.timeout',
  server: 'error.server',
  busy: 'error.busy',
  loggedOut: 'error.loggedOut',
  forbidden: 'error.forbidden',
  notFound: 'error.notFound',
  update: 'error.update',
  refused: 'error.refused',
  unknown: 'error.unknown',
} as const satisfies Record<ErrorKind, PlainKey>;

// Sorts a thrown value into one of the kinds above.
export function errorKind(error: unknown): ErrorKind {
  if (error instanceof AdaApiError) {
    if (error.isOffline) return 'offline';
    if (error.code === 'app_update_required' || error.status === 426) return 'update';
    if (error.status === 408 || error.status === 504) return 'timeout';
    if (error.status === 429) return 'busy';
    if (error.status >= 500) return 'server';
    if (error.status === 401) return 'loggedOut';
    if (error.status === 403) return 'forbidden';
    if (error.status === 404 || error.status === 410) return 'notFound';
    if (error.status >= 400) return 'refused';
    return 'unknown';
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'timeout';
    if (error instanceof TypeError && /network/i.test(error.message)) return 'offline';
  }
  return 'unknown';
}

const logged = new WeakSet<object>();

// The raw detail, once per error, for the developer console only.
function logRaw(error: unknown): void {
  if (!__DEV__) return;
  if (typeof error === 'object' && error !== null) {
    if (logged.has(error)) return;
    logged.add(error);
  }
  console.warn('[error]', error instanceof AdaApiError ? `${error.status} ${error.code}: ${error.message}` : error);
}

// A plain, translated message for any thrown value; the raw detail goes to the dev log only.
export function errorText(error: unknown): ErrorText {
  logRaw(error);
  const kind = errorKind(error);
  return {
    message: t(MESSAGE[kind]),
    requestId: error instanceof AdaApiError ? error.requestId : null,
    offline: kind === 'offline',
    kind,
  };
}

// True for a round, evidence list or evidence file the server narrowed away from this caller.
export function isNotFound(error: unknown): boolean {
  return error instanceof AdaApiError && error.status === 404;
}
