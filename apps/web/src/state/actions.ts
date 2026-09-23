import type { Polygon } from "geojson";
import { api, ApiError } from "../api/client";
import type { AnalysisMode, Id, ReviewStatus } from "../api/types";
import { sid, useStore } from "./store";

const get = () => useStore.getState();

function reportError(err: unknown, fallback: string): void {
  const msg =
    err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : fallback;
  get().setGlobalError(msg);
  window.setTimeout(() => {
    if (useStore.getState().globalError === msg) {
      useStore.getState().setGlobalError(null);
    }
  }, 6000);
}

export async function loadProjects(): Promise<void> {
  try {
    get().setProjects(await api.listProjects());
  } catch (err) {
    reportError(err, "Failed to load projects");
  }
}

export async function createProject(
  name: string,
  description?: string,
): Promise<boolean> {
  try {
    const project = await api.createProject(name, description || undefined);
    await loadProjects();
    get().setCurrentProject(sid(project.id));
    return true;
  } catch (err) {
    reportError(err, "Failed to create project");
    return false;
  }
}

export async function deleteProject(id: Id): Promise<void> {
  try {
    await api.deleteProject(id);
    if (get().currentProjectId === sid(id)) {
      get().clearProjectData();
      get().setCurrentProject(null);
    }
    await loadProjects();
  } catch (err) {
    reportError(err, "Failed to delete project");
  }
}

export function selectProject(id: string): void {
  get().clearProjectData();
  get().setCurrentProject(id);
}

export async function loadProjectData(pid: Id): Promise<void> {
  try {
    const [rasters, analyses, redZones] = await Promise.all([
      api.listRasters(pid),
      api.listAnalyses(pid),
      api.listRedZones(pid),
    ]);
    // Ignore if the user switched projects while we were fetching.
    if (get().currentProjectId !== sid(pid)) return;
    const s = get();
    s.setRasters(rasters);
    s.setAnalyses(analyses);
    s.setRedZones(redZones);
    await Promise.all(
      analyses
        .filter((a) => a.status === "done")
        .map((a) => ensureFeatures(a.id)),
    );
  } catch (err) {
    reportError(err, "Failed to load project data");
  }
}

export async function refreshRasters(pid: Id): Promise<void> {
  try {
    const rasters = await api.listRasters(pid);
    if (get().currentProjectId === sid(pid)) get().setRasters(rasters);
  } catch {
    /* transient poll failure — retried on next tick */
  }
}

export async function deleteRaster(id: Id): Promise<void> {
  try {
    await api.deleteRaster(id);
    const pid = get().currentProjectId;
    if (pid) await refreshRasters(pid);
  } catch (err) {
    reportError(err, "Failed to delete map");
  }
}

export async function ensureFeatures(analysisId: Id): Promise<void> {
  if (get().features[sid(analysisId)]) return;
  try {
    const fc = await api.getAnalysisFeatures(analysisId);
    get().setFeatures(analysisId, fc);
  } catch (err) {
    reportError(err, "Failed to load change polygons");
  }
}

export async function runAnalysis(
  pid: Id,
  t1: Id,
  t2: Id,
  mode: AnalysisMode = "ai",
): Promise<void> {
  try {
    const analysis = await api.createAnalysis(pid, t1, t2, mode);
    get().upsertAnalysis(analysis);
  } catch (err) {
    reportError(err, "Failed to start analysis");
  }
}

/**
 * Officer adjudication of a single detection. Updates the store optimistically
 * so the map recolours immediately, and rolls back if the API rejects it.
 */
export async function reviewPolygon(
  analysisId: Id,
  featureId: Id,
  status: ReviewStatus,
  note?: string,
): Promise<void> {
  const fc = get().features[sid(analysisId)];
  const previous = fc?.features.find((f) => sid(f.id ?? "") === sid(featureId))
    ?.properties.review_status;
  get().patchFeatureReview(analysisId, featureId, { review_status: status });
  try {
    await api.reviewPolygon(analysisId, featureId, status, note);
  } catch (err) {
    if (previous) {
      get().patchFeatureReview(analysisId, featureId, {
        review_status: previous,
      });
    }
    reportError(err, "Failed to save review");
  }
}

export async function pollAnalysis(id: Id): Promise<void> {
  try {
    const analysis = await api.getAnalysis(id);
    const prev = get().analyses.find((a) => sid(a.id) === sid(id));
    get().upsertAnalysis(analysis);
    if (analysis.status === "done" && prev?.status !== "done") {
      await ensureFeatures(id);
    }
  } catch {
    /* transient poll failure — retried on next tick */
  }
}

export async function deleteAnalysis(id: Id): Promise<void> {
  try {
    await api.deleteAnalysis(id);
    const pid = get().currentProjectId;
    if (pid) get().setAnalyses(await api.listAnalyses(pid));
  } catch (err) {
    reportError(err, "Failed to delete analysis");
  }
}

export async function createRedZone(
  pid: Id,
  name: string,
  geometry: Polygon,
): Promise<void> {
  try {
    await api.createRedZone(pid, name, geometry);
    get().setRedZones(await api.listRedZones(pid));
  } catch (err) {
    reportError(err, "Failed to save red zone");
  }
}

export async function deleteRedZone(id: Id): Promise<void> {
  try {
    await api.deleteRedZone(id);
    const pid = get().currentProjectId;
    if (pid) get().setRedZones(await api.listRedZones(pid));
  } catch (err) {
    reportError(err, "Failed to delete red zone");
  }
}
