import { AdaApiError } from './errors';

export type ErrorText = {
  /** The server's own message, or the thrown error's when the request never got an answer. */
  readonly message: string;
  /** The server log line this refers to, when the server issued one. */
  readonly requestId: string | null;
  readonly offline: boolean;
};

// The server's message, never a generic string; a support call can quote the request id.
export function errorText(error: unknown): ErrorText {
  if (error instanceof AdaApiError) {
    return { message: error.message, requestId: error.requestId, offline: error.isOffline };
  }
  if (error instanceof Error && error.message !== '') {
    return { message: error.message, requestId: null, offline: false };
  }
  return { message: String(error), requestId: null, offline: false };
}

// True for a round, evidence list or evidence file the server narrowed away from this caller.
export function isNotFound(error: unknown): boolean {
  return error instanceof AdaApiError && error.status === 404;
}
