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

import { api, ApiError } from "@/api/client";
import type { ReviewStatus } from "@/api/types";
import { useStore } from "@/state/store";

import {
  boundDetections,
  comparableAnalyses,
  DETECTION_PAGE,
  filterDetections,
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
  failedRun: string | null;

  /* ---- detections ---- */
  rows: DetectionRow[];
  bounded: BoundedDetections;
  totalCount: number;
  showMore: () => void;
  query: string;
  setQuery: (value: string) => void;

  /* ---- selection ---- */
  selected: DetectionRow | null;
  select: (key: string | null) => void;

  /* ---- review ---- */
  review: (row: DetectionRow, status: ReviewStatus) => Promise<void>;
  reviewing: boolean;
  reviewError: LoadFailure | null;

  /* ---- status ---- */
  status: LoadStatus;
  error: LoadFailure | null;
  reload: () => void;
  detectionsStatus: LoadStatus;
  detectionsError: LoadFailure | null;
  reloadDetections: () => void;
};

export function useChangeDetection(): ChangeDetection {
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
    .filter((a) => a.status === "queued" || a.status === "running")
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
  const failed = analyses.find((a) => a.status === "failed");

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
    failedRun: hasRun || running ? null : (failed?.error ?? null),

    rows,
    bounded,
    totalCount: allRows.length,
    showMore,
    query,
    setQuery,

    selected,
    select: setSelectedKey,

    review,
    reviewing,
    reviewError,

    status,
    error,
    reload,
    detectionsStatus,
    detectionsError,
    reloadDetections,
  };
}
