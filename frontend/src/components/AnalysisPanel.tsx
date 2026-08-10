import { useState } from "react";
import { sid, useStore } from "../state/store";
import { deleteAnalysis, reviewPolygon, runAnalysis } from "../state/actions";
import { downloadUrl } from "../api/client";
import type {
  Analysis,
  AnalysisMode,
  AnalysisStats,
  ChangeFeatureCollection,
  Id,
} from "../api/types";
import { featureCollectionBounds, formatArea, shortId } from "../lib/geo";
import { Section } from "./Sidebar";
import {
  IconCheck,
  IconCross,
  IconDownload,
  IconPlay,
  IconTarget,
  IconTrash,
} from "./Icons";

export default function AnalysisPanel() {
  const pid = useStore((s) => s.currentProjectId);
  const rasters = useStore((s) => s.rasters);
  const analyses = useStore((s) => s.analyses);
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [mode, setMode] = useState<AnalysisMode>("ai");
  const [starting, setStarting] = useState(false);

  const ready = rasters.filter((r) => r.status === "ready");
  const canRun = Boolean(pid && t1 && t2 && t1 !== t2 && !starting);

  const rasterName = (id: string) =>
    ready.find((r) => sid(r.id) === id)?.name ?? `map ${shortId(id)}`;

  async function start() {
    if (!pid || !canRun) return;
    setStarting(true);
    await runAnalysis(pid, t1, t2, mode);
    setStarting(false);
  }

  const sorted = [...analyses].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return (
    <Section title="Change Analysis" count={analyses.length}>
      <div className="analysis-form">
        <label className="field">
          <span>Before — T1</span>
          <select
            className="select"
            value={t1}
            onChange={(e) => setT1(e.target.value)}
          >
            <option value="">select epoch…</option>
            {ready.map((r) => (
              <option key={sid(r.id)} value={sid(r.id)}>
                {r.name}
                {r.captured_at ? ` (${r.captured_at.slice(0, 10)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>After — T2</span>
          <select
            className="select"
            value={t2}
            onChange={(e) => setT2(e.target.value)}
          >
            <option value="">select epoch…</option>
            {ready.map((r) => (
              <option key={sid(r.id)} value={sid(r.id)}>
                {r.name}
                {r.captured_at ? ` (${r.captured_at.slice(0, 10)})` : ""}
              </option>
            ))}
          </select>
        </label>
        {t1 && t1 === t2 && (
          <div className="form-error">T1 and T2 must be different maps.</div>
        )}

        <div className="field">
          <span>Detection mode</span>
          <div className="mode-toggle" role="radiogroup" aria-label="Detection mode">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "ai"}
              className={`mode-option${mode === "ai" ? " is-active" : ""}`}
              onClick={() => setMode("ai")}
            >
              <strong>AI Mode</strong>
              <small>Full model pipeline · evidence-grade · minutes</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "diff"}
              className={`mode-option${mode === "diff" ? " is-active" : ""}`}
              onClick={() => setMode("diff")}
            >
              <strong>Diff Mode</strong>
              <small>Classical difference · quick triage · seconds</small>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!canRun}
          onClick={() => void start()}
        >
          <IconPlay /> {starting ? "Starting…" : "Run detection"}
        </button>
        {ready.length < 2 && (
          <div className="hint-inline">
            Needs two <em>ready</em> maps of the same area.
          </div>
        )}
      </div>

      {sorted.map((a) => (
        <AnalysisCard
          key={sid(a.id)}
          analysis={a}
          t1Name={rasterName(sid(a.raster_t1_id))}
          t2Name={rasterName(sid(a.raster_t2_id))}
        />
      ))}
    </Section>
  );
}

/**
 * `coregistration_shift_px` is a [dy, dx] pair. Rendering the array directly
 * concatenates the two numbers, so a (7.0, 4.2) px shift read as "74.2 px" —
 * report the magnitude instead, and say plainly when nothing was shifted.
 */
function formatShift(stats: AnalysisStats): string {
  const s = stats.coregistration_shift_px;
  const [dy, dx] = Array.isArray(s) ? s : [0, 0];
  if (!dy && !dx) return "geo-referencing trusted (no shift applied)";
  const mag = Math.hypot(dy, dx);
  return `co-registration ${mag.toFixed(1)} px (Δy ${dy.toFixed(1)}, Δx ${dx.toFixed(1)})`;
}

function AnalysisCard({
  analysis: a,
  t1Name,
  t2Name,
}: {
  analysis: Analysis;
  t1Name: string;
  t2Name: string;
}) {
  const features = useStore((s) => s.features[sid(a.id)]);
  const requestFit = useStore((s) => s.requestFit);
  const active = a.status === "queued" || a.status === "running";
  const bounds = features ? featureCollectionBounds(features) : null;

  return (
    <div className={`analysis-card status-${a.status}`}>
      <div className="analysis-card-head">
        <span className="mono analysis-id">RUN {shortId(a.id)}</span>
        <span className={`chip chip-mode-${a.mode ?? "ai"}`}>
          {(a.mode ?? "ai") === "diff" ? "diff" : "AI"}
        </span>
        <span className={`chip chip-${a.status}`}>
          {active && <span className="spinner" aria-hidden="true" />}
          {a.status}
        </span>
        <span className="layer-row-actions">
          {bounds && (
            <button
              type="button"
              className="icon-btn"
              title="Zoom to detected changes"
              onClick={() => requestFit(bounds)}
            >
              <IconTarget />
            </button>
          )}
          <button
            type="button"
            className="icon-btn danger"
            title="Delete analysis"
            onClick={() => {
              if (window.confirm(`Delete analysis run ${shortId(a.id)}?`)) {
                void deleteAnalysis(a.id);
              }
            }}
          >
            <IconTrash />
          </button>
        </span>
      </div>

      <div className="analysis-pair" title={`${t1Name} → ${t2Name}`}>
        <span>{t1Name}</span>
        <span className="pair-arrow">→</span>
        <span>{t2Name}</span>
      </div>

      {active && (
        <div className="analysis-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round(a.progress * 100)}%` }}
            />
          </div>
          <div className="progress-meta mono">
            <span>{a.stage ?? "waiting…"}</span>
            <span>{Math.round(a.progress * 100)}%</span>
          </div>
        </div>
      )}

      {a.status === "failed" && (
        <div className="form-error">{a.error ?? "Analysis failed"}</div>
      )}

      {a.status === "done" && a.stats && (
        <div className="analysis-stats">
          <div className="stat">
            <span className="stat-value mono">{a.stats.polygons}</span>
            <span className="stat-label">changes</span>
          </div>
          <div className="stat stat-danger">
            <span className="stat-value mono">{a.stats.illegal}</span>
            <span className="stat-label">illegal</span>
          </div>
          <div className="stat">
            <span className="stat-value mono">
              {formatArea(a.stats.changed_area_m2)}
            </span>
            <span className="stat-label">changed area</span>
          </div>
          <div className="stat-footnote mono">
            {a.stats.working_resolution_m} m/px · {formatShift(a.stats)}
          </div>
          {a.stats.models_used && a.stats.models_used.length > 0 && (
            <details className="models-used">
              <summary>Models used ({a.stats.models_used.length})</summary>
              <ol>
                {a.stats.models_used.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ol>
            </details>
          )}
          <div className="export-row">
            <a
              className="btn btn-ghost btn-sm"
              href={downloadUrl.reportCsv(a.id)}
              download
            >
              <IconDownload /> CSV register
            </a>
            <a
              className="btn btn-ghost btn-sm"
              href={downloadUrl.reportGeojson(a.id)}
              download
            >
              <IconDownload /> GeoJSON
            </a>
          </div>
        </div>
      )}

      {a.status === "done" && features && features.features.length > 0 && (
        <ReviewQueue analysisId={a.id} features={features} />
      )}
    </div>
  );
}

/**
 * Officer review queue — the human-in-the-loop step. Every confirm/reject is
 * stored against the polygon and exported as a labelled example for the next
 * fine-tuning cycle, so the system only ever retrains on verified ground truth.
 */
function ReviewQueue({
  analysisId,
  features,
}: {
  analysisId: Id;
  features: ChangeFeatureCollection;
}) {
  const [showReviewed, setShowReviewed] = useState(false);
  const requestFit = useStore((s) => s.requestFit);

  const rows = features.features.filter(
    (f) => showReviewed || (f.properties.review_status ?? "pending") === "pending",
  );
  const pending = features.features.filter(
    (f) => (f.properties.review_status ?? "pending") === "pending",
  ).length;
  const confirmed = features.features.filter(
    (f) => f.properties.review_status === "confirmed",
  ).length;

  return (
    <div className="review-queue">
      <div className="review-queue-head">
        <span>
          Officer review — <strong>{pending}</strong> pending ·{" "}
          <strong>{confirmed}</strong> confirmed
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowReviewed(!showReviewed)}
        >
          {showReviewed ? "Hide reviewed" : "Show all"}
        </button>
      </div>

      {rows.length === 0 && (
        <div className="hint-inline">
          All detections reviewed. Export the labelled set from the project
          header to feed the next fine-tuning cycle.
        </div>
      )}

      <ul className="review-list">
        {rows.slice(0, 50).map((f) => {
          const p = f.properties;
          const status = p.review_status ?? "pending";
          return (
            <li key={String(f.id)} className={`review-item review-${status}`}>
              <button
                type="button"
                className="review-item-main"
                title="Zoom to this detection"
                onClick={() => {
                  const b = featureCollectionBounds({
                    type: "FeatureCollection",
                    features: [f],
                  });
                  if (b) requestFit(b);
                }}
              >
                <span
                  className={`badge ${
                    p.status === "illegal" ? "badge-illegal" : "badge-change"
                  }`}
                >
                  {p.status === "illegal" ? "Illegal" : "Change"}
                </span>
                <span className="review-label">{p.label}</span>
                <span className="mono review-meta">
                  {formatArea(p.area_m2)} · {Math.round(p.confidence * 100)}%
                </span>
              </button>
              <span className="review-actions">
                <button
                  type="button"
                  className={`btn btn-sm${status === "confirmed" ? " btn-primary" : ""}`}
                  title="Confirm as a real violation"
                  onClick={() =>
                    void reviewPolygon(
                      analysisId,
                      f.id as Id,
                      status === "confirmed" ? "pending" : "confirmed",
                    )
                  }
                >
                  <IconCheck /> Confirm
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${status === "rejected" ? " btn-danger" : ""}`}
                  title="Mark as a false positive"
                  onClick={() =>
                    void reviewPolygon(
                      analysisId,
                      f.id as Id,
                      status === "rejected" ? "pending" : "rejected",
                    )
                  }
                >
                  <IconCross /> False positive
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > 50 && (
        <div className="hint-inline">
          Showing the 50 largest of {rows.length}. Use the CSV register for the
          full list.
        </div>
      )}
    </div>
  );
}
