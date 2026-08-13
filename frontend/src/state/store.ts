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

/**
 * Draw order for the map layers, topmost first — the order the sidebar shows
 * and the user drags into place.
 *
 * Kept apart from `rasters` because that list is the server's, ordered by
 * upload time, and it is replaced wholesale every poll; an order held inside it
 * would be overwritten every three seconds. This is also purely a DISPLAY
 * concern: which epoch is T1 and which is T2 comes from the analysis form's own
 * selectors, so re-stacking the maps never changes what an analysis compares.
 */
const ORDER_KEY = "ada.rasterOrder";

function loadOrder(projectId: string | null): string[] {
  if (!projectId) return [];
  try {
    const raw = window.localStorage.getItem(`${ORDER_KEY}.${projectId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function saveOrder(projectId: string | null, order: string[]): void {
  if (!projectId) return;
  try {
    window.localStorage.setItem(`${ORDER_KEY}.${projectId}`, JSON.stringify(order));
  } catch {
    /* private mode / quota — the order is a convenience, not state to defend */
  }
}

/**
 * Reconcile a stored order against the maps that actually exist: keep the
 * arranged ones in their arranged positions, drop the deleted, and put newly
 * uploaded maps on top where the user will see them appear.
 */
function reconcileOrder(saved: string[], ids: string[]): string[] {
  const present = new Set(ids);
  const kept = saved.filter((id) => present.has(id));
  const known = new Set(kept);
  return [...ids.filter((id) => !known.has(id)), ...kept];
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
  /** Raster draw order, topmost first. See reconcileOrder. */
  rasterOrder: string[];
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
  /** Move `dragId` to `dropId`'s position in the draw order. */
  reorderRasters: (dragId: string, dropId: string) => void;
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
  rasterOrder: [],
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
    set((s) => {
      const ids = rasters.map((r) => sid(r.id));
      // Prefer the order already in memory; fall back to what this project had
      // last session. Both go through the same reconcile, so a map deleted or
      // uploaded elsewhere lands correctly either way.
      const base = s.rasterOrder.length ? s.rasterOrder : loadOrder(s.currentProjectId);
      const rasterOrder = reconcileOrder(base, ids);
      return {
        rasters,
        rasterOrder,
        rasterUI: mergeLayerUI(s.rasterUI, ids, RASTER_DEFAULT),
      };
    }),

  reorderRasters: (dragId, dropId) =>
    set((s) => {
      const order = [...s.rasterOrder];
      const from = order.indexOf(dragId);
      const to = order.indexOf(dropId);
      if (from < 0 || to < 0 || from === to) return {};
      order.splice(to, 0, ...order.splice(from, 1));
      saveOrder(s.currentProjectId, order);
      return { rasterOrder: order };
    }),

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
      rasterOrder: [],
      maskUI: {},
      polyUI: {},
      zoneVisible: {},
      features: {},
      drawActive: false,
    }),
}));
