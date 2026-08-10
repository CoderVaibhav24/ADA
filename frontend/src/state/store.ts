import { create } from "zustand";
import type {
  Analysis,
  ChangeFeatureCollection,
  ChangeFeatureProps,
  Id,
  Project,
  Raster,
  RedZone,
} from "../api/types";

export interface LayerUI {
  visible: boolean;
  /** 0..1 */
  opacity: number;
}

export interface FitRequest {
  bounds: [number, number, number, number];
  token: number;
}

export const sid = (id: Id): string => String(id);

function mergeLayerUI(
  prev: Record<string, LayerUI>,
  ids: string[],
  defaults: LayerUI,
): Record<string, LayerUI> {
  const next: Record<string, LayerUI> = {};
  for (const id of ids) next[id] = prev[id] ?? { ...defaults };
  return next;
}

function mergeVisibility(
  prev: Record<string, boolean>,
  ids: string[],
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const id of ids) next[id] = prev[id] ?? true;
  return next;
}

interface AppState {
  projects: Project[];
  projectsLoaded: boolean;
  currentProjectId: string | null;

  rasters: Raster[];
  analyses: Analysis[];
  redZones: RedZone[];

  /** Per-raster layer UI state, keyed by String(raster.id). */
  rasterUI: Record<string, LayerUI>;
  /** Change-heat mask overlay UI, keyed by String(analysis.id). */
  maskUI: Record<string, LayerUI>;
  /** Change polygon layer UI, keyed by String(analysis.id). */
  polyUI: Record<string, LayerUI>;
  /** Red-zone visibility, keyed by String(zone.id). */
  zoneVisible: Record<string, boolean>;

  /** Change polygons per analysis id (fetched once when analysis is done). */
  features: Record<string, ChangeFeatureCollection>;

  drawActive: boolean;
  fitRequest: FitRequest | null;
  globalError: string | null;

  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string | null) => void;
  setRasters: (rasters: Raster[]) => void;
  setAnalyses: (analyses: Analysis[]) => void;
  upsertAnalysis: (analysis: Analysis) => void;
  setRedZones: (zones: RedZone[]) => void;
  setFeatures: (analysisId: Id, fc: ChangeFeatureCollection) => void;
  patchFeatureReview: (
    analysisId: Id,
    featureId: Id,
    patch: Partial<ChangeFeatureProps>,
  ) => void;
  patchRasterUI: (id: Id, patch: Partial<LayerUI>) => void;
  patchMaskUI: (id: Id, patch: Partial<LayerUI>) => void;
  patchPolyUI: (id: Id, patch: Partial<LayerUI>) => void;
  setZoneVisible: (id: Id, visible: boolean) => void;
  setDrawActive: (active: boolean) => void;
  requestFit: (bounds: [number, number, number, number]) => void;
  setGlobalError: (message: string | null) => void;
  clearProjectData: () => void;
}

const RASTER_DEFAULT: LayerUI = { visible: true, opacity: 1 };
const MASK_DEFAULT: LayerUI = { visible: true, opacity: 0.75 };
const POLY_DEFAULT: LayerUI = { visible: true, opacity: 1 };

export const useStore = create<AppState>()((set) => ({
  projects: [],
  projectsLoaded: false,
  currentProjectId: null,
  rasters: [],
  analyses: [],
  redZones: [],
  rasterUI: {},
  maskUI: {},
  polyUI: {},
  zoneVisible: {},
  features: {},
  drawActive: false,
  fitRequest: null,
  globalError: null,

  setProjects: (projects) =>
    set((s) => {
      let current = s.currentProjectId;
      if (current !== null && !projects.some((p) => sid(p.id) === current)) {
        current = null;
      }
      if (current === null && projects.length > 0) {
        current = sid(projects[0].id);
      }
      return { projects, projectsLoaded: true, currentProjectId: current };
    }),

  setCurrentProject: (id) => set({ currentProjectId: id }),

  setRasters: (rasters) =>
    set((s) => ({
      rasters,
      rasterUI: mergeLayerUI(
        s.rasterUI,
        rasters.map((r) => sid(r.id)),
        RASTER_DEFAULT,
      ),
    })),

  setAnalyses: (analyses) =>
    set((s) => {
      const doneIds = analyses
        .filter((a) => a.status === "done")
        .map((a) => sid(a.id));
      const features: Record<string, ChangeFeatureCollection> = {};
      for (const id of doneIds) {
        if (s.features[id]) features[id] = s.features[id];
      }
      return {
        analyses,
        maskUI: mergeLayerUI(s.maskUI, doneIds, MASK_DEFAULT),
        polyUI: mergeLayerUI(s.polyUI, doneIds, POLY_DEFAULT),
        features,
      };
    }),

  upsertAnalysis: (analysis) =>
    set((s) => {
      const key = sid(analysis.id);
      const analyses = s.analyses.some((a) => sid(a.id) === key)
        ? s.analyses.map((a) => (sid(a.id) === key ? analysis : a))
        : [...s.analyses, analysis];
      if (analysis.status !== "done") return { analyses };
      return {
        analyses,
        maskUI: s.maskUI[key]
          ? s.maskUI
          : { ...s.maskUI, [key]: { ...MASK_DEFAULT } },
        polyUI: s.polyUI[key]
          ? s.polyUI
          : { ...s.polyUI, [key]: { ...POLY_DEFAULT } },
      };
    }),

  setRedZones: (redZones) =>
    set((s) => ({
      redZones,
      zoneVisible: mergeVisibility(
        s.zoneVisible,
        redZones.map((z) => sid(z.id)),
      ),
    })),

  setFeatures: (analysisId, fc) =>
    set((s) => ({ features: { ...s.features, [sid(analysisId)]: fc } })),

  patchFeatureReview: (analysisId, featureId, patch) =>
    set((s) => {
      const key = sid(analysisId);
      const fc = s.features[key];
      if (!fc) return {};
      return {
        features: {
          ...s.features,
          [key]: {
            ...fc,
            features: fc.features.map((f) =>
              sid(f.id ?? "") === sid(featureId)
                ? { ...f, properties: { ...f.properties, ...patch } }
                : f,
            ),
          },
        },
      };
    }),

  patchRasterUI: (id, patch) =>
    set((s) => ({
      rasterUI: {
        ...s.rasterUI,
        [sid(id)]: { ...(s.rasterUI[sid(id)] ?? RASTER_DEFAULT), ...patch },
      },
    })),

  patchMaskUI: (id, patch) =>
    set((s) => ({
      maskUI: {
        ...s.maskUI,
        [sid(id)]: { ...(s.maskUI[sid(id)] ?? MASK_DEFAULT), ...patch },
      },
    })),

  patchPolyUI: (id, patch) =>
    set((s) => ({
      polyUI: {
        ...s.polyUI,
        [sid(id)]: { ...(s.polyUI[sid(id)] ?? POLY_DEFAULT), ...patch },
      },
    })),

  setZoneVisible: (id, visible) =>
    set((s) => ({ zoneVisible: { ...s.zoneVisible, [sid(id)]: visible } })),

  setDrawActive: (active) => set({ drawActive: active }),

  requestFit: (bounds) =>
    set((s) => ({
      fitRequest: { bounds, token: (s.fitRequest?.token ?? 0) + 1 },
    })),

  setGlobalError: (message) => set({ globalError: message }),

  clearProjectData: () =>
    set({
      rasters: [],
      analyses: [],
      redZones: [],
      rasterUI: {},
      maskUI: {},
      polyUI: {},
      zoneVisible: {},
      features: {},
      drawActive: false,
    }),
}));
