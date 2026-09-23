/**
 * One description of a failure, from either of the two transports this screen
 * talks to.
 *
 * The ICMS routes answer the rich envelope and throw `IcmsApiError`, whose
 * `request_id` is in the BODY. The older analysis routes answer FastAPI's
 * `{"detail": ...}` and throw `ApiError`, which reads the id off the
 * `X-Request-ID` response header. Both ids are the value in the server's own
 * log line, and no section should have to know which error it caught in order
 * to print it.
 *
 * Its own module rather than a function in `parts.tsx` so that file exports
 * components only, which is what keeps fast refresh working.
 */

import { ApiError } from "@/api/client";
import { IcmsApiError } from "@/api/icms/http";

export type ErrorDescription = { message: string | null; requestId: string | null };

/** The message and the correlation id, whichever transport failed. */
export function describeError(cause: unknown): ErrorDescription {
  if (cause instanceof IcmsApiError) {
    return { message: cause.message, requestId: cause.requestId };
  }
  if (cause instanceof ApiError) {
    return { message: cause.message, requestId: cause.requestId };
  }
  return { message: cause instanceof Error ? cause.message : null, requestId: null };
}
