import { sid, useStore } from "../state/store";
import { deleteRedZone } from "../state/actions";
import { polygonBounds } from "../lib/geo";
import { Section } from "./Sidebar";
import LayerRow from "./LayerRow";
import { IconPolygon } from "./Icons";

export default function RedZonePanel() {
  const pid = useStore((s) => s.currentProjectId);
  const zones = useStore((s) => s.redZones);
  const zoneVisible = useStore((s) => s.zoneVisible);
  const setZoneVisible = useStore((s) => s.setZoneVisible);
  const drawActive = useStore((s) => s.drawActive);
  const setDrawActive = useStore((s) => s.setDrawActive);
  const requestFit = useStore((s) => s.requestFit);

  return (
    <Section
      title="Red Zones"
      count={zones.length}
      action={
        <button
          type="button"
          className={`btn btn-sm ${drawActive ? "btn-danger" : "btn-ghost"}`}
          onClick={() => setDrawActive(!drawActive)}
          disabled={!pid}
        >
          <IconPolygon /> {drawActive ? "Cancel drawing" : "Draw red zone"}
        </button>
      }
    >
      {drawActive && (
        <div className="hint-block hint-danger">
          Click on the map to place vertices. Click the first point (or press{" "}
          <span className="mono">Enter</span>) to close the polygon —
          you&rsquo;ll be asked for a name. <span className="mono">Esc</span>{" "}
          cancels.
        </div>
      )}

      {zones.length === 0 && !drawActive && (
        <div className="hint-block">
          No red zones defined. Draw prohibited / protected areas (e.g. TTZ
          buffers, nala margins, green belts) — new construction inside them is
          flagged as <strong>illegal</strong>.
        </div>
      )}

      {zones.map((z) => {
        const bounds = polygonBounds(z.geometry);
        return (
          <LayerRow
            key={sid(z.id)}
            name={z.name}
            visible={zoneVisible[sid(z.id)] ?? true}
            swatch="swatch-redzone"
            onToggle={(v) => setZoneVisible(z.id, v)}
            onZoom={bounds ? () => requestFit(bounds) : undefined}
            onDelete={() => {
              if (window.confirm(`Delete red zone "${z.name}"?`)) {
                void deleteRedZone(z.id);
              }
            }}
          />
        );
      })}
    </Section>
  );
}
