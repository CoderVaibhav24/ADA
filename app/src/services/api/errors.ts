/*
 * The error shape `/api/icms/*` answers with (backend/api/app/errors.py):
 *
 *     {"error": {"code", "message", "field", "allowed", "request_id"}}
 *
 * All five parts are kept. `code` is stable and branchable, `field` names the
 * parameter at fault, `allowed` carries the legal values when the refusal is a
 * whitelist, and `request_id` is the value in the server log line — the
 * difference between "it broke" and a support call somebody can answer.
 * Flattening this into a string throws all four away.
 */
export type AdaErrorBody = {
  code: string;
  message: string;
  field?: string | null;
  allowed?: string[] | null;
  request_id?: string | null;
};

export class AdaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | null;
  readonly allowed: readonly string[] | null;
  readonly requestId: string | null;

  constructor(status: number, body: AdaErrorBody) {
    super(body.message);
    this.name = 'AdaApiError';
    this.status = status;
    this.code = body.code;
    this.field = body.field ?? null;
    this.allowed = body.allowed ?? null;
    this.requestId = body.request_id ?? null;
  }

  /** True when the request never reached the server. Not a failure of the user's action. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

export function isErrorEnvelope(value: unknown): value is { error: AdaErrorBody } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

// ada-notify's flat `{error, detail}` shape; `detail` is the server's sentence.
export function isNotifyErrorEnvelope(value: unknown): value is { error: string; detail: string } {
  if (typeof value !== 'object' || value === null) return false;
  const bag = value as { error?: unknown; detail?: unknown };
  return typeof bag.error === 'string' && typeof bag.detail === 'string' && bag.detail !== '';
}

// The error used when the request never left the handset.
export function offlineError(): AdaApiError {
  return new AdaApiError(0, {
    code: 'network_unreachable',
    message: 'The server could not be reached. This will be retried when you are back in coverage.',
  });
}
