/**
 * `LAYER_TREE` bound to the store slices MapView already draws from.
 *
 * The order is the constant's, never this hook's: fixed order, toggles only
 * (progress-tracker §6). There is no reorder function here because there is no
 * reordering in v1 — `state/store.ts` `reorderRasters` exists for the older
 * console sidebar and is deliberately not reached from this screen.
 *
 * Red zones are ONE row, not one row per zone. The store keeps visibility per
 * zone because that sidebar listed them individually; this screen treats "red
 * zones" as a layer, so the row is on when any zone is on and the toggle writes
 * every zone at once.
 */

import { useCallback, useMemo, useState } from "react";

import { useStore } from "@/state/store";

import {
  LAYER_TREE,
  sid,
  type ComparisonPair,
  type LayerGroupId,
  type LayerId,
} from "./model";

export type LayerState = {
  id: LayerId;
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

export type LayerTree = {
  layers: LayerState[];
  groups: LayerGroupId[];
  setVisible: (id: LayerId, visible: boolean) => void;
  setOpacity: (id: LayerId, opacity: number) => void;
  basemapVisible: boolean;
};

export function useLayerTree(
  pair: ComparisonPair | null,
  runId: string | null,
  zoneCountLabel: (n: number) => string,
  zoneNoneLabel: string,
): LayerTree {
  const rasterUI = useStore((s) => s.rasterUI);
  const maskUI = useStore((s) => s.maskUI);
  const polyUI = useStore((s) => s.polyUI);
  const zoneVisible = useStore((s) => s.zoneVisible);
  const redZones = useStore((s) => s.redZones);

  const [basemapVisible, setBasemapVisible] = useState(true);

  const referenceId = pair?.reference?.id ?? null;
  const currentId = pair?.current?.id ?? null;
  const referenceName = pair?.reference?.name ?? null;
  const currentName = pair?.current?.name ?? null;
  const zonesOn = redZones.some((zone) => zoneVisible[sid(zone.id)] !== false);

  const layers = useMemo<LayerState[]>(
    () =>
      LAYER_TREE.map((node) => {
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
              detail: currentName,
            };
          }
          case "referenceCycle": {
            const ui = referenceId ? rasterUI[referenceId] : undefined;
            return {
              ...base,
              available: Boolean(referenceId),
              visible: ui?.visible ?? true,
              opacity: ui?.opacity ?? 1,
              detail: referenceName,
            };
          }
          case "baseMap":
            return { ...base, available: true, visible: basemapVisible, opacity: 1 };
        }
      }),
    [
      basemapVisible,
      currentId,
      currentName,
      maskUI,
      polyUI,
      rasterUI,
      redZones,
      referenceId,
      referenceName,
      runId,
      zoneCountLabel,
      zoneNoneLabel,
      zonesOn,
    ],
  );

  const setVisible = useCallback(
    (id: LayerId, visible: boolean) => {
      const store = useStore.getState();
      switch (id) {
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
    (id: LayerId, opacity: number) => {
      const store = useStore.getState();
      // Only the two layers declared `hasOpacity` in LAYER_TREE reach here; the
      // imagery pair's opacity belongs to the comparison control.
      if (id === "detections" && runId) store.patchPolyUI(runId, { opacity });
      if (id === "heatMask" && runId) store.patchMaskUI(runId, { opacity });
    },
    [runId],
  );

  const groups = useMemo(() => {
    const seen: LayerGroupId[] = [];
    for (const layer of layers) if (seen.at(-1) !== layer.group) seen.push(layer.group);
    return seen;
  }, [layers]);

  return { layers, groups, setVisible, setOpacity, basemapVisible };
}
