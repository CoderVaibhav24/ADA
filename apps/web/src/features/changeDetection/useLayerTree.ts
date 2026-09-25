/**
 * `LAYER_TREE` bound to the store slices MapView already draws from.
 *
 * The overlay order is the constant's. Flights are the exception: they follow
 * the store's `rasterOrder`, top of the draw stack first, and `reorderFlight`
 * restacks them — the same order MapView applies and the console sidebar edits.
 *
 * Red zones are ONE row, not one row per zone. The store keeps visibility per
 * zone because that sidebar listed them individually; this screen treats "red
 * zones" as a layer, so the row is on when any zone is on and the toggle writes
 * every zone at once.
 *
 * The drone imagery group is not drawn from LAYER_TREE: it is one row per
 * uploaded flight, plus a row for an upload still in transit.
 *
 * Parcel change is one extra row in the detections group. It is off by default
 * for every run and present only when the run measured at least one parcel.
 */

import { useCallback, useMemo, useState } from "react";

import type { Raster, RasterStatus } from "@/api/types";
import { useStore } from "@/state/store";

import {
  flightChip,
  LAYER_TREE,
  progressPercent,
  receivedPercent,
  sid,
  type ComparisonPair,
  type FlightChip,
  type LayerGroupId,
  type LayerId,
} from "./model";

/** LAYER_TREE's layers plus the per-parcel change layer, which only some runs have. */
export type TreeLayerId = LayerId | "parcels";

export const PARCEL_LAYER_SWATCH = "#ef4444";

export type LayerState = {
  id: TreeLayerId;
  group: LayerGroupId;
  swatch: string | null;
  hasOpacity: boolean;
  /** False when nothing backs the layer — no run, no red zone, no raster. */
  available: boolean;
  visible: boolean;
  /** 0..1. Not rendered unless `hasOpacity`. */
  opacity: number;
  /** A count or the layer's own name, shown beside the label. */
  detail: string | null;
};

export type FlightRole = "current" | "reference" | null;

export type FlightState = {
  /** The raster id, or `upload` for the row of a transfer still in flight. */
  id: string;
  name: string;
  status: RasterStatus;
  chip: FlightChip;
  /** Bytes sent while uploading, else the server's ingest progress; 0..100. */
  percent: number;
  stage: string | null;
  error: string | null;
  visible: boolean;
  opacity: number;
  role: FlightRole;
  crs: string | null;
  resolutionM: number | null;
  bounds: [number, number, number, number] | null;
  uploading: boolean;
  /** Hours until a cold flight is back, while restoring. */
  restoreEtaHours: number | null;
  /** The browser is offline and the transfer is waiting for it. */
  paused: boolean;
};

/** An upload the browser is still sending; the server has no row for it yet. */
export type UploadInFlight = {
  name: string;
  fraction: number;
  /** The server's session id once opened; its own "uploading" row is hidden behind this one. */
  uploadId?: string | null;
  paused?: boolean;
};

export type LayerTree = {
  layers: LayerState[];
  groups: LayerGroupId[];
  setVisible: (id: TreeLayerId, visible: boolean) => void;
  setOpacity: (id: TreeLayerId, opacity: number) => void;
  basemapVisible: boolean;
  basemapOpacity: number;
  /** The parcel layer is drawn: available on this run and switched on. */
  parcelsVisible: boolean;
  parcelsOpacity: number;
  flights: FlightState[];
  setFlightVisible: (id: string, visible: boolean) => void;
  setFlightOpacity: (id: string, opacity: number) => void;
  /** Moves the dragged flight to the drop target's place in the draw stack. */
  reorderFlight: (dragId: string, dropId: string) => void;
};

const FLIGHT_SWATCH = { current: "#4a9a58", reference: "#00aacc", other: "#8a8f98" } as const;

export function flightSwatch(role: FlightRole): string {
  return role ? FLIGHT_SWATCH[role] : FLIGHT_SWATCH.other;
}

function toFlight(
  raster: Raster,
  ui: { visible: boolean; opacity: number } | undefined,
  role: FlightRole,
): FlightState {
  return {
    id: sid(raster.id),
    name: raster.name,
    status: raster.status,
    chip: flightChip(raster.status, raster.progress),
    percent:
      raster.status === "uploading"
        ? receivedPercent(raster.received_count, raster.chunk_count)
        : progressPercent(raster.progress),
    stage: raster.stage,
    error: raster.reject_reason ?? raster.error,
    visible: ui?.visible ?? true,
    opacity: ui?.opacity ?? 1,
    role,
    crs: raster.crs,
    resolutionM: raster.resolution_m,
    bounds: raster.bounds_4326,
    uploading: false,
    restoreEtaHours: raster.restore_eta_hours ?? null,
    paused: false,
  };
}

function uploadRow(upload: UploadInFlight): FlightState {
  return {
    id: "upload",
    name: upload.name,
    status: "uploading",
    chip: "uploading",
    percent: progressPercent(upload.fraction),
    stage: null,
    error: null,
    visible: false,
    opacity: 1,
    role: null,
    crs: null,
    resolutionM: null,
    bounds: null,
    uploading: true,
    restoreEtaHours: null,
    paused: upload.paused ?? false,
  };
}

export function useLayerTree(
  pair: ComparisonPair | null,
  runId: string | null,
  zoneCountLabel: (n: number) => string,
  zoneNoneLabel: string,
  upload: UploadInFlight | null = null,
  parcels: { available: boolean; detail: string | null } = { available: false, detail: null },
): LayerTree {
  const rasterUI = useStore((s) => s.rasterUI);
  const maskUI = useStore((s) => s.maskUI);
  const polyUI = useStore((s) => s.polyUI);
  const zoneVisible = useStore((s) => s.zoneVisible);
  const redZones = useStore((s) => s.redZones);
  const rasters = useStore((s) => s.rasters);
  const rasterOrder = useStore((s) => s.rasterOrder);

  const [basemapVisible, setBasemapVisible] = useState(true);
  const [basemapOpacity, setBasemapOpacity] = useState(1);
  // Keyed to the run: a new run starts with the parcel layer off, without an effect to reset it.
  const [parcelUI, setParcelUI] = useState<{ runId: string | null; visible: boolean }>({
    runId: null,
    visible: false,
  });
  const [parcelsOpacity, setParcelsOpacity] = useState(1);
  const parcelsOn = parcels.available && parcelUI.runId === runId && parcelUI.visible;

  const referenceId = pair?.reference?.id ?? null;
  const currentId = pair?.current?.id ?? null;
  const zonesOn = redZones.some((zone) => zoneVisible[sid(zone.id)] !== false);

  const flights = useMemo(() => {
    // Ordered ids first; anything the order has not caught up with goes last.
    const rank = new Map(rasterOrder.map((id, index) => [id, index]));
    const ordered = [...rasters].sort(
      (a, b) =>
        (rank.get(sid(a.id)) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(sid(b.id)) ?? Number.MAX_SAFE_INTEGER),
    );
    const hidden = upload?.uploadId ?? null;
    const rows = ordered.filter((raster) => sid(raster.id) !== hidden).map((raster) => {
      const id = sid(raster.id);
      const role: FlightRole =
        id === currentId ? "current" : id === referenceId ? "reference" : null;
      return toFlight(raster, rasterUI[id], role);
    });
    return upload ? [...rows, uploadRow(upload)] : rows;
  }, [rasters, rasterOrder, rasterUI, referenceId, currentId, upload]);

  const layers = useMemo<LayerState[]>(() => {
    const fixed = LAYER_TREE.map((node): LayerState => {
      const base = {
        id: node.id,
        group: node.group,
        swatch: node.swatch,
        hasOpacity: node.hasOpacity,
        detail: null as string | null,
      };

      switch (node.id) {
        case "detections": {
          const ui = runId ? polyUI[runId] : undefined;
          return {
            ...base,
            available: Boolean(runId),
            visible: ui?.visible ?? true,
            opacity: ui?.opacity ?? 1,
          };
        }
        case "heatMask": {
          const ui = runId ? maskUI[runId] : undefined;
          return {
            ...base,
            available: Boolean(runId),
            visible: ui?.visible ?? true,
            opacity: ui?.opacity ?? 0.75,
          };
        }
        case "redZones":
          return {
            ...base,
            available: redZones.length > 0,
            visible: zonesOn,
            opacity: 1,
            detail:
              redZones.length > 0 ? zoneCountLabel(redZones.length) : zoneNoneLabel,
          };
        case "currentCycle": {
          const ui = currentId ? rasterUI[currentId] : undefined;
          return {
            ...base,
            available: Boolean(currentId),
            visible: ui?.visible ?? true,
            opacity: ui?.opacity ?? 1,
          };
        }
        case "referenceCycle": {
          const ui = referenceId ? rasterUI[referenceId] : undefined;
          return {
            ...base,
            available: Boolean(referenceId),
            visible: ui?.visible ?? true,
            opacity: ui?.opacity ?? 1,
          };
        }
        case "baseMap":
          return {
            ...base,
            available: true,
            visible: basemapVisible,
            opacity: basemapOpacity,
          };
      }
    });
    // Unlike the fixed rows, this one is absent rather than disabled on a run without parcels.
    if (!parcels.available) return fixed;
    const parcelRow: LayerState = {
      id: "parcels",
      group: "detections",
      swatch: PARCEL_LAYER_SWATCH,
      hasOpacity: true,
      available: true,
      visible: parcelsOn,
      opacity: parcelsOpacity,
      detail: parcels.detail,
    };
    const after = fixed.findIndex((layer) => layer.id === "heatMask");
    return after < 0
      ? [parcelRow, ...fixed]
      : [...fixed.slice(0, after + 1), parcelRow, ...fixed.slice(after + 1)];
  }, [
    basemapOpacity,
    basemapVisible,
    currentId,
    maskUI,
    parcels.available,
    parcels.detail,
    parcelsOn,
    parcelsOpacity,
    polyUI,
    rasterUI,
    redZones,
    referenceId,
    runId,
    zoneCountLabel,
    zoneNoneLabel,
    zonesOn,
  ]);

  const setVisible = useCallback(
    (id: TreeLayerId, visible: boolean) => {
      const store = useStore.getState();
      switch (id) {
        case "parcels":
          setParcelUI({ runId, visible });
          return;
        case "detections":
          if (runId) store.patchPolyUI(runId, { visible });
          return;
        case "heatMask":
          if (runId) store.patchMaskUI(runId, { visible });
          return;
        case "redZones":
          for (const zone of store.redZones) store.setZoneVisible(zone.id, visible);
          return;
        case "currentCycle":
          if (currentId) store.patchRasterUI(currentId, { visible });
          return;
        case "referenceCycle":
          if (referenceId) store.patchRasterUI(referenceId, { visible });
          return;
        case "baseMap":
          setBasemapVisible(visible);
      }
    },
    [currentId, referenceId, runId],
  );

  const setOpacity = useCallback(
    (id: TreeLayerId, opacity: number) => {
      const store = useStore.getState();
      if (id === "parcels") setParcelsOpacity(opacity);
      if (id === "detections" && runId) store.patchPolyUI(runId, { opacity });
      if (id === "heatMask" && runId) store.patchMaskUI(runId, { opacity });
      if (id === "baseMap") setBasemapOpacity(opacity);
    },
    [runId],
  );

  const setFlightVisible = useCallback((id: string, visible: boolean) => {
    useStore.getState().patchRasterUI(id, { visible });
  }, []);

  const setFlightOpacity = useCallback((id: string, opacity: number) => {
    useStore.getState().patchRasterUI(id, { opacity });
  }, []);

  const reorderFlight = useCallback((dragId: string, dropId: string) => {
    useStore.getState().reorderRasters(dragId, dropId);
  }, []);

  const groups = useMemo(() => {
    const seen: LayerGroupId[] = [];
    for (const layer of layers) if (seen.at(-1) !== layer.group) seen.push(layer.group);
    return seen;
  }, [layers]);

  return {
    layers,
    groups,
    setVisible,
    setOpacity,
    basemapVisible,
    basemapOpacity,
    parcelsVisible: parcelsOn,
    parcelsOpacity,
    flights,
    setFlightVisible,
    setFlightOpacity,
    reorderFlight,
  };
}
