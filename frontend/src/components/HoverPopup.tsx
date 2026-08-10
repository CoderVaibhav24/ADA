import type { ChangeFeatureProps } from "../api/types";
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
}: {
  hover: HoverState;
  containerWidth: number;
}) {
  const { x, y, props, jobId, featureId } = hover;
  const illegal = props.status === "illegal";
  const review = props.review_status ?? "pending";
  const flipX = containerWidth > 0 && x > containerWidth - 300;
  const previewUrl =
    jobId && featureId != null
      ? `/api/analyses/${jobId}/polygons/${featureId}/preview.png`
      : null;

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
    </div>
  );
}
