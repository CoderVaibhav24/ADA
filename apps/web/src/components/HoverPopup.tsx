import { useEffect, useState } from "react";
import type { ChangeFeatureProps } from "../api/types";
import { objectUrl } from "../api/client";
import { formatArea } from "../lib/geo";

export interface HoverState {
  x: number;
  y: number;
  props: ChangeFeatureProps;
  /** analysis job id, parsed from the polygon layer id */
  jobId?: string;
  /** change-polygon DB id (GeoJSON feature id) */
  featureId?: number | string;
}

export default function HoverPopup({
  hover,
  containerWidth,
  hint,
}: {
  hover: HoverState;
  containerWidth: number;
  /** A muted line at the foot of the card. */
  hint?: string;
}) {
  const { x, y, props, jobId, featureId } = hover;
  const illegal = props.status === "illegal";
  const review = props.review_status ?? "pending";
  const flipX = containerWidth > 0 && x > containerWidth - 300;
  const previewPath =
    jobId && featureId != null
      ? `/api/analyses/${jobId}/polygons/${featureId}/preview.png`
      : null;

  // An <img src> carries no Authorization header, and the preview route is
  // authenticated — so the bytes are fetched with the token and handed to the
  // tag as a blob URL. Revoked on unmount, or the popup leaks one object URL
  // per polygon the officer hovers over, which on a dense scene is thousands.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewPath) {
      setPreviewUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    objectUrl(previewPath)
      .then((created) => {
        url = created;
        if (cancelled) {
          URL.revokeObjectURL(created);
        } else {
          setPreviewUrl(created);
        }
      })
      .catch(() => {
        // A missing preview is not an error worth showing: the <img> was
        // already hidden on failure before this change.
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewPath]);

  return (
    <div
      className={`hover-popup${illegal ? " is-illegal" : ""}`}
      style={{
        left: x,
        top: y,
        transform: `translate(${flipX ? "calc(-100% - 14px)" : "14px"}, 14px)`,
      }}
    >
      <div className="hover-popup-head">
        <span className={`badge ${illegal ? "badge-illegal" : "badge-change"}`}>
          {illegal ? "Illegal" : "Change"}
        </span>
        <span className="hover-label">{props.label}</span>
      </div>
      {review !== "pending" && (
        <div className={`review-banner review-${review}`}>
          {review === "confirmed"
            ? "Confirmed by officer"
            : "Marked false positive"}
          {props.reviewed_at ? ` · ${props.reviewed_at.slice(0, 10)}` : ""}
        </div>
      )}
      <dl className="hover-facts">
        <div>
          <dt>Area</dt>
          <dd className="mono">{formatArea(props.area_m2)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="mono">{Math.round(props.confidence * 100)}%</dd>
        </div>
        {props.red_zone_overlap_pct > 0 && (
          <div>
            <dt>Red-zone overlap</dt>
            <dd className="mono danger-text">
              {Math.round(props.red_zone_overlap_pct)}%
            </dd>
          </div>
        )}
      </dl>
      {previewUrl && (
        <img
          className="hover-preview"
          src={previewUrl}
          alt="Before / after patch"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {hint && <p className="hover-hint">{hint}</p>}
    </div>
  );
}
