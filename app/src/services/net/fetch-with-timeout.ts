/*
 * One shared timeout for every network call this app makes.
 *
 * A field build can end up pointed at a host that never refuses the TCP
 * connect - it just hangs, and a hang is indistinguishable, from the caller's
 * side, from the app being frozen. Every `fetch` in `src/services/` goes
 * through `fetchWithTimeout` so that "no response" always resolves into the
 * same failure paths a refused or errored response already takes.
 *
 * `withTimeoutSignal` composes with a caller-supplied `AbortSignal`: aborting
 * either one aborts the request, and the timer is always cleared so it never
 * outlives the call it was guarding.
 */

// Every timeout in the app, in one place, so none of them are a scattered literal.
export const TIMEOUT_MS = {
  /** The issuer lookup, the token POST and the refresh (`services/auth/`). */
  auth: 15_000,
  /** `authenticatedRequest` / `apiRequest`, unless a call overrides it. */
  apiDefault: 20_000,
  /** Evidence uploads: photos are large and the field connection is often poor. */
  evidenceUpload: 120_000,
} as const;

/*
 * Thrown when the timer fires first. Kept distinct from a caller's own
 * `AbortError` (`name === 'AbortError'`) so the two are never confused for one
 * another - a caller that cancels its own request still sees `AbortError`; a
 * timeout is always this.
 */
export class FetchTimeoutError extends Error {
  constructor(ms: number) {
    super(`The request timed out after ${ms}ms.`);
    this.name = 'TimeoutError';
  }
}

// An AbortSignal that fires after `ms`, or when `external` does - whichever is first.
export function withTimeoutSignal(
  ms: number,
  external?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const controller = new AbortController();
  let didTimeOut = false;

  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, ms);

  const onExternalAbort = (): void => controller.abort();
  if (external !== undefined) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }

  const clear = (): void => {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  };

  return { signal: controller.signal, timedOut: () => didTimeOut, clear };
}

/*
 * `fetch`, aborted after `ms` if neither a response nor the caller's own
 * `init.signal` arrives first. A timeout surfaces as `FetchTimeoutError`,
 * never as the caller's own `AbortError`.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const { signal, timedOut, clear } = withTimeoutSignal(ms, init.signal ?? undefined);
  try {
    return await fetch(input, { ...init, signal });
  } catch (cause) {
    if (timedOut()) throw new FetchTimeoutError(ms);
    throw cause;
  } finally {
    clear();
  }
}
