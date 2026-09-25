/**
 * The chosen run's per-parcel change: its summary from `stats.parcels`, the
 * geojson that backs both the map layer and the table, and the class filter
 * they share. Fetched page by page only when the run's summary reports a parcel.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "@/api/client";
import type { Analysis, ParcelChangeClass, ParcelFeatureCollection, ParcelSummary } from "@/api/types";

import {
  filterParcelFeatures,
  filterParcelRows,
  loadParcelPages,
  parcelSummaryOf,
  toggleClassFilter,
  toMapCollection,
  toParcelRows,
  type ClassFilter,
  type ParcelPages,
  type ParcelRow,
} from "./parcelModel";
import type { LoadFailure, LoadStatus } from "./useChangeDetection";

export type Parcels = {
  /** Null when the run has no parcel stage output; the layer and panel are then hidden. */
  summary: ParcelSummary | null;
  status: LoadStatus;
  error: LoadFailure | null;
  reload: () => void;
  /** True when fewer rows loaded than the server counts; the table and map show a subset. */
  partial: boolean;
  /** The server's row count for the run once loaded, else null. */
  total: number | null;
  /** Every row of the run, unfiltered. */
  rows: ParcelRow[];
  /** Rows after the class filter. */
  shown: ParcelRow[];
  /** The map's collection after the class filter; null until it has loaded. */
  features: ParcelFeatureCollection | null;
  filter: ClassFilter;
  toggleFilter: (cls: ParcelChangeClass) => void;
  clearFilter: () => void;
  findRow: (key: string) => ParcelRow | null;
};

function toFailure(cause: unknown): LoadFailure {
  if (cause instanceof ApiError) return { message: cause.message, requestId: cause.requestId };
  return { message: cause instanceof Error ? cause.message : "", requestId: null };
}

export function useParcels(runId: string | null, analysis: Analysis | null): Parcels {
  const summary = useMemo(() => parcelSummaryOf(analysis?.stats), [analysis?.stats]);
  const enabled = runId !== null && summary !== null;

  // finished_at and the summary total change on a re-run, so a stale cache is never reused.
  const query = useQuery<ParcelPages, Error>({
    queryKey: [
      "analysis",
      runId,
      "parcels",
      "geojson",
      analysis?.finished_at ?? null,
      summary?.parcels_total ?? null,
    ],
    queryFn: ({ signal }) =>
      loadParcelPages((offset, limit) =>
        api.getAnalysisParcelsGeojson(runId as string, { offset, limit }, signal),
      ),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Keyed to the run, so switching runs starts unfiltered without an effect to reset it.
  const [chosen, setChosen] = useState<{ runId: string | null; cls: ClassFilter }>({
    runId: null,
    cls: null,
  });
  const filter = chosen.runId === runId ? chosen.cls : null;

  const data = enabled ? (query.data ?? null) : null;
  const rows = useMemo(() => toParcelRows(data?.collection), [data]);
  const shown = useMemo(() => filterParcelRows(rows, filter), [rows, filter]);
  const mapCollection = useMemo<ParcelFeatureCollection | null>(
    () => (data ? toMapCollection(data.collection) : null),
    [data],
  );
  const features = useMemo(
    () => (mapCollection ? filterParcelFeatures(mapCollection, filter) : null),
    [mapCollection, filter],
  );
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const findRow = useCallback((key: string) => byKey.get(key) ?? null, [byKey]);

  const toggleFilter = useCallback(
    (cls: ParcelChangeClass) =>
      setChosen((prev) => ({
        runId,
        cls: toggleClassFilter(prev.runId === runId ? prev.cls : null, cls),
      })),
    [runId],
  );
  const clearFilter = useCallback(() => setChosen({ runId, cls: null }), [runId]);

  const refetch = query.refetch;
  const reload = useCallback(() => void refetch(), [refetch]);

  const status: LoadStatus = !enabled
    ? "ready"
    : query.isError
      ? "error"
      : query.data
        ? "ready"
        : "loading";

  return {
    summary,
    status,
    error: enabled && query.isError ? toFailure(query.error) : null,
    reload,
    partial: data?.partial ?? false,
    total: data?.total ?? null,
    rows,
    shown,
    features,
    filter,
    toggleFilter,
    clearFilter,
    findRow,
  };
}
