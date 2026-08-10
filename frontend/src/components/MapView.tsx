import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MlMap,
} from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { FeatureCollection, Polygon } from "geojson";
import { api } from "../api/client";
import type { ChangeFeatureProps, TileInfo } from "../api/types";
import { sid, useStore } from "../state/store";
import { createRedZone } from "../state/actions";
import HoverPopup from "./HoverPopup";
import type { HoverState } from "./HoverPopup";
import Legend from "./Legend";

// Invisible anchor layers keep the stacking order deterministic:
// basemap < rasters < heat masks < red zones < change polygons < terra-draw.
const SLOTS = ["slot-rasters", "slot-masks", "slot-zones", "slot-polys"] as const;

const COLOR_ILLEGAL = "#ff4438";
const COLOR_ILLEGAL_LINE = "#ff5c52";
const COLOR_CHANGE = "#ffb020";
const COLOR_CHANGE_LINE = "#ffc14d";
const COLOR_REDZONE = "#ff2d55";
const COLOR_REJECTED = "#6b7280";

// Agra city — sensible default view before any raster exists.
const AGRA_CENTER: [number, number] = [78.0081, 27.1767];

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

const LINE_COLOR_EXPR = [
  "case",
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
  ["==", ["get", "review_status"], "rejected"],
  0.8,
  ["==", ["get", "review_status"], "confirmed"],
  3.2,
  ["match", ["get", "status"], "illegal", 2.4, 1.4],
] as unknown as ExpressionSpecification;

export default function MapView() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const drawActiveRef = useRef(false);
  const infoPendingRef = useRef<Set<string>>(new Set());

  const [mapReady, setMapReady] = useState(false);
  const [rasterInfo, setRasterInfo] = useState<Record<string, TileInfo | null>>({});
  const [hover, setHover] = useState<HoverState | null>(null);

  const rasters = useStore((s) => s.rasters);
  const analyses = useStore((s) => s.analyses);
  const redZones = useStore((s) => s.redZones);
  const rasterUI = useStore((s) => s.rasterUI);
  const maskUI = useStore((s) => s.maskUI);
  const polyUI = useStore((s) => s.polyUI);
  const zoneVisible = useStore((s) => s.zoneVisible);
  const features = useStore((s) => s.features);
  const drawActive = useStore((s) => s.drawActive);
  const fitRequest = useStore((s) => s.fitRequest);

  // ------------------------------------------------------------------ init
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      center: AGRA_CENTER,
      zoom: 12,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "basemap-osm",
            type: "raster",
            source: "osm",
            paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.85 },
          },
        ],
      },
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

      setMapReady(true);
    });

    // Hover: track change polygons under the cursor.
    map.on("mousemove", (e) => {
      if (drawActiveRef.current) return;
      const layerIds = map
        .getStyle()
        .layers.map((l) => l.id)
        .filter((lid) => lid.startsWith("poly-fill-"));
      if (layerIds.length === 0) {
        setHover(null);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (feats.length > 0) {
        setHover({
          x: e.point.x,
          y: e.point.y,
          props: feats[0].properties as unknown as ChangeFeatureProps,
          jobId: feats[0].layer.id.replace("poly-fill-", ""),
          featureId: feats[0].id,
        });
        map.getCanvas().style.cursor = "pointer";
      } else {
        setHover(null);
        map.getCanvas().style.cursor = "";
      }
    });
    map.on("mouseout", () => setHover(null));

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
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
  }, [mapReady, rasters, rasterUI, rasterInfo]);

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

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div className="map-canvas" ref={containerRef} />
      {mapReady && noRasters && (
        <div className="map-hint-card">
          <div className="empty-kicker">No imagery yet</div>
          <p>
            Upload two epochs of the same area — a <strong>before (T1)</strong>{" "}
            and an <strong>after (T2)</strong> GeoTIFF — from the{" "}
            <em>Maps · Layers</em> panel to begin change detection.
          </p>
        </div>
      )}
      <Legend />
      {hover && (
        <HoverPopup
          hover={hover}
          containerWidth={wrapRef.current?.clientWidth ?? 0}
        />
      )}
    </div>
  );
}
