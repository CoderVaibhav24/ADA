/**
 * `GET /api/icms/cases` — the Complaints register.
 *
 * Every type here is the generated one. `CaseRow`, the `Page` envelope and the
 * whole query bag come from `src/api/generated/ada-api.ts`, which is emitted by
 * `npm run api:types` from FastAPI's own document. Nothing in this file restates
 * a field name that the server already publishes, so renaming a column in
 * `case_schemas.py` breaks the build here instead of rendering an empty cell.
 */

import type { components, operations } from "@/api/generated/ada-api";
import { IcmsApiError, icmsRequest } from "./http";
export type CaseRow = components["schemas"]["CaseRow"];
export type CasePage = components["schemas"]["Page_CaseRow_"];
export type CaseListQuery = NonNullable<
  operations["list_cases_api_icms_cases_get"]["parameters"]["query"]
>;
export const CASE_SORT_KEYS = [
  "case_ref",
  "complainant_name",
  "complaint_type_cd",
  "khasra_no",
  "priority",
  "property_address",
  "raised_at",
  "stage_no",
  "status",
  "ulpin",
  "updated_at",
  "zone_cd",
] as const;

export type CaseSortKey = (typeof CASE_SORT_KEYS)[number];
export const CASE_DEFAULT_SORT = "-raised_at";

export function isCaseSortKey(value: string): value is CaseSortKey {
  return (CASE_SORT_KEYS as readonly string[]).includes(value);
}

export const CASE_STATUSES = [
  "raised",
  "assigned",
  "under_inspection",
  "inspection_submitted",
  "resurvey_requested",
  "verified",
  "handed_over",
  "confirmed",
  "notice_issued",
  "closed",
  "rejected",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_PRIORITIES = ["high", "medium", "low"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const MAX_PAGE_SIZE = 200;

function isCasePage(value: unknown): value is CasePage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    typeof page.page === "number" &&
    typeof page.size === "number" &&
    typeof page.total === "number" &&
    typeof page.pages === "number" &&
    typeof page.sort === "string"
  );
}

export async function listCases(
  query: CaseListQuery,
  signal: AbortSignal,
): Promise<CasePage> {
  const body = await icmsRequest("/api/icms/cases", { query, signal });
  if (!isCasePage(body)) {
    throw new IcmsApiError(200, {
      code: "malformed_page",
      message: "The register response did not have the expected shape.",
    });
  }
  return body;
}
