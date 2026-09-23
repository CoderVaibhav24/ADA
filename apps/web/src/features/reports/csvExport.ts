/**
 * The state around ONE run of `exportRegisterCsv`: whether it is running, what
 * it has fetched so far, and how it is cancelled.
 *
 * The writing itself stays in `components/data-table/export-rows.ts`. This is
 * the ref-held `AbortController` and the announced progress note that all three
 * registers already keep beside their Export button, written once because this
 * screen has three of them on one page — a superseded export MUST die, or two
 * files race to the save dialog.
 *
 * Its own module rather than part of `exportRow.tsx` so that file exports
 * components only, which is what keeps fast refresh working.
 */

import { useCallback, useRef, useState } from "react";
import {
  exportRegisterCsv,
  type ExportColumn,
  type ExportPageFetcher,
} from "@/components/data-table/export-rows";
import { describeError } from "./errors";
import { useExportLabels } from "./reportLabels";

/** The value a single-select filter carries when the officer has chosen nothing. */
export const ANY = "__any__";

/** The inverse of the date picker's `Date`: `toISOString()` alone shifts the day. */
export function toIsoDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export type CsvExport<TRow> = {
  exporting: boolean;
  /** Progress while it runs, the outcome when it stops. Announced, never thrown away. */
  note: string | null;
  run: (options: {
    filename: string;
    columns: readonly ExportColumn<TRow>[];
    fetchPage: ExportPageFetcher<TRow>;
  }) => Promise<void>;
};

/** One register's export, with its progress, its cancellation and its outcome. */
export function useCsvExport<TRow>(): CsvExport<TRow> {
  const labels = useExportLabels();
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback<CsvExport<TRow>["run"]>(
    async ({ filename, columns, fetchPage }) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setExporting(true);
      setNote(null);
      try {
        const result = await exportRegisterCsv<TRow>({
          filename,
          columns,
          fetchPage,
          onProgress: (done, total) => {
            setNote(labels.progress(String(done), String(total)));
          },
          signal: controller.signal,
        });
        setNote(result.truncated ? labels.truncated(String(result.rows)) : null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setNote(describeError(cause).message ?? labels.failed);
      } finally {
        setExporting(false);
      }
    },
    [labels],
  );

  return { exporting, note, run };
}
