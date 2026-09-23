/**
 * The transport for `/api/icms/*`.
 *
 * Separate from `src/api/client.ts` on purpose. The older console routes answer
 * FastAPI's default `{"detail": ...}` and `client.ts` reads that shape; the ICMS
 * routes answer a different, richer envelope:
 *
 *     {"error": {"code", "message", "field", "allowed", "request_id"}}
 *
 * (services/api/app/errors.py). `code` is stable and branchable, `field` names
 * the parameter at fault, `allowed` carries the legal values when the refusal is
 * a whitelist, and `request_id` is the value in the server log line — which is
 * the difference between "it broke" and a support call that can be answered.
 * Flattening that into a string, as `client.ts` does, throws all four away.
 *
 * Two other things this does that `client.ts` does not:
 *
 *   - it takes an `AbortSignal`, so a superseded request is cancelled rather
 *     than raced. The legacy Angular estate has no cancellation at all and lets
 *     the last-*resolved* response win, so a fast empty page can overwrite the
 *     rows a slower earlier request is still fetching;
 *   - it never hands `JSON.parse`'s `any` to a caller. The body comes back as
 *     `unknown` and each endpoint narrows it with a runtime guard, so a proxy
 *     error page or a shape change is a thrown error at the boundary instead of
 *     a table of `undefined`.
 */

import { authHeader } from "@/api/client";
import { notifySessionEnded } from "@/auth/oidc";
export type IcmsErrorBody = {
  code: string;
  message: string;
  field?: string | null;
  allowed?: string[] | null;
  request_id?: string | null;
};

export class IcmsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | null;
  readonly allowed: readonly string[] | null;
  readonly requestId: string | null;

  constructor(status: number, body: IcmsErrorBody) {
    super(body.message);
    this.name = "IcmsApiError";
    this.status = status;
    this.code = body.code;
    this.field = body.field ?? null;
    this.allowed = body.allowed ?? null;
    this.requestId = body.request_id ?? null;
  }
}

export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | null
  | undefined;

export type QueryParams = Readonly<Record<string, QueryValue>>;

export function toSearchParams(params: QueryParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number)[]) {
        const text = String(item);
        if (text !== "") search.append(key, text);
      }
      continue;
    }
    const text = String(value as string | number | boolean);
    if (text !== "") search.append(key, text);
  }
  search.sort();
  return search;
}

function isErrorBody(value: unknown): value is { error: IcmsErrorBody } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error: unknown = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

export type IcmsRequestInit = {
  query?: QueryParams;
  signal?: AbortSignal;
  method?: string;
  body?: unknown;
};

export async function icmsRequest(
  path: string,
  init: IcmsRequestInit = {},
): Promise<unknown> {
  const { query, signal, method = "GET", body } = init;
  const search = query ? toSearchParams(query).toString() : "";
  const url = search ? `${path}?${search}` : path;

  // A FormData body writes its own `multipart/form-data; boundary=…`. Naming a
  // Content-Type here would overwrite it without the boundary, and the upload
  // would reach the server unparseable.
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = { ...(await authHeader()) };
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal,
      body:
        body === undefined
          ? undefined
          : multipart
            ? (body as FormData)
            : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new IcmsApiError(0, {
      code: "network_unreachable",
      message: "The server could not be reached.",
    });
  }

  if (response.status === 401) {
    notifySessionEnded();
  }

  const text = response.status === 204 ? "" : await response.text();
  const parsed = text === "" ? undefined : parseJson(text);

  if (!response.ok) {
    if (isErrorBody(parsed)) throw new IcmsApiError(response.status, parsed.error);
    throw new IcmsApiError(response.status, {
      code: "unexpected_response",
      message: `The server returned ${response.status}.`,
      request_id: response.headers.get("X-Request-ID"),
    });
  }

  return parsed;
}
