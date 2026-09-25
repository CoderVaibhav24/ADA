import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  LngLatBoundsLike,
  Map as MlMap,
} from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { FeatureCollection, Polygon } from "geojson";
import { api } from "../api/client";
import { accessToken } from "../auth/oidc";
import type {
  ChangeFeatureProps,
  Id,
  ParcelFeatureCollection,
  TileInfo,
} from "../api/types";
import {
  parcelFillColorExpr,
  parcelFillOpacityExpr,
} from "../features/changeDetection/parcelModel";
import { sid, useStore } from "../state/store";
import { createRedZone } from "../state/actions";
import HoverPopup from "./HoverPopup";
import type { HoverState } from "./HoverPopup";
import Legend from "./Legend";
import { AGRA_CENTER, osmBasemapStyle } from "./map/basemap";
import { authorizeTileRequest } from "./map/tileAuth";

// Invisible anchor layers keep the stacking order deterministic:
// basemap < rasters < heat masks < red zones < parcels < change polygons < terra-draw.
const SLOTS = [
  "slot-rasters",
  "slot-masks",
  "slot-zones",
  "slot-parcels",
  "slot-polys",
] as const;

const PARCEL_SRC = "parcels-src";
const PARCEL_FILL = "parcels-fill";
const PARCEL_LINE = "parcels-line";
const PARCEL_DASH = "parcels-line-dash";
const PARCEL_LAYERS = [PARCEL_FILL, PARCEL_LINE, PARCEL_DASH] as const;

const COLOR_ILLEGAL = "#ff4438";
const COLOR_ILLEGAL_LINE = "#ff5c52";
const COLOR_CHANGE = "#ffb020";
const COLOR_CHANGE_LINE = "#ffc14d";
const COLOR_REDZONE = "#ff2d55";
const COLOR_REJECTED = "#6b7280";



function ensureSlots(map: MlMap): void {
  for (const id of SLOTS) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: "background",
        paint: { "background-opacity": 0 },
      });
    }
  }
}

function makeHatchImage(): ImageData {
  const size = 14;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(size, size);
  ctx.strokeStyle = "rgba(255, 45, 85, 0.85)";
  ctx.lineWidth = 1.6;
  for (const offset of [-size, 0, size]) {
    ctx.beginPath();
    ctx.moveTo(offset - 2, size + 2);
    ctx.lineTo(offset + size + 2, -2);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/** Remove layers matching a prefix that are no longer wanted (plus orphaned sources). */
function pruneLayers(map: MlMap, prefix: string, wanted: ReadonlySet<string>): void {
  const style = map.getStyle();
  if (!style.layers) return;
  const stale = style.layers.filter(
    (l) => l.id.startsWith(prefix) && !wanted.has(l.id),
  );
  for (const layer of stale) {
    const src = (layer as LayerSpecification & { source?: string }).source;
    map.removeLayer(layer.id);
    if (
      src &&
      map.getSource(src) &&
      !map.getStyle().layers.some(
        (l) => (l as LayerSpecification & { source?: string }).source === src,
      )
    ) {
      map.removeSource(src);
    }
  }
}

/** Officer-rejected detections fade back so the map shows the verified picture. */
function fillOpacityExpr(base: number): ExpressionSpecification {
  return [
    "*",
    base,
    [
      "case",
      ["==", ["get", "review_status"], "rejected"],
      0.06,
      ["match", ["get", "status"], "illegal", 0.5, 0.26],
    ],
  ] as unknown as ExpressionSpecification;
}

const FILL_COLOR_EXPR = [
  "case",
  ["==", ["get", "review_status"], "rejected"],
  COLOR_REJECTED,
  ["match", ["get", "status"], "illegal", COLOR_ILLEGAL, COLOR_CHANGE],
] as unknown as ExpressionSpecification;

// The ring on the detection the officer has open. First case wins, so it
// outranks every status colour — a selected polygon must be findable on a map
// covered in red ones. Inert unless setFeatureState has been called.
const COLOR_SELECTED = "#ffffff";

const LINE_COLOR_EXPR = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  COLOR_SELECTED,
  ["==", ["get", "review_status"], "rejected"],
  COLOR_REJECTED,
  [
    "match",
    ["get", "status"],
    "illegal",
    COLOR_ILLEGAL_LINE,
    COLOR_CHANGE_LINE,
  ],
] as unknown as ExpressionSpecification;

/** Confirmed violations get a heavier outline — they are the official record. */
const LINE_WIDTH_EXPR = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  4,
  ["==", ["get", "review_status"], "rejected"],
  0.8,
  ["==", ["get", "review_status"], "confirmed"],
  3.2,
  ["match", ["get", "status"], "illegal", 2.4, 1.4],
] as unknown as ExpressionSpecification;

const PARCEL_SELECTED = ["boolean", ["feature-state", "selected"], false];

const PARCEL_LINE_COLOR_EXPR = [
  "case",
  PARCEL_SELECTED,
  COLOR_SELECTED,
  parcelFillColorExpr(),
] as unknown as ExpressionSpecification;

const PARCEL_LINE_WIDTH_EXPR = [
  "case",
  PARCEL_SELECTED,
  3.5,
  1.2,
] as unknown as ExpressionSpecification;

const UNASSESSABLE_FILTER = [
  "==",
  ["get", "change_class"],
  "unassessable",
] as unknown as FilterSpecification;

const ASSESSED_FILTER = [
  "!=",
  ["get", "change_class"],
  "unassessable",
] as unknown as FilterSpecification;

/** The per-parcel change layer; features are promoted to their result `id`. */
export type ParcelOverlay = {
  data: ParcelFeatureCollection;
  visible: boolean;
  /** 0..1, multiplied into each class's own fill alpha. */
  opacity: number;
  /** The result id to ring, e.g. the table row the officer picked. */
  selectedId: number | null;
};

/** The few map commands a toolbar outside this component needs to issue. */
export type MapViewHandle = {
  /** The live map, for a second view that follows its camera. Null before mount. */
  getMap: () => MlMap | null;
  zoomIn: () => void;
  zoomOut: () => void;
  fitBounds: (bounds: [number, number, number, number], options?: FitOptions) => void;
};

/** Overrides for one fit; maxZoom is a cap, and a closer view that already holds the box is kept. */
export type FitOptions = { maxZoom?: number; padding?: number };


export type MapSelection = {
  jobId: string;
  featureId: Id;
  props: ChangeFeatureProps;
};

/**
 * Every prop is optional and every default reproduces the behaviour this
 * component had when Dashboard was its only caller. The Change Detection screen
 * draws its own legend, its own empty state and its own layer tree, so it turns
 * the built-in ones off rather than standing up a second map.
 */
export type MapViewProps = {
  ref?: Ref<MapViewHandle>;
  /** The detection under the pointer, or null when the click missed one. */
  onSelect?: (selection: MapSelection | null) => void;
  /** Which detection to ring. Owned outside, so a list and the map agree. */
  selection?: { jobId: string; featureId: Id } | null;
  onZoomChange?: (zoom: number) => void;
  showLegend?: boolean;
  showEmptyHint?: boolean;
  /** The OpenStreetMap base layer, as one entry in a layer tree. */
  basemapVisible?: boolean;
  /** 0..1, the base layer's own opacity slider. */
  basemapOpacity?: number;
  /** Double-click or double-tap on a detection; the map's own double-click zoom is suppressed there. */
  onFeatureDoubleClick?: (target: { jobId: string; featureId: Id }) => void;
  /** A muted line on the hover card, e.g. what a double-click does. */
  hoverHint?: string;
  /** The per-parcel change layer; null or absent draws none. */
  parcels?: ParcelOverlay | null;
  /** The hover card body for a parcel result id; null shows no card. */
  renderParcelHover?: (id: string) => ReactNode;
};

export default function MapView({
  ref,
  onSelect,
  selection = null,
  onZoomChange,
  showLegend = true,
  showEmptyHint = true,
  basemapVisible = true,
  basemapOpacity = 1,
  onFeatureDoubleClick,
  hoverHint,
  parcels = null,
  renderParcelHover,
}: MapViewProps = {}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const drawActiveRef = useRef(false);
  const infoPendingRef = useRef<Set<string>>(new Set());

  const [mapReady, setMapReady] = useState(false);
  const [rasterInfo, setRasterInfo] = useState<Record<string, TileInfo | null>>({});
  const [hover, setHover] = useState<HoverState | null>(null);
  const [parcelHover, setParcelHover] = useState<{
    x: number;
    y: number;
    id: string;
    /** Near the right edge the card opens leftwards, as HoverPopup does. */
    flip: boolean;
  } | null>(null);
  const selectedParcelRef = useRef<number | null>(null);

  const rasters = useStore((s) => s.rasters);
  const analyses = useStore((s) => s.analyses);
  const redZones = useStore((s) => s.redZones);
  const rasterUI = useStore((s) => s.rasterUI);
  const rasterOrder = useStore((s) => s.rasterOrder);
  const maskUI = useStore((s) => s.maskUI);
  const polyUI = useStore((s) => s.polyUI);
  const zoneVisible = useStore((s) => s.zoneVisible);
  const features = useStore((s) => s.features);
  const drawActive = useStore((s) => s.drawActive);
  const fitRequest = useStore((s) => s.fitRequest);

  // The init effect below runs once and must not be re-created when a caller
  // passes a new inline callback, so the callbacks are reached through refs.
  // Assigned in effects rather than during render: a ref written during render
  // is a rendering side effect, and these two effects are declared BEFORE the
  // init effect so they have already run by the time the map exists.
  const onSelectRef = useRef<MapViewProps["onSelect"]>(undefined);
  const onZoomChangeRef = useRef<MapViewProps["onZoomChange"]>(undefined);
  const selectedRef = useRef<{ source: string; id: string | number } | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const onDoubleRef = useRef<MapViewProps["onFeatureDoubleClick"]>(undefined);
  useEffect(() => {
    onDoubleRef.current = onFeatureDoubleClick;
  }, [onFeatureDoubleClick]);

  useImperativeHandle(
    ref,
    () => ({
      getMap: () => mapRef.current,
      zoomIn: () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut(),
      fitBounds: ([w, s, e, n], options) => {
        const map = mapRef.current;
        if (!map) return;
        const box: LngLatBoundsLike = [
          [w, s],
          [e, n],
        ];
        const padding = options?.padding ?? 56;
        const maxZoom = options?.maxZoom ?? 20;
        if (options) {
          // Already closer than the cap and the box still fits: pan, don't zoom out.
          const fit = map.cameraForBounds(box, { padding });
          const zoom = map.getZoom();
          if (fit?.zoom !== undefined && zoom > maxZoom && zoom <= fit.zoom) {
            map.easeTo({ center: fit.center, duration: 700 });
            return;
          }
        }
        map.fitBounds(box, { padding, duration: 700, maxZoom });
      },
    }),
    [],
  );

  // Keep the token MapLibre attaches to tile requests current. Sixty seconds
  // against a short-lived access token: a stale one costs a 401 on a tile,
  // which is visible as a blank square until the next refresh, so the interval
  // has to be comfortably shorter than the lifetime rather than close to it.
  useEffect(() => {
    // accessToken() writes the cache transformRequest reads; the return value
    // is not needed here.
    const timer = window.setInterval(() => void accessToken(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // ------------------------------------------------------------------ init
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      center: AGRA_CENTER,
      zoom: 12,
      attributionControl: false,
      // Replaced by the observer below: MapLibre drops its observer's first callback.
      trackResize: false,
      transformRequest: authorizeTileRequest,
      style: osmBasemapStyle(),
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");

    map.on("load", () => {
      ensureSlots(map);
      if (!map.hasImage("redzone-hatch")) {
        map.addImage("redzone-hatch", makeHatchImage());
      }

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: {
              fillColor: "#ff2d55",
              fillOpacity: 0.18,
              outlineColor: "#ff2d55",
              outlineWidth: 2,
              closingPointColor: "#ffffff",
              closingPointOutlineColor: "#ff2d55",
              closingPointWidth: 4,
              closingPointOutlineWidth: 2,
            },
          }),
        ],
      });
      draw.start();
      drawRef.current = draw;

      draw.on("finish", (id, context) => {
        if (context.action !== "draw") return;
        const feature = draw.getSnapshot().find((f) => f.id === id);
        draw.removeFeatures([id]);
        useStore.getState().setDrawActive(false);
        if (!feature || feature.geometry.type !== "Polygon") return;
        const geometry = feature.geometry as Polygon;
        const pid = useStore.getState().currentProjectId;
        if (!pid) return;
        const defaultName = `Red zone ${useStore.getState().redZones.length + 1}`;
        const name = window.prompt("Name this red zone:", defaultName);
        if (name && name.trim()) {
          void createRedZone(pid, name.trim(), geometry);
        }
      });

      onZoomChangeRef.current?.(map.getZoom());
      setMapReady(true);
    });

    map.on("zoom", () => onZoomChangeRef.current?.(map.getZoom()));

    // Click: adopt the change polygon under the pointer as the selection. A
    // click that hits none of them reports null rather than nothing, because
    // "clicked away" is how the detail panel gets closed.
    map.on("click", (e) => {
      if (drawActiveRef.current) return;
      const report = onSelectRef.current;
      if (!report) return;
      const layerIds = map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith("poly-fill-"));
      const hit =
        layerIds.length === 0
          ? undefined
          : map.queryRenderedFeatures(e.point, { layers: layerIds })[0];
      // No id means no review, no preview and no highlight — see
      // features/changeDetection/model.ts, which drops the same features.
      if (!hit || hit.id === undefined) {
        report(null);
        return;
      }
      report({
        jobId: hit.layer.id.replace("poly-fill-", ""),
        featureId: hit.id,
        props: hit.properties as unknown as ChangeFeatureProps,
      });
    });

    // Double-click (mouse) or double-tap (touch) on a detection. A handled one
    // cancels the map's own double-click / double-tap zoom; empty map still zooms.
    const polygonAt = (point: maplibregl.PointLike) => {
      const layerIds = map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith("poly-fill-"));
      if (layerIds.length === 0) return null;
      const hit = map.queryRenderedFeatures(point, { layers: layerIds })[0];
      return hit && hit.id !== undefined
        ? {
            jobId: hit.layer.id.replace("poly-fill-", ""),
            featureId: hit.id,
            props: hit.properties as unknown as ChangeFeatureProps,
          }
        : null;
    };
    let lastFired = 0;
    const fireDouble = (target: MapSelection) => {
      // Some browsers send a dblclick after a double-tap as well; act once.
      const now = performance.now();
      if (now - lastFired < 600) return;
      lastFired = now;
      onSelectRef.current?.(target);
      onDoubleRef.current?.({ jobId: target.jobId, featureId: target.featureId });
    };
    map.on("dblclick", (e) => {
      if (drawActiveRef.current || !onDoubleRef.current) return;
      const target = polygonAt(e.point);
      if (!target) return;
      e.preventDefault();
      fireDouble(target);
    });
    let lastTap: { key: string; at: number } | null = null;
    map.on("touchend", (e) => {
      if (drawActiveRef.current || !onDoubleRef.current) return;
      const touch = e.originalEvent;
      if (touch.touches.length > 0 || touch.changedTouches.length !== 1) {
        lastTap = null;
        return;
      }
      const target = polygonAt(e.point);
      if (!target) {
        lastTap = null;
        return;
      }
      const key = `${target.jobId}:${String(target.featureId)}`;
      const now = performance.now();
      if (lastTap && lastTap.key === key && now - lastTap.at < 350) {
        lastTap = null;
        e.preventDefault();
        fireDouble(target);
        return;
      }
      lastTap = { key, at: now };
    });

    // Hover: change polygons under the cursor first, then the parcel beneath them.
    map.on("mousemove", (e) => {
      if (drawActiveRef.current) return;
      const layerIds = map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith("poly-fill-"));
      const feats =
        layerIds.length === 0 ? [] : map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (feats.length > 0) {
        setHover({
          x: e.point.x,
          y: e.point.y,
          props: feats[0].properties as unknown as ChangeFeatureProps,
          jobId: feats[0].layer.id.replace("poly-fill-", ""),
          featureId: feats[0].id,
        });
        setParcelHover(null);
        map.getCanvas().style.cursor = "pointer";
        return;
      }
      setHover(null);
      map.getCanvas().style.cursor = "";
      const parcel = map.getLayer(PARCEL_FILL)
        ? map.queryRenderedFeatures(e.point, { layers: [PARCEL_FILL] })[0]
        : undefined;
      const parcelId = parcel?.properties?.id as unknown;
      setParcelHover(
        parcelId === undefined || parcelId === null
          ? null
          : {
              x: e.point.x,
              y: e.point.y,
              id: String(parcelId),
              flip: map.getContainer().clientWidth - e.point.x < 300,
            },
      );
    });
    map.on("mouseout", () => {
      setHover(null);
      setParcelHover(null);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Refit the canvas whenever the container changes size, at most once a frame.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mapRef.current?.resize());
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // ----------------------------------------------------------- draw toggle
  useEffect(() => {
    drawActiveRef.current = drawActive;
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map || !mapReady) return;
    if (drawActive) {
      setHover(null);
      draw.setMode("polygon");
      map.getCanvas().style.cursor = "crosshair";
    } else {
      draw.clear();
      draw.setMode("static");
      map.getCanvas().style.cursor = "";
    }
  }, [drawActive, mapReady]);

  // ----------------------------------------------- raster tile info fetches
  useEffect(() => {
    for (const r of rasters) {
      const key = sid(r.id);
      if (r.status !== "ready" || key in rasterInfo || infoPendingRef.current.has(key)) {
        continue;
      }
      infoPendingRef.current.add(key);
      api
        .rasterTileInfo(r.id)
        .then((info) => setRasterInfo((prev) => ({ ...prev, [key]: info })))
        .catch(() => setRasterInfo((prev) => ({ ...prev, [key]: null })))
        .finally(() => infoPendingRef.current.delete(key));
    }
  }, [rasters, rasterInfo]);

  // ----------------------------------------------------------- raster sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const ready = rasters.filter(
      (r) => r.status === "ready" && sid(r.id) in rasterInfo,
    );
    pruneLayers(map, "raster-", new Set(ready.map((r) => `raster-${sid(r.id)}`)));

    for (const r of ready) {
      const key = sid(r.id);
      const srcId = `raster-src-${key}`;
      const lyrId = `raster-${key}`;
      const info = rasterInfo[key];
      if (!map.getSource(srcId)) {
        const bounds = info?.bounds ?? r.bounds_4326 ?? undefined;
        map.addSource(srcId, {
          type: "raster",
          tiles: [`/api/tiles/raster/${key}/{z}/{x}/{y}.png`],
          tileSize: 256,
          ...(bounds ? { bounds } : {}),
          ...(info ? { minzoom: info.minzoom, maxzoom: info.maxzoom } : {}),
        });
      }
      if (!map.getLayer(lyrId)) {
        map.addLayer(
          {
            id: lyrId,
            type: "raster",
            source: srcId,
            paint: { "raster-resampling": "linear" },
          },
          "slot-rasters",
        );
      }
      const ui = rasterUI[key] ?? { visible: true, opacity: 1 };
      map.setLayoutProperty(lyrId, "visibility", ui.visible ? "visible" : "none");
      map.setPaintProperty(lyrId, "raster-opacity", ui.opacity);
    }

    // Apply the user's stacking order.
    //
    // MapLibre draws later layers on top, and `moveLayer(id, before)` inserts
    // id immediately before `before`. So walk the sidebar order BOTTOM-UP,
    // parking each layer just under the slot marker: each move lands the layer
    // above everything moved before it, leaving the sidebar's top entry drawn
    // last — which is what "on top" means to the person dragging it.
    for (const key of [...rasterOrder].reverse()) {
      const lyrId = `raster-${key}`;
      if (map.getLayer(lyrId) && map.getLayer("slot-rasters")) {
        map.moveLayer(lyrId, "slot-rasters");
      }
    }
  }, [mapReady, rasters, rasterUI, rasterInfo, rasterOrder]);

  // ------------------------------------------------------- heat mask sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const done = analyses.filter((a) => a.status === "done");
    pruneLayers(map, "mask-", new Set(done.map((a) => `mask-${sid(a.id)}`)));

    for (const a of done) {
      const key = sid(a.id);
      const srcId = `mask-src-${key}`;
      const lyrId = `mask-${key}`;
      if (!map.getSource(srcId)) {
        // Reuse the T2 raster's tile envelope for the mask overlay.
        const t2Info = rasterInfo[sid(a.raster_t2_id)];
        map.addSource(srcId, {
          type: "raster",
          tiles: [`/api/tiles/mask/${key}/{z}/{x}/{y}.png`],
          tileSize: 256,
          ...(t2Info
            ? {
                bounds: t2Info.bounds,
                minzoom: t2Info.minzoom,
                maxzoom: t2Info.maxzoom,
              }
            : {}),
        });
      }
      if (!map.getLayer(lyrId)) {
        map.addLayer(
          {
            id: lyrId,
            type: "raster",
            source: srcId,
            paint: { "raster-resampling": "linear" },
          },
          "slot-masks",
        );
      }
      const ui = maskUI[key] ?? { visible: true, opacity: 0.75 };
      map.setLayoutProperty(lyrId, "visibility", ui.visible ? "visible" : "none");
      map.setPaintProperty(lyrId, "raster-opacity", ui.opacity);
    }
  }, [mapReady, analyses, maskUI, rasterInfo]);

  // -------------------------------------------------- change polygon sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const withFeatures = analyses.filter(
      (a) => a.status === "done" && features[sid(a.id)],
    );
    const wanted = new Set<string>();
    for (const a of withFeatures) {
      wanted.add(`poly-fill-${sid(a.id)}`);
      wanted.add(`poly-line-${sid(a.id)}`);
    }
    pruneLayers(map, "poly-", wanted);

    for (const a of withFeatures) {
      const key = sid(a.id);
      const srcId = `poly-src-${key}`;
      const fc = features[key];
      const src = map.getSource(srcId) as GeoJSONSource | undefined;
      if (!src) {
        map.addSource(srcId, { type: "geojson", data: fc });
      } else {
        src.setData(fc);
      }
      if (!map.getLayer(`poly-fill-${key}`)) {
        map.addLayer(
          {
            id: `poly-fill-${key}`,
            type: "fill",
            source: srcId,
            paint: { "fill-color": FILL_COLOR_EXPR },
          },
          "slot-polys",
        );
        map.addLayer(
          {
            id: `poly-line-${key}`,
            type: "line",
            source: srcId,
            paint: {
              "line-color": LINE_COLOR_EXPR,
              "line-width": LINE_WIDTH_EXPR,
            },
          },
          "slot-polys",
        );
      }
      const ui = polyUI[key] ?? { visible: true, opacity: 1 };
      const vis = ui.visible ? "visible" : "none";
      map.setLayoutProperty(`poly-fill-${key}`, "visibility", vis);
      map.setLayoutProperty(`poly-line-${key}`, "visibility", vis);
      map.setPaintProperty(`poly-fill-${key}`, "fill-opacity", fillOpacityExpr(ui.opacity));
      map.setPaintProperty(`poly-line-${key}`, "line-opacity", Math.min(1, ui.opacity * 0.95));
    }
  }, [mapReady, analyses, features, polyUI]);

  // ------------------------------------------------------- red zones sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: redZones.map((z) => ({
        type: "Feature",
        properties: { zid: sid(z.id), name: z.name },
        geometry: z.geometry,
      })),
    };

    const src = map.getSource("zones") as GeoJSONSource | undefined;
    if (!src) {
      map.addSource("zones", { type: "geojson", data: fc });
      map.addLayer(
        {
          id: "zones-fill-bg",
          type: "fill",
          source: "zones",
          paint: { "fill-color": COLOR_REDZONE, "fill-opacity": 0.07 },
        },
        "slot-zones",
      );
      map.addLayer(
        {
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: { "fill-pattern": "redzone-hatch", "fill-opacity": 0.55 },
        },
        "slot-zones",
      );
      map.addLayer(
        {
          id: "zones-line",
          type: "line",
          source: "zones",
          paint: {
            "line-color": COLOR_REDZONE,
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        },
        "slot-zones",
      );
    } else {
      src.setData(fc);
    }

    const visibleIds = redZones
      .filter((z) => zoneVisible[sid(z.id)] !== false)
      .map((z) => sid(z.id));
    const filter = [
      "in",
      ["get", "zid"],
      ["literal", visibleIds],
    ] as unknown as FilterSpecification;
    for (const lyr of ["zones-fill-bg", "zones-fill", "zones-line"]) {
      map.setFilter(lyr, filter);
    }
  }, [mapReady, redZones, zoneVisible]);

  // ------------------------------------------------------- parcel layer
  const parcelData = parcels?.data ?? null;
  const parcelsVisible = parcels?.visible ?? false;
  const parcelsOpacity = parcels?.opacity ?? 1;
  const selectedParcel = parcels?.selectedId ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(PARCEL_SRC) as GeoJSONSource | undefined;
    if (!parcelData) {
      for (const id of PARCEL_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      if (src) map.removeSource(PARCEL_SRC);
      selectedParcelRef.current = null;
      return;
    }
    if (src) {
      src.setData(parcelData);
      return;
    }
    map.addSource(PARCEL_SRC, { type: "geojson", data: parcelData, promoteId: "id" });
    map.addLayer(
      {
        id: PARCEL_FILL,
        type: "fill",
        source: PARCEL_SRC,
        paint: {
          "fill-color": parcelFillColorExpr() as unknown as ExpressionSpecification,
        },
      },
      "slot-parcels",
    );
    map.addLayer(
      {
        id: PARCEL_LINE,
        type: "line",
        source: PARCEL_SRC,
        filter: ASSESSED_FILTER,
        paint: { "line-color": PARCEL_LINE_COLOR_EXPR, "line-width": PARCEL_LINE_WIDTH_EXPR },
      },
      "slot-parcels",
    );
    map.addLayer(
      {
        id: PARCEL_DASH,
        type: "line",
        source: PARCEL_SRC,
        filter: UNASSESSABLE_FILTER,
        paint: {
          "line-color": PARCEL_LINE_COLOR_EXPR,
          "line-width": PARCEL_LINE_WIDTH_EXPR,
          "line-dasharray": [2, 2],
        },
      },
      "slot-parcels",
    );
  }, [mapReady, parcelData]);

  // Visibility and opacity; `parcelData` re-runs it once the layers exist.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(PARCEL_FILL)) return;
    const vis = parcelsVisible ? "visible" : "none";
    for (const id of PARCEL_LAYERS) map.setLayoutProperty(id, "visibility", vis);
    map.setPaintProperty(
      PARCEL_FILL,
      "fill-opacity",
      parcelFillOpacityExpr(parcelsOpacity) as unknown as ExpressionSpecification,
    );
    const line = Math.max(0, Math.min(1, parcelsOpacity));
    map.setPaintProperty(PARCEL_LINE, "line-opacity", line);
    map.setPaintProperty(PARCEL_DASH, "line-opacity", line);
  }, [mapReady, parcelData, parcelsVisible, parcelsOpacity]);

  // The ring on the parcel picked from the table; setData keeps feature-state, a new source does not.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource(PARCEL_SRC)) return;
    const previous = selectedParcelRef.current;
    if (previous !== null) map.removeFeatureState({ source: PARCEL_SRC, id: previous });
    selectedParcelRef.current = null;
    if (selectedParcel === null) return;
    map.setFeatureState({ source: PARCEL_SRC, id: selectedParcel }, { selected: true });
    selectedParcelRef.current = selectedParcel;
  }, [mapReady, parcelData, selectedParcel]);

  // ---------------------------------------------------------- base map
  // The OpenStreetMap layer is a LAYER, not scenery: the OneMap UP model puts
  // it at the foot of the tree with its own toggle. Dashboard never passes the
  // prop, so it stays visible there.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("basemap-osm")) return;
    map.setLayoutProperty(
      "basemap-osm",
      "visibility",
      basemapVisible ? "visible" : "none",
    );
  }, [mapReady, basemapVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer("basemap-osm")) return;
    map.setPaintProperty("basemap-osm", "raster-opacity", basemapOpacity);
  }, [mapReady, basemapOpacity]);

  // --------------------------------------------------------- selection ring
  // `features` is a dependency because the selection can be set before its
  // source exists — choosing a detection from the list while the collection is
  // still arriving — and feature-state on a missing source is silently dropped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const previous = selectedRef.current;
    if (previous && map.getSource(previous.source)) {
      map.removeFeatureState({ source: previous.source, id: previous.id });
    }
    selectedRef.current = null;

    if (!selection) return;
    const source = `poly-src-${selection.jobId}`;
    if (!map.getSource(source)) return;
    map.setFeatureState({ source, id: selection.featureId }, { selected: true });
    selectedRef.current = { source, id: selection.featureId };
  }, [mapReady, selection, features]);

  // -------------------------------------------------------------- fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !fitRequest) return;
    const [w, s, e, n] = fitRequest.bounds;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 56, duration: 700, maxZoom: 20 },
    );
  }, [mapReady, fitRequest]);

  const noRasters = rasters.length === 0;
  const parcelCard =
    parcelHover && parcelsVisible && renderParcelHover ? renderParcelHover(parcelHover.id) : null;


  return (
    <div className="map-wrap" ref={wrapRef}>
      <div className="map-canvas" ref={containerRef} />
      {mapReady && noRasters && showEmptyHint && (
        <div className="map-hint-card">
          <div className="empty-kicker">No imagery yet</div>
          <p>
            Upload two epochs of the same area — a <strong>before (T1)</strong>{" "}
            and an <strong>after (T2)</strong> GeoTIFF — from the{" "}
            <em>Maps · Layers</em> panel to begin change detection.
          </p>
        </div>
      )}
      {showLegend && <Legend />}
      {hover && (
        <HoverPopup
          hover={hover}
          containerWidth={wrapRef.current?.clientWidth ?? 0}
          hint={hoverHint}
        />
      )}
      {!hover && parcelHover && parcelCard && (
        <div
          className="hover-popup"
          style={{
            left: parcelHover.x,
            top: parcelHover.y,
            transform: `translate(${parcelHover.flip ? "calc(-100% - 14px)" : "14px"}, 14px)`,
          }}
        >
          {parcelCard}
        </div>
      )}
    </div>
  );
}
