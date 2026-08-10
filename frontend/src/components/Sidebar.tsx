import { useState } from "react";
import type { ReactNode } from "react";
import { sid, useStore } from "../state/store";
import { deleteRaster } from "../state/actions";
import type { Raster } from "../api/types";
import { featureCollectionBounds, shortId } from "../lib/geo";
import LayerRow from "./LayerRow";
import UploadModal from "./UploadModal";
import AnalysisPanel from "./AnalysisPanel";
import RedZonePanel from "./RedZonePanel";
import { IconCaret, IconUpload } from "./Icons";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <MapsSection />
      <AnalysisPanel />
      <RedZonePanel />
    </aside>
  );
}

export function Section({
  title,
  count,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel-section">
      <div className="section-head">
        <button
          type="button"
          className="section-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <IconCaret open={open} />
          <span>{title}</span>
          {count !== undefined && <span className="count-badge">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function RasterStatusChip({ raster }: { raster: Raster }) {
  if (raster.status === "processing") {
    return (
      <span className="chip chip-processing">
        <span className="spinner" aria-hidden="true" />
        processing
      </span>
    );
  }
  if (raster.status === "failed") {
    return (
      <span
        className="chip chip-failed"
        title={raster.error ?? "Processing failed"}
      >
        failed
      </span>
    );
  }
  return <span className="chip chip-ready">ready</span>;
}

function MapsSection() {
  const pid = useStore((s) => s.currentProjectId);
  const rasters = useStore((s) => s.rasters);
  const analyses = useStore((s) => s.analyses);
  const rasterUI = useStore((s) => s.rasterUI);
  const maskUI = useStore((s) => s.maskUI);
  const polyUI = useStore((s) => s.polyUI);
  const features = useStore((s) => s.features);
  const patchRasterUI = useStore((s) => s.patchRasterUI);
  const patchMaskUI = useStore((s) => s.patchMaskUI);
  const patchPolyUI = useStore((s) => s.patchPolyUI);
  const requestFit = useStore((s) => s.requestFit);
  const [showUpload, setShowUpload] = useState(false);

  const doneAnalyses = analyses.filter((a) => a.status === "done");

  return (
    <Section
      title="Maps · Layers"
      count={rasters.length}
      action={
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowUpload(true)}
          disabled={!pid}
        >
          <IconUpload /> Upload map
        </button>
      }
    >
      {rasters.length === 0 && (
        <div className="hint-block">
          <strong>No maps uploaded.</strong> Upload two epochs of the same area
          — a &ldquo;before&rdquo; (T1) and an &ldquo;after&rdquo; (T2) GeoTIFF
          — to run change detection.
        </div>
      )}

      {rasters.map((r) => {
        const ui = rasterUI[sid(r.id)] ?? { visible: true, opacity: 1 };
        return (
          <LayerRow
            key={sid(r.id)}
            name={r.name}
            subtitle={[
              r.captured_at ? `captured ${r.captured_at.slice(0, 10)}` : null,
              r.resolution_m != null ? `${r.resolution_m.toFixed(2)} m/px` : null,
              r.crs ?? null,
            ]
              .filter(Boolean)
              .join(" · ")}
            visible={ui.visible}
            opacity={ui.opacity}
            status={<RasterStatusChip raster={r} />}
            swatch="swatch-raster"
            onToggle={(v) => patchRasterUI(r.id, { visible: v })}
            onOpacity={(o) => patchRasterUI(r.id, { opacity: o })}
            onZoom={
              r.bounds_4326 ? () => requestFit(r.bounds_4326!) : undefined
            }
            onDelete={() => {
              if (window.confirm(`Delete map "${r.name}"?`)) {
                void deleteRaster(r.id);
              }
            }}
          />
        );
      })}

      {doneAnalyses.length > 0 && (
        <>
          <div className="subgroup-label">Analysis overlays</div>
          {doneAnalyses.map((a) => {
            const key = sid(a.id);
            const mask = maskUI[key] ?? { visible: true, opacity: 0.75 };
            const poly = polyUI[key] ?? { visible: true, opacity: 1 };
            const fc = features[key];
            const bounds = fc ? featureCollectionBounds(fc) : null;
            const zoom = bounds ? () => requestFit(bounds) : undefined;
            return (
              <div key={key} className="analysis-layer-group">
                <LayerRow
                  name={`Change heat — run ${shortId(a.id)}`}
                  visible={mask.visible}
                  opacity={mask.opacity}
                  swatch="swatch-heat"
                  onToggle={(v) => patchMaskUI(a.id, { visible: v })}
                  onOpacity={(o) => patchMaskUI(a.id, { opacity: o })}
                  onZoom={zoom}
                />
                <LayerRow
                  name={`Change polygons — run ${shortId(a.id)}`}
                  visible={poly.visible}
                  opacity={poly.opacity}
                  swatch="swatch-change"
                  onToggle={(v) => patchPolyUI(a.id, { visible: v })}
                  onOpacity={(o) => patchPolyUI(a.id, { opacity: o })}
                  onZoom={zoom}
                />
              </div>
            );
          })}
        </>
      )}

      {showUpload && pid && (
        <UploadModal projectId={pid} onClose={() => setShowUpload(false)} />
      )}
    </Section>
  );
}
