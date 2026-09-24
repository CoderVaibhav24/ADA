/**
 * The Legend card — Figma 17:4933.
 *
 * The frame lists four entries: high confidence encroachment, medium
 * confidence, parcel boundary, cleared / resolved. Only the shape of that card
 * survives; the entries are rewritten to describe what the map actually paints.
 *
 * The frame's legend describes CONFIDENCE, but MapView colours by
 * classification — `status` illegal against change, greyed once an officer has
 * dismissed it, thickened once confirmed — and confidence is carried in the
 * detection list instead. A legend explaining a colour scheme the map does not
 * use is worse than none. "Parcel boundary" is dropped outright: there is no
 * parcel layer.
 *
 * The swatch hexes are the literal constants in components/MapView.tsx. They
 * are repeated rather than imported because they are MapLibre paint values
 * there and CSS colours here, and a shared export would invite someone to
 * change one and assume the other had followed.
 */

import type { ChangeDetectionLabels } from "./labels";
import { PanelSection, Swatch } from "./parts";

const ENTRIES = [
  { key: "illegal", color: "#ff4438" },
  { key: "change", color: "#ffb020" },
  { key: "confirmed", color: "#ff5c52" },
  { key: "rejected", color: "#6b7280" },
  { key: "redZone", color: "#ff2d55" },
] as const;

export function MapLegend({ labels }: { labels: ChangeDetectionLabels }) {
  return (
    <PanelSection title={labels.legend.title} headingId="cd-legend-heading">
      <ul className="flex flex-col gap-1.5">
        {ENTRIES.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2">
            <Swatch color={entry.color} />
            <span className="text-xs text-pretty text-fg-muted">
              {labels.legend[entry.key]}
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
