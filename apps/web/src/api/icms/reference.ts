/**
 * The reference data the register's filter row is built from.
 *
 * The "Complaint Type" dropdown is not a hardcoded list. `icms_code_value` is
 * the vocabulary table and it carries `label_hi` beside `label`, so the same
 * call serves both languages — which is why the options are fetched rather than
 * enumerated in the frontend, where a Hindi label could not follow them.
 *
 * Both endpoints are ordinary ICMS collections, so both answer the same `Page`
 * envelope and both are capped at 200 rows a page. Neither vocabulary is
 * anywhere near that, and `size` is pinned to the ceiling so the dropdowns are
 * one request rather than a paging problem of their own.
 */

import type { components } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";
export type CodeValue = components["schemas"]["CodeValueOut"];
export type Zone = components["schemas"]["ZoneOut"];
export const COMPLAINT_TYPE_DOMAIN = "complaint_type";

const REFERENCE_PAGE_SIZE = 200;

function itemsOf(value: unknown): unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  const items: unknown = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : null;
}

function hasStringField(value: unknown, field: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[field] === "string"
  );
}

function narrow<T>(body: unknown, field: string, what: string): T[] {
  const items = itemsOf(body);
  if (!items || !items.every((item) => hasStringField(item, field))) {
    throw new IcmsApiError(200, {
      code: "malformed_page",
      message: `The ${what} response did not have the expected shape.`,
    });
  }
  return items as T[];
}

export async function listCodeValues(
  domain: string,
  signal: AbortSignal,
): Promise<CodeValue[]> {
  const body = await icmsRequest("/api/icms/code-values", {
    query: {
      domain: [domain],
      active: true,
      size: REFERENCE_PAGE_SIZE,
      sort: "sort_order",
    },
    signal,
  });
  return narrow<CodeValue>(body, "code", "code values");
}

export async function listZones(signal: AbortSignal): Promise<Zone[]> {
  const body = await icmsRequest("/api/icms/zones", {
    query: { active: true, size: REFERENCE_PAGE_SIZE, sort: "zone_cd" },
    signal,
  });
  return narrow<Zone>(body, "zone_cd", "zones");
}
