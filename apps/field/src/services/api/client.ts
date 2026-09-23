import { getAccessToken, refreshSession, signOutAfterRejectedRefresh } from '@/services/auth/session';
import { env } from '@/services/config/env';
import { fetchWithTimeout, TIMEOUT_MS } from '@/services/net/fetch-with-timeout';

import { AdaApiError, isErrorEnvelope, isNotifyErrorEnvelope, offlineError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';

/*
 * The only place this app calls `fetch` against the API.
 *
 * What it owns:
 *   - the base URL, from the build's `extra.ada.apiBaseUrl`;
 *   - the bearer, taken from the session on every request rather than held;
 *   - one 401 recovery: refresh once, replay once, and if that fails sign out.
 *     A second 401 after a fresh token is the server saying no, not the clock;
 *   - the idempotency key, in the body where the server reads it and in a header
 *     for anything in between;
 *   - the `/api/icms/*` error envelope, kept whole.
 *
 * Screens do not call this. Services do (code-standards.md rule 1).
 */
export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | null
  | undefined;

export type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** Overrides the default `TIMEOUT_MS.apiDefault` (20s) ceiling for this call. */
  readonly timeoutMs?: number;
  /** Minted at user action time by `idempotency.ts`. Required for every write. */
  readonly idempotencyKey?: string;
  /** Answer null instead of throwing on this status. For endpoints a role may not hold. */
  readonly nullOn?: readonly number[];
};

// Builds a stable query string; sorted so two identical queries cache as one.
export function toSearchParams(query: Readonly<Record<string, QueryValue>>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number)[]) {
        const text = String(item);
        if (text !== '') search.append(key, text);
      }
      continue;
    }
    const text = String(value as string | number | boolean);
    if (text !== '') search.append(key, text);
  }
  search.sort();
  return search;
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

// The request body, with the idempotency key merged in where the server reads it.
function buildBody(options: RequestOptions): string | undefined {
  if (options.body === undefined && options.idempotencyKey === undefined) return undefined;

  if (options.idempotencyKey === undefined) return JSON.stringify(options.body);

  const base =
    options.body !== null && typeof options.body === 'object'
      ? (options.body as Record<string, unknown>)
      : {};
  return JSON.stringify({ ...base, idempotency_key: options.idempotencyKey });
}

async function send(
  baseUrl: string,
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const search = options.query === undefined ? '' : toSearchParams(options.query).toString();
  const url = `${baseUrl}${path}${search === '' ? '' : `?${search}`}`;
  const body = buildBody(options);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;

  return fetchWithTimeout(
    url,
    {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    },
    options.timeoutMs ?? TIMEOUT_MS.apiDefault,
  );
}

/*
 * One request, typed by the caller against the generated schema.
 *
 * The caller passes the type it expects from `generated/ada-api.ts`; nothing here
 * invents a shape. The body arrives as `unknown` and is returned as `T` at the
 * single point where the contract is asserted, so a proxy error page is a thrown
 * error at the boundary rather than a screen of `undefined`.
 */
export function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return authenticatedRequest<T>(env.apiBaseUrl, path, options);
}

// The same request against another service that takes the session's bearer, such as ada-notify.
export async function authenticatedRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await send(baseUrl, path, options, token);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw offlineError();
  }

  /*
   * 401 recovery, once. A refresh that fails because there is no network leaves
   * the session alone and the caller sees an offline error — the surveyor is not
   * signed out in a field (Architecture.md §5).
   */
  if (response.status === 401) {
    const outcome = await refreshSession();
    if (outcome === 'offline') throw offlineError();
    if (outcome !== 'refreshed') {
      await signOutAfterRejectedRefresh();
      throw new AdaApiError(401, {
        code: 'session_expired',
        message: 'Your session has ended. Sign in again to continue.',
      });
    }

    const retryToken = await getAccessToken();
    try {
      response = await send(baseUrl, path, options, retryToken);
    } catch {
      throw offlineError();
    }

    if (response.status === 401) {
      await signOutAfterRejectedRefresh();
      throw new AdaApiError(401, {
        code: 'session_expired',
        message: 'Your session has ended. Sign in again to continue.',
      });
    }
  }

  if (options.nullOn?.includes(response.status) === true) {
    return null as T;
  }

  const text = response.status === 204 ? '' : await response.text();
  const parsed = text === '' ? undefined : parseJson(text);

  if (!response.ok) {
    if (isErrorEnvelope(parsed)) throw new AdaApiError(response.status, parsed.error);
    if (isNotifyErrorEnvelope(parsed)) {
      throw new AdaApiError(response.status, {
        code: parsed.error,
        message: parsed.detail,
        request_id: response.headers.get('X-Request-ID'),
      });
    }
    throw new AdaApiError(response.status, {
      code: 'unexpected_response',
      message: `The server returned ${response.status}.`,
      request_id: response.headers.get('X-Request-ID'),
    });
  }

  return parsed as T;
}
