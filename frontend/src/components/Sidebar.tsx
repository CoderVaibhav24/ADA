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
import { IconCaret, IconGrip, IconUpload } from "./Icons";

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
    // Ingesting a grid tile runs for many minutes. A bare "processing" cannot
    // tell a slow job from a stuck one, which is the only question anyone has
    // while waiting — so show how far it has got and what it is doing. The
    // percentage is omitted until the backend reports one, so a raster queued
    // behind another does not sit at a misleading "0%".
    const percent = Math.round((raster.progress ?? 0) * 100);
    return (
      <span
        className="chip chip-processing"
        title={raster.stage ?? "Queued for processing"}
      >
        <span className="spinner" aria-hidden="true" />
        {percent > 0 ? `${percent}%` : "queued"}
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

/**
 * Ingest progress bar, deliberately the same markup as the analysis one — a
 * long-running job should look the same wherever it appears in the UI.
 */
function RasterProgress({ raster }: { raster: Raster }) {
  if (raster.status !== "processing") return null;
  const percent = Math.round((raster.progress ?? 0) * 100);
  return (
    <div className="analysis-progress">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-meta mono">
        <span>{raster.stage ?? "queued…"}</span>
        <span>{percent}%</span>
      </div>
    </div>
  );
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
  const rasterOrder = useStore((s) => s.rasterOrder);
  const reorderRasters = useStore((s) => s.reorderRasters);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // The row whose drag is temporarily suppressed. A draggable ancestor makes
  // Chrome start a native drag on mousedown-and-move, which is exactly the
  // gesture the opacity slider needs — so the row stops being draggable for as
  // long as the pointer is down on one of its controls.
  const [noDragKey, setNoDragKey] = useState<string | null>(null);

  const doneAnalyses = analyses.filter((a) => a.status === "done");

  // Draw order is the user's, not the server's. `rasterOrder` holds ids; resolve
  // them against the polled list, then append anything the order has not caught
  // up with yet so a freshly uploaded map can never be missing from the panel.
  const byId = new Map(rasters.map((r) => [sid(r.id), r]));
  const ordered = [
    ...rasterOrder.map((id) => byId.get(id)).filter((r): r is Raster => !!r),
    ...rasters.filter((r) => !rasterOrder.includes(sid(r.id))),
  ];

  function handleDrop(targetId: string, payloadId?: string) {
    const source = dragId ?? payloadId;
    if (source && source !== targetId) reorderRasters(source, targetId);
    setDragId(null);
    setOverId(null);
    setNoDragKey(null);
  }

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

      {ordered.length > 1 && (
        <div className="reorder-hint">
          Drag a row <IconGrip size={11} /> to restack — the top map draws over the
          ones below it.
        </div>
      )}

      {ordered.map((r, index) => {
        const key = sid(r.id);
        const ui = rasterUI[key] ?? { visible: true, opacity: 1 };
        // Where the row will actually land, so the indicator does not promise
        // one thing and the drop do another: removing the dragged row first
        // means a downward move settles AT the target's index (below it), while
        // an upward move settles above.
        const dragIndex = dragId
          ? ordered.findIndex((o) => sid(o.id) === dragId)
          : -1;
        const isTarget = overId === key && dragIndex >= 0 && dragId !== key;
        return (
          <div
            key={key}
            className={
              "layer-drop" +
              (dragId === key ? " is-dragging" : "") +
              (isTarget
                ? dragIndex < index
                  ? " is-drop-below"
                  : " is-drop-above"
                : "")
            }
            draggable={noDragKey !== key}
            onMouseDown={(e) => {
              const el = e.target as HTMLElement;
              setNoDragKey(el.closest("input, button, a") ? key : null);
            }}
            onMouseUp={() => setNoDragKey(null)}
            onDragStart={(e) => {
              setDragId(key);
              e.dataTransfer.effectAllowed = "move";
              // Firefox ignores a drag that carries no payload.
              e.dataTransfer.setData("text/plain", key);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              // preventDefault unconditionally: without it the browser refuses
              // the drop, and gating it on React state means a drop can be
              // silently rejected because a re-render had not landed yet.
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOverId(key);
            }}
            onDragLeave={() => setOverId((o) => (o === key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              // The id travels in the payload as well as in state, so the drop
              // still resolves if the dragstart re-render was missed.
              handleDrop(key, e.dataTransfer.getData("text/plain") || undefined);
            }}
          >
          <LayerRow
            handle={
              // Affordance only — the whole row is the drag target now, so
              // nobody has to hit a 14px icon to reorder anything.
              <span className="drag-handle" aria-hidden="true">
                <IconGrip />
              </span>
            }
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
            footer={<RasterProgress raster={r} />}
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
          </div>
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
