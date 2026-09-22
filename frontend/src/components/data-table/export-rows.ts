/**
 * Export, from the server, through the active filter and sort.
 *
 * The legacy export is the anti-pattern this is written against: it hands the
 * in-memory array straight to a spreadsheet writer, so the file contains the
 * *API field names* rather than the grid's columns, in API order rather than
 * the officer's, and it ignores the filter and the sort entirely. An officer
 * who filtered to eleven high-priority cases and pressed Export got the whole
 * table.
 *
 * So this does three things differently:
 *
 *   1. It pages the **server** with exactly the query the grid is showing —
 *      same filters, same sort, only a larger `size`. What comes out is what
 *      was on screen, continued.
 *   2. It writes the **visible columns, in their visible order**, using each
 *      column's own export projection. A chip becomes its text, a formatted
 *      date becomes an ISO date, an em dash for "no value" becomes empty.
 *   3. It is cancellable and it reports progress, because a register can run to
 *      tens of thousands of rows and a silent five-second freeze reads as a
 *      crash.
 */

export type ExportColumn<TRow> = {
  id: string;
  /** Already translated. This is the header row the officer reads. */
  header: string;
  value: (row: TRow) => string;
};

export type ExportPageFetcher<TRow> = (
  page: number,
  size: number,
  signal: AbortSignal,
) => Promise<{ items: readonly TRow[]; total: number }>;

/**
 * Cells that a spreadsheet would execute rather than display.
 *
 * Excel and LibreOffice treat a leading `=`, `+`, `-`, `@`, tab or carriage
 * return as the start of a formula, so a complainant who gives their name as
 * `=cmd|...` turns an exported register into a command on the machine of
 * whoever opens it. Prefixing a single quote neutralises it and is stripped on
 * display. This matters more here than in most apps: the text columns are
 * free-text fields filled in from telephone calls by members of the public.
 */
const RISKY_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  const safe = RISKY_PREFIX.test(value) ? `'${value}` : value;
  // Quote whenever the value could otherwise break the row apart. Doubling an
  // embedded quote is the RFC 4180 escape.
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<TRow>(
  rows: readonly TRow[],
  columns: readonly ExportColumn<TRow>[],
): string {
  const lines = [columns.map((column) => escapeCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(","));
  }
  // CRLF: Excel on Windows is the overwhelmingly likely consumer in a
  // development authority, and it is the line ending RFC 4180 specifies.
  return lines.join("\r\n");
}

/** Hand a blob to the browser's save dialog. */
function save(filename: string, body: string): void {
  // The BOM is not optional. Excel opens a UTF-8 CSV as the system code page
  // unless one is present, and every Devanagari name in the file becomes
  // mojibake — which on a bilingual register is most of the file.
  const blob = new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked late: Safari has not finished reading the blob when click()
  // returns, and revoking synchronously saves an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ExportRegisterOptions<TRow> = {
  filename: string;
  columns: readonly ExportColumn<TRow>[];
  fetchPage: ExportPageFetcher<TRow>;
  /** Rows per request. The API's ceiling is 200. */
  pageSize?: number;
  /**
   * A hard stop. A browser building a 200 MB string is a browser that stops
   * responding, and an export that large wants a server-side job instead.
   */
  maxRows?: number;
  onProgress?: (fetched: number, total: number) => void;
  signal?: AbortSignal;
};

export type ExportResult = {
  rows: number;
  total: number;
  /** True when `maxRows` stopped it short, so the UI can say so. */
  truncated: boolean;
};

export async function exportRegisterCsv<TRow>({
  filename,
  columns,
  fetchPage,
  pageSize = 200,
  maxRows = 20_000,
  onProgress,
  signal,
}: ExportRegisterOptions<TRow>): Promise<ExportResult> {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  signal?.addEventListener("abort", abort);

  try {
    const collected: TRow[] = [];
    let page = 1;
    let total = 0;

    for (;;) {
      const result = await fetchPage(page, pageSize, controller.signal);
      total = result.total;
      collected.push(...result.items);
      onProgress?.(collected.length, total);

      if (result.items.length < pageSize) break;
      if (collected.length >= Math.min(total, maxRows)) break;
      page += 1;
    }

    const truncated = collected.length > maxRows;
    const rows = truncated ? collected.slice(0, maxRows) : collected;
    save(filename, toCsv(rows, columns));
    return { rows: rows.length, total, truncated };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
