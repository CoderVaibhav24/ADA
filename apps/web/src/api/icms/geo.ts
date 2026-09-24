/** `/api/icms/geo/*` — the locate and parcel suggestions for a point, and the admin boundary import. */

import type { components } from "@ada/api-types/ada-api";
import { authHeader } from "@/api/client";
import { notifySessionEnded } from "@/auth/oidc";
import { IcmsApiError, icmsRequest } from "./http";

/** Generated `LocateOut`. `source: "unavailable"` means the lookup failed; show nothing. */
export type Located = components["schemas"]["LocateOut"];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** The server's suggestion for a pin. A shape change is a thrown error, not a filled field. */
export async function locate(lat: number, lon: number, signal?: AbortSignal): Promise<Located> {
  const body = await icmsRequest("/api/icms/geo/locate", { query: { lat, lon }, signal });
  const raw =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;

  if (
    raw === null ||
    !isNullableString(raw.state) ||
    !isNullableString(raw.district) ||
    !isNullableString(raw.district_lgd) ||
    !isNullableString(raw.pincode) ||
    typeof raw.source !== "string"
  ) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: "The location suggestion response did not have the expected shape.",
    });
  }

  return {
    state: raw.state,
    district: raw.district,
    district_lgd: raw.district_lgd,
    pincode: raw.pincode,
    source: raw.source,
  };
}

/* ---- land record: parcel lookup and the boundary import -------------------- */

/** Generated `ParcelAtOut`; a scheme plot has `plot_no` and `sector` in place of khasra and village. */
export type ParcelLookup = components["schemas"]["ParcelAtOut"];

export const BOUNDARY_FOLDERS = ["zones", "villages", "parcels", "reserved"] as const;
export type BoundaryFolder = (typeof BOUNDARY_FOLDERS)[number];

export type FolderCounts = components["schemas"]["LayerCounts"];
/** Generated `BoundaryCounts`, partial: a folder the server did not mention is left out. */
export type BoundaryCounts = Partial<components["schemas"]["BoundaryCounts"]>;
export type PlacemarkIssue = components["schemas"]["PlacemarkIssue"];

/** Generated `BoundaryImportOut`, with the id as text. */
export type BoundaryImportResult = Omit<components["schemas"]["BoundaryImportOut"], "import_id" | "counts"> & {
  import_id: string | null;
  counts: BoundaryCounts;
};

/** Generated `BoundaryImportRow`, with the id as text and `imported_by` possibly absent. */
export type BoundaryImportRecord = Omit<
  components["schemas"]["BoundaryImportRow"],
  "id" | "imported_by" | "counts"
> & {
  id: string;
  imported_by: string | null;
  counts: BoundaryCounts;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Folders the server did not mention are left out rather than shown as zeros.
function readCounts(value: unknown): BoundaryCounts {
  if (!isRecord(value)) return {};
  const counts: BoundaryCounts = {};
  for (const folder of BOUNDARY_FOLDERS) {
    const row = value[folder];
    if (!isRecord(row)) continue;
    counts[folder] = {
      inserted: countOf(row.inserted),
      updated: countOf(row.updated),
      deactivated: countOf(row.deactivated),
      rejected: countOf(row.rejected),
    };
  }
  return counts;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Rejected or warned placemarks; a malformed row keeps what it can rather than failing the import.
function readIssues(value: unknown): PlacemarkIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    folder: typeof row.folder === "string" ? row.folder : "",
    index: countOf(row.index),
    name: nullableText(row.name),
    key: nullableText(row.key),
    reasons: Array.isArray(row.reasons)
      ? row.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  }));
}

function idText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** The land record under a point: zone, village, khasra or scheme plot, and ULPIN. */
export async function parcel(lat: number, lon: number, signal?: AbortSignal): Promise<ParcelLookup> {
  const body = await icmsRequest("/api/icms/geo/parcel", { query: { lat, lon }, signal });
  if (!isRecord(body) || typeof body.source !== "string") throw malformed("parcel lookup");
  const text = (key: string): string | null => {
    const value = body[key];
    if (typeof value === "number") return String(value);
    return typeof value === "string" ? value : null;
  };
  return {
    zone_cd: text("zone_cd"),
    zone_name: text("zone_name"),
    village_lgd: text("village_lgd"),
    village_name: text("village_name"),
    khasra_no: text("khasra_no"),
    ulpin: text("ulpin"),
    sector: text("sector"),
    plot_no: text("plot_no"),
    ward: text("ward"),
    source: body.source === "kml" ? "kml" : "none",
  };
}

function parseImport(body: unknown): BoundaryImportResult {
  if (!isRecord(body) || !isRecord(body.counts)) throw malformed("boundary import");
  return {
    counts: readCounts(body.counts),
    rejected: readIssues(body.rejected),
    warnings: readIssues(body.warnings),
    import_id: idText(body.import_id),
    filename: typeof body.filename === "string" ? body.filename : "",
    sha256: typeof body.sha256 === "string" ? body.sha256 : "",
    dry_run: body.dry_run === true,
  };
}

// The ICMS error envelope out of an XHR body, or a generic refusal naming the status.
function xhrError(xhr: XMLHttpRequest): IcmsApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(xhr.responseText);
  } catch {
    parsed = undefined;
  }
  if (isRecord(parsed) && isRecord(parsed.error)) {
    const error = parsed.error;
    if (typeof error.code === "string" && typeof error.message === "string") {
      return new IcmsApiError(xhr.status, {
        code: error.code,
        message: error.message,
        field: typeof error.field === "string" ? error.field : null,
        request_id: typeof error.request_id === "string" ? error.request_id : null,
      });
    }
  }
  return new IcmsApiError(xhr.status, {
    code: "unexpected_response",
    message: `The server returned ${xhr.status}.`,
    request_id: xhr.getResponseHeader("X-Request-ID"),
  });
}

/** Uploads one KML/KMZ over XHR, for upload progress; `dryRun` validates without writing. */
export async function importBoundaries(
  file: File,
  dryRun: boolean,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<BoundaryImportResult> {
  const headers = await authHeader();
  // No token means a headerless upload the server refuses; say so before the bytes go out.
  if (!("Authorization" in headers)) {
    notifySessionEnded();
    throw new IcmsApiError(401, { code: "not_authenticated", message: "Session expired." });
  }
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/icms/admin/geo/import${dryRun ? "?dry_run=true" : ""}`);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) notifySessionEnded();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(xhrError(xhr));
        return;
      }
      try {
        resolve(parseImport(JSON.parse(xhr.responseText)));
      } catch (error) {
        reject(error instanceof IcmsApiError ? error : malformed("boundary import"));
      }
    };
    xhr.onerror = () => {
      reject(new IcmsApiError(0, { code: "network_unreachable", message: "The server could not be reached." }));
    };
    xhr.onabort = () => {
      reject(new DOMException("The upload was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** The last twenty boundary imports, newest first. */
export async function listBoundaryImports(signal?: AbortSignal): Promise<BoundaryImportRecord[]> {
  const body = await icmsRequest("/api/icms/admin/geo/imports", { signal });
  // Either a bare list or `{ items: [...] }`; anything else is a shape change.
  const rows = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.items) ? body.items : null;
  if (rows === null) throw malformed("boundary import history");
  return rows.filter(isRecord).map((row) => ({
    id: idText(row.id) ?? "",
    filename: typeof row.filename === "string" ? row.filename : "",
    sha256: typeof row.sha256 === "string" ? row.sha256 : "",
    imported_by: nullableText(row.imported_by),
    imported_by_name: nullableText(row.imported_by_name),
    imported_at: typeof row.imported_at === "string" ? row.imported_at : "",
    counts: readCounts(row.counts),
  }));
}

// Assumed to match the import route's `require_permission`; confirm once the backend lands.
export const BOUNDARY_IMPORT_PERMISSION = "zone.manage";
