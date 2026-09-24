/**
 * Swipe comparison, as in ArcGIS and QGIS: drag a divider across the map and
 * the "before" flight shows on one side, the main map on the other.
 *
 * The main map keeps every overlay and all interaction. A second, inert
 * MapLibre map holding only the basemap and the before flight is inserted
 * inside the main map's container — above its canvas, below its controls —
 * follows its camera, and is clipped to the divider with `clip-path`.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";

import { api } from "@/api/client";
import type { MapViewHandle } from "@/components/MapView";
import { osmBasemapStyle } from "@/components/map/basemap";
import { authorizeTileRequest } from "@/components/map/tileAuth";
import { sid, useStore } from "@/state/store";

export type SwipeOrientation = "vertical" | "horizontal";

const KEY_STEP = 0.05;

export function SwipeCompare({
  mapRef,
  beforeId,
  orientation,
  beforeLabel,
  afterLabel,
  handleLabel,
}: {
  mapRef: RefObject<MapViewHandle | null>;
  beforeId: string;
  orientation: SwipeOrientation;
  beforeLabel: string;
  afterLabel: string;
  handleLabel: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(0.5);
  const rasterBounds = useStore(
    (s) => s.rasters.find((r) => sid(r.id) === beforeId)?.bounds_4326 ?? null,
  );

  // The inert before-map, rebuilt when the before flight changes.
  useEffect(() => {
    const main: MlMap | null = mapRef.current?.getMap() ?? null;
    if (!main) return;
    const host = main.getContainer();
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    host.insertBefore(layer, host.querySelector(".maplibregl-control-container"));
    layerRef.current = layer;

    const overlay = new maplibregl.Map({
      container: layer,
      style: osmBasemapStyle(),
      center: main.getCenter(),
      zoom: main.getZoom(),
      bearing: main.getBearing(),
      pitch: main.getPitch(),
      interactive: false,
      attributionControl: false,
      transformRequest: authorizeTileRequest,
    });

    const follow = () =>
      overlay.jumpTo({
        center: main.getCenter(),
        zoom: main.getZoom(),
        bearing: main.getBearing(),
        pitch: main.getPitch(),
      });
    const resize = () => overlay.resize();
    main.on("move", follow);
    main.on("resize", resize);

    let live = true;
    overlay.on("load", () => {
      void api
        .rasterTileInfo(beforeId)
        .catch(() => null)
        .then((info) => {
          if (!live) return;
          const bounds = info?.bounds ?? rasterBounds ?? undefined;
          overlay.addSource("before", {
            type: "raster",
            tiles: [`/api/tiles/raster/${beforeId}/{z}/{x}/{y}.png`],
            tileSize: 256,
            ...(bounds ? { bounds } : {}),
            ...(info ? { minzoom: info.minzoom, maxzoom: info.maxzoom } : {}),
          });
          overlay.addLayer({
            id: "before",
            type: "raster",
            source: "before",
            paint: { "raster-resampling": "linear" },
          });
        });
    });

    return () => {
      live = false;
      main.off("move", follow);
      main.off("resize", resize);
      overlay.remove();
      layer.remove();
      layerRef.current = null;
    };
  }, [mapRef, beforeId, rasterBounds]);

  // The before-map covers the left (vertical) or top (horizontal) share.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const hidden = `${((1 - position) * 100).toFixed(2)}%`;
    layer.style.clipPath =
      orientation === "vertical" ? `inset(0 ${hidden} 0 0)` : `inset(0 0 ${hidden} 0)`;
  }, [position, orientation, beforeId, rasterBounds]);

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const next =
        orientation === "vertical"
          ? (clientX - rect.left) / rect.width
          : (clientY - rect.top) / rect.height;
      setPosition(Math.min(1, Math.max(0, next)));
    },
    [orientation],
  );

  const vertical = orientation === "vertical";
  const percent = `${position * 100}%`;
  const decrease = vertical ? "ArrowLeft" : "ArrowUp";
  const increase = vertical ? "ArrowRight" : "ArrowDown";

  return (
    <div ref={frameRef} className="pointer-events-none absolute inset-0 z-[5]">
      {/* The whole divider is the drag target, so it can be grabbed anywhere along
          a map taller than the viewport; the round handle carries the keyboard. */}
      <div
        className={`pointer-events-auto absolute flex touch-none items-center justify-center ${
          vertical
            ? "inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize"
            : "inset-x-0 h-4 -translate-y-1/2 cursor-ns-resize"
        }`}
        style={vertical ? { left: percent } : { top: percent }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveTo(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            moveTo(event.clientX, event.clientY);
          }
        }}
      >
        <div
          aria-hidden
          className={`absolute bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)] ${
            vertical ? "inset-y-0 w-0.5" : "inset-x-0 h-0.5"
          }`}
        />
        <div
          role="separator"
          tabIndex={0}
          aria-label={handleLabel}
          aria-orientation={vertical ? "vertical" : "horizontal"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position * 100)}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-surface-overlay text-fg-strong shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onKeyDown={(event) => {
            if (event.key === decrease) setPosition((p) => Math.max(0, p - KEY_STEP));
            else if (event.key === increase) setPosition((p) => Math.min(1, p + KEY_STEP));
            else if (event.key === "Home") setPosition(0);
            else if (event.key === "End") setPosition(1);
            else return;
            event.preventDefault();
          }}
        >
          <span aria-hidden className={`text-2xs leading-none ${vertical ? "" : "rotate-90"}`}>
            ◀▶
          </span>
        </div>
      </div>

      <SideChip className={vertical ? "bottom-10 left-3" : "top-3 left-3"}>
        {beforeLabel}
      </SideChip>
      <SideChip className={vertical ? "right-3 bottom-10" : "bottom-10 left-3"}>
        {afterLabel}
      </SideChip>
    </div>
  );
}

function SideChip({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={`absolute rounded-xs border border-line-subtle bg-surface-overlay px-2 py-1 font-mono text-2xs text-fg-strong backdrop-blur-sm ${className}`}
    >
      {children}
    </span>
  );
}
