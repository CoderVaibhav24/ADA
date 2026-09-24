/**
 * Everything the Change Detection screen fetches, and every state it can be in
 * while fetching it.
 *
 * It writes into the SAME zustand store `components/MapView` reads, rather than
 * keeping a second copy: the map draws from `rasters`, `analyses`, `features`
 * and `redZones`, so a private cache here would be a map showing one thing and
 * a panel listing another.
 *
 * It deliberately does NOT go through `state/actions.ts`. Those helpers flatten
 * every failure into a six-second `globalError` string, which throws away the
 * status and the `X-Request-ID` — and an officer has to be able to quote an id.
 *
 * Four things that look like state are DERIVED during render rather than
 * assigned from an effect: which run is selected, how many rows are shown, and
 * both load statuses. Each is a pure function of what has arrived, so storing
 * it would mean a second render to correct itself every time the data moved —
 * and a chance for the two to disagree in between.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, ApiError, getRuntime, restoreRaster as requestRestore } from "@/api/client";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";
import type { AnalysisMode, Id, Raster, ReviewStatus } from "@/api/types";
import { useStore } from "@/state/store";
import type { MlRuntime } from "@/upload/types";

import {
  boundDetections,
  comparableAnalyses,
  DETECTION_PAGE,
  filterDetections,
  isRetryingRun,
  runErrorText,
  sid,
  sortDetections,
  toComparisonPair,
  toDetectionRows,
  type BoundedDetections,
  type ComparisonPair,
  type DetectionRow,
} from "./model";

export type LoadStatus = "loading" | "ready" | "error";

export type LoadFailure = {
  message: string;
  /** The value in the server's log line. Null when the request never landed. */
  requestId: string | null;
};

/** Poll cadence while a run is queued or running, matching the console's. */
const ANALYSIS_POLL_MS = 2000;
/** Poll cadence while any flight is still being ingested. */
const RASTER_POLL_MS = 2000;
/** Server-side states that move on their own; another tab's "uploading" row is not one of them. */
const POLLED_STATUSES: ReadonlySet<Raster["status"]> = new Set([
  "processing",
  "restoring",
  "failed_retryable",
]);

export const IMAGERY_WRITE = "imagery.write";
export const IMAGERY_RUN = "imagery.run";

// Advisory like every capability gate: it hides the button, and ada-api still enforces the permission.
function useHasPermission(code: string): boolean {
  const { data } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: 30_000,
  });
  return (data?.permissions ?? []).includes(code);
}

// ml-worker's tier for the run-button chip; a failed probe hides the chip rather than alarming anyone.
export function useRuntime(): MlRuntime | null {
  const { data } = useQuery<MlRuntime, Error>({
    queryKey: ["ml", "runtime"],
    queryFn: () => getRuntime(),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? null;
}

// Covers a reload and a closed tab while chunks are in flight, as NoticeCreate does for a dirty form.
export function useBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);
}

/** Upload and Delete of flights. */
export function useCanWriteImagery(): boolean {
  return useHasPermission(IMAGERY_WRITE);
}

/** Starting a change-detection run. */
export function useCanRunImagery(): boolean {
  return useHasPermission(IMAGERY_RUN);
}

function toFailure(cause: unknown, fallback: string): LoadFailure {
  if (cause instanceof ApiError) {
    return { message: cause.message, requestId: cause.requestId };
  }
  return { message: cause instanceof Error ? cause.message : fallback, requestId: null };
}

export type RunOption = {
  id: string;
  referenceDate: string | null;
  currentDate: string | null;
};

export type ChangeDetection = {
  /* ---- project ---- */
  projects: { id: string; name: string }[];
  projectId: string | null;
  projectName: string;
  selectProject: (id: string) => void;

  /* ---- the run being drawn ---- */
  runs: RunOption[];
  runId: string | null;
  selectRun: (id: string) => void;
  pair: ComparisonPair | null;
  /** A run that has not finished — the map is empty and the screen says why. */
  pendingRun: { stage: string | null; percent: number } | null;
  /** Any run still queued or running, whether or not another is on screen. */
  activeRun: { stage: string | null; percent: number } | null;
  /** Starts a run of T1 against T2; the screen switches to it once it finishes. */
  startRun: (t1: Id, t2: Id, mode: AnalysisMode) => Promise<void>;
  failedRun: string | null;
  /** A failed run ml-worker will requeue ("retryable:"); shown as retrying, not failed. */
  retryingRun: string | null;

  /* ---- detections ---- */
  rows: DetectionRow[];
  bounded: BoundedDetections;
  totalCount: number;
  showMore: () => void;
  query: string;
  setQuery: (value: string) => void;

  /* ---- selection ---- */
  selected: DetectionRow | null;
  /** Any row of the run by key, whether or not the search filter shows it. */
  findRow: (key: string) => DetectionRow | null;
  select: (key: string | null) => void;

  /* ---- review ---- */
  review: (row: DetectionRow, status: ReviewStatus) => Promise<void>;
  reviewing: boolean;
  reviewError: LoadFailure | null;

  /* ---- status ---- */
  /* ---- imagery ---- */
  /** Re-reads flights and runs without the full-screen reload. */
  refreshImagery: () => Promise<void>;
  /** Puts a just-uploaded flight in the store at once, so its row and the polling start now. */
  adoptUpload: (raster: Raster) => void;
  /** Removes the flight and every run built on it, then clears a selection that used it. */
  deleteRaster: (id: Id) => Promise<void>;
  /** Asks for an archived flight back from cold storage; the row turns to restoring. */
  restoreRaster: (id: Id) => Promise<void>;
  /** The last flight poll failed; the next tick retries. */
  rasterPollFailed: boolean;

  status: LoadStatus;
  error: LoadFailure | null;
  reload: () => void;
  detectionsStatus: LoadStatus;
  detectionsError: LoadFailure | null;
  reloadDetections: () => void;
};

// ownUploadId is this tab's running upload, the only "uploading" row worth polling for.
export function useChangeDetection(ownUploadId: string | null = null): ChangeDetection {
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const projectId = useStore((s) => s.currentProjectId);
  const rasters = useStore((s) => s.rasters);
  const analyses = useStore((s) => s.analyses);
  const features = useStore((s) => s.features);

  const [error, setError] = useState<LoadFailure | null>(null);
  /** The project whose imagery, runs and zones have actually landed. */
  const [loaded, setLoaded] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [featuresToken, setFeaturesToken] = useState(0);
  /** Keyed by run: a failure against run 7 must not colour run 8. */
  const [featuresError, setFeaturesError] = useState<{
    runId: string;
    failure: LoadFailure;
  } | null>(null);

  const [chosenRunId, setChosenRunId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState({ key: "", count: DETECTION_PAGE });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<LoadFailure | null>(null);
  const [rasterPollFailed, setRasterPollFailed] = useState(false);

  // A monotonic guard instead of AbortSignal: `api/client.ts` takes no signal,
  // so a superseded load is ignored on arrival rather than cancelled in flight.
  const generation = useRef(0);

  /* ---------------------------------------------------------- the projects */

  useEffect(() => {
    let live = true;
    api
      .listProjects()
      .then((list) => {
        if (live) useStore.getState().setProjects(list);
      })
      .catch((cause: unknown) => {
        if (live) setError(toFailure(cause, "The projects could not be loaded."));
      });
    return () => {
      live = false;
    };
  }, [reloadToken]);

  /* ------------------------------------ the project's imagery and its runs */

  useEffect(() => {
    if (!projectsLoaded || !projectId) return;
    const generationAtStart = ++generation.current;

    void Promise.all([
      api.listRasters(projectId),
      api.listAnalyses(projectId),
      api.listRedZones(projectId),
    ])
      .then(([nextRasters, nextAnalyses, nextZones]) => {
        if (generation.current !== generationAtStart) return;
        const store = useStore.getState();
        store.setRasters(nextRasters);
        store.setAnalyses(nextAnalyses);
        store.setRedZones(nextZones);
        setError(null);
        setLoaded(projectId);
      })
      .catch((cause: unknown) => {
        if (generation.current !== generationAtStart) return;
        setError(toFailure(cause, "The project's imagery could not be loaded."));
      });
  }, [projectId, projectsLoaded, reloadToken]);

  const status: LoadStatus = error
    ? "error"
    : !projectsLoaded
      ? "loading"
      : !projectId || loaded === projectId
        ? "ready"
        : "loading";

  /* --------------------------------------------------------------- polling */

  // Comma-joined so the dependency is a primitive; a fresh array every render
  // would restart the interval on every render.
  const activeRunIds = analyses
    .filter((a) => a.status === "queued" || a.status === "running" || isRetryingRun(a))
    .map((a) => sid(a.id))
    .join(",");

  useEffect(() => {
    if (!projectId || activeRunIds === "") return;
    const timer = window.setInterval(() => {
      void api
        .listAnalyses(projectId)
        .then((list) => {
          if (useStore.getState().currentProjectId === projectId) {
            useStore.getState().setAnalyses(list);
          }
        })
        // A dropped poll is retried on the next tick; the screen still shows the
        // last good progress, and an alert per failed poll is noise.
        .catch(() => undefined);
    }, ANALYSIS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, activeRunIds]);

  const processingRasterIds = rasters
    .filter(
      (r) =>
        POLLED_STATUSES.has(r.status) ||
        (r.status === "uploading" && ownUploadId !== null && sid(r.id) === ownUploadId),
    )
    .map((r) => sid(r.id))
    .join(",");

  useEffect(() => {
    if (!projectId || processingRasterIds === "") return;
    const timer = window.setInterval(() => {
      void api
        .listRasters(projectId)
        .then((list) => {
          setRasterPollFailed(false);
          if (useStore.getState().currentProjectId === projectId) {
            useStore.getState().setRasters(list);
          }
        })
        .catch(() => setRasterPollFailed(true));
    }, RASTER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, processingRasterIds]);

  const refreshImagery = useCallback(async () => {
    if (!projectId) return;
    const [nextRasters, nextAnalyses] = await Promise.all([
      api.listRasters(projectId),
      api.listAnalyses(projectId),
    ]);
    const store = useStore.getState();
    if (store.currentProjectId !== projectId) return;
    store.setRasters(nextRasters);
    store.setAnalyses(nextAnalyses);
  }, [projectId]);

  const adoptUpload = useCallback(
    (raster: Raster) => {
      const store = useStore.getState();
      if (sid(raster.project_id) !== store.currentProjectId) return;
      if (!store.rasters.some((r) => sid(r.id) === sid(raster.id))) {
        store.setRasters([...store.rasters, raster]);
      }
      void refreshImagery().catch(() => setRasterPollFailed(true));
    },
    [refreshImagery],
  );

  /* ------------------------------------------------------------- which run */

  const runs = useMemo(() => comparableAnalyses(analyses), [analyses]);

  // Derived, not stored: the newest finished run, unless one is chosen and
  // still exists. A deleted analysis therefore cannot leave the screen pointing
  // at nothing, and no effect has to notice that it happened.
  const runId = useMemo(() => {
    const ids = runs.map((r) => sid(r.id));
    return chosenRunId && ids.includes(chosenRunId) ? chosenRunId : (ids[0] ?? null);
  }, [runs, chosenRunId]);

  const pair = useMemo(() => {
    const analysis = runs.find((r) => sid(r.id) === runId);
    return analysis ? toComparisonPair(analysis, rasters) : null;
  }, [runs, runId, rasters]);

  /* --------------------------------------------------------- the polygons */

  useEffect(() => {
    // An error leaves `features[runId]` absent and changes no dependency, so
    // this cannot spin; `featuresToken` is what a retry moves.
    if (!runId || features[runId]) return;
    let live = true;
    api
      .getAnalysisFeatures(runId)
      .then((collection) => {
        if (!live) return;
        setFeaturesError((prev) => (prev?.runId === runId ? null : prev));
        useStore.getState().setFeatures(runId, collection);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setFeaturesError({
          runId,
          failure: toFailure(cause, "The detections could not be loaded."),
        });
      });
    return () => {
      live = false;
    };
  }, [runId, features, featuresToken]);

  const detectionsError = featuresError?.runId === runId ? featuresError.failure : null;
  const detectionsStatus: LoadStatus = detectionsError
    ? "error"
    : !runId || features[runId]
      ? "ready"
      : "loading";

  /* -------------------------------------------------------------- the list */

  const allRows = useMemo(
    () => (runId ? sortDetections(toDetectionRows(runId, features[runId])) : []),
    [runId, features],
  );
  const rows = useMemo(() => filterDetections(allRows, query), [allRows, query]);

  // The page count is keyed to the run and the search, so narrowing either one
  // starts again at the first page without an effect to reset it.
  const pageKey = `${runId ?? ""}|${query}`;
  const visible = page.key === pageKey ? page.count : DETECTION_PAGE;
  const bounded = useMemo(() => boundDetections(rows, visible), [rows, visible]);

  const selected = useMemo(
    () => allRows.find((row) => row.key === selectedKey) ?? null,
    [allRows, selectedKey],
  );
  const rowsByKey = useMemo(
    () => new Map(allRows.map((row) => [row.key, row])),
    [allRows],
  );
  const findRow = useCallback((key: string) => rowsByKey.get(key) ?? null, [rowsByKey]);

  /* --------------------------------------------------------------- review */

  const review = useCallback(async (row: DetectionRow, next: ReviewStatus) => {
    const previous = row.reviewStatus;
    setReviewing(true);
    setReviewError(null);
    // Optimistic: the map recolours on the click, not on the round trip.
    useStore
      .getState()
      .patchFeatureReview(row.jobId, row.featureId, { review_status: next });
    try {
      await api.reviewPolygon(row.jobId, row.featureId, next);
    } catch (cause: unknown) {
      useStore
        .getState()
        .patchFeatureReview(row.jobId, row.featureId, { review_status: previous });
      setReviewError(toFailure(cause, "The review could not be saved."));
    } finally {
      setReviewing(false);
    }
  }, []);

  /* -------------------------------------------------------------- the rest */

  const selectProject = useCallback((id: string) => {
    const store = useStore.getState();
    store.clearProjectData();
    store.setCurrentProject(id);
    setLoaded(null);
    setError(null);
    setChosenRunId(null);
    setFeaturesError(null);
    setSelectedKey(null);
    setQuery("");
  }, []);

  const selectRun = useCallback((id: string) => {
    setChosenRunId(id);
    setSelectedKey(null);
  }, []);

  const startRun = useCallback(
    async (t1: Id, t2: Id, mode: AnalysisMode) => {
      if (!projectId) return;
      const analysis = await api.createAnalysis(projectId, t1, t2, mode);
      const store = useStore.getState();
      if (store.currentProjectId !== projectId) return;
      store.upsertAnalysis(analysis);
      // Not drawable until done; runId falls back to the newest finished run meanwhile.
      setChosenRunId(sid(analysis.id));
      setSelectedKey(null);
    },
    [projectId],
  );

  const pairIds = [pair?.reference?.id, pair?.current?.id].filter(Boolean).join(",");

  const deleteRaster = useCallback(
    async (id: Id) => {
      await api.deleteRaster(id);
      const gone = sid(id);
      if (pairIds.split(",").includes(gone)) {
        setChosenRunId(null);
        setSelectedKey(null);
      }
      // Dropped locally first, so a failed refetch cannot leave the deleted flight on screen.
      const store = useStore.getState();
      store.setRasters(store.rasters.filter((r) => sid(r.id) !== gone));
      store.setAnalyses(
        store.analyses.filter(
          (a) => sid(a.raster_t1_id) !== gone && sid(a.raster_t2_id) !== gone,
        ),
      );
      await refreshImagery().catch(() => setRasterPollFailed(true));
    },
    [pairIds, refreshImagery],
  );

  const restoreRaster = useCallback(
    async (id: Id) => {
      await requestRestore(id);
      await refreshImagery().catch(() => setRasterPollFailed(true));
    },
    [refreshImagery],
  );

  const reload = useCallback(() => {
    setError(null);
    setLoaded(null);
    setReloadToken((n) => n + 1);
  }, []);

  const reloadDetections = useCallback(() => {
    setFeaturesError(null);
    setFeaturesToken((n) => n + 1);
  }, []);

  const showMore = useCallback(() => {
    setPage((prev) => ({
      key: pageKey,
      count: (prev.key === pageKey ? prev.count : DETECTION_PAGE) + DETECTION_PAGE,
    }));
  }, [pageKey]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: sid(p.id), name: p.name })),
    [projects],
  );

  const runOptions = useMemo(
    () =>
      runs.map((analysis) => {
        const item = toComparisonPair(analysis, rasters);
        return {
          id: sid(analysis.id),
          referenceDate: item.reference?.capturedAt ?? null,
          currentDate: item.current?.capturedAt ?? null,
        };
      }),
    [runs, rasters],
  );

  // Only reported when there is nothing to draw. A finished run on screen plus
  // a second one still computing is progress, not a state the officer is stuck
  // in; an empty map with no explanation is the thing to avoid.
  const hasRun = runs.some((r) => sid(r.id) === runId);
  const running = analyses.find((a) => a.status === "queued" || a.status === "running");
  const failed = analyses.find((a) => a.status === "failed" && !isRetryingRun(a));
  const retrying = analyses.find(isRetryingRun);

  return {
    projects: projectOptions,
    projectId,
    projectName: projects.find((p) => sid(p.id) === projectId)?.name ?? "",
    selectProject,

    runs: runOptions,
    runId,
    selectRun,
    pair,
    pendingRun:
      hasRun || !running
        ? null
        : { stage: running.stage, percent: Math.round(running.progress * 100) },
    failedRun: hasRun || running || retrying ? null : (failed?.error ?? null),
    retryingRun:
      hasRun || running || !retrying ? null : runErrorText(retrying.error ?? ""),
    activeRun: running
      ? { stage: running.stage, percent: Math.round(running.progress * 100) }
      : null,
    startRun,

    rows,
    bounded,
    totalCount: allRows.length,
    showMore,
    query,
    setQuery,

    selected,
    findRow,
    select: setSelectedKey,

    review,
    reviewing,
    reviewError,

    refreshImagery,
    adoptUpload,
    deleteRaster,
    restoreRaster,
    rasterPollFailed,

    status,
    error,
    reload,
    detectionsStatus,
    detectionsError,
    reloadDetections,
  };
}
