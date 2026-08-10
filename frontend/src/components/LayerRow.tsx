import type { ReactNode } from "react";
import { IconTarget, IconTrash } from "./Icons";

interface LayerRowProps {
  name: string;
  visible: boolean;
  opacity?: number;
  onToggle: (visible: boolean) => void;
  onOpacity?: (opacity: number) => void;
  onZoom?: () => void;
  onDelete?: () => void;
  /** Small chip / spinner rendered after the name. */
  status?: ReactNode;
  /** Swatch class describing the layer color in the stack. */
  swatch?: string;
  subtitle?: string;
}

export default function LayerRow({
  name,
  visible,
  opacity,
  onToggle,
  onOpacity,
  onZoom,
  onDelete,
  status,
  swatch,
  subtitle,
}: LayerRowProps) {
  return (
    <div className={`layer-row${visible ? "" : " is-hidden"}`}>
      <div className="layer-row-top">
        <label className="layer-check">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {swatch && <span className={`swatch ${swatch}`} aria-hidden="true" />}
          <span className="layer-name" title={name}>
            {name}
          </span>
        </label>
        {status}
        <span className="layer-row-actions">
          {onZoom && (
            <button
              type="button"
              className="icon-btn"
              title="Zoom to layer"
              onClick={onZoom}
            >
              <IconTarget />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="icon-btn danger"
              title="Delete"
              onClick={onDelete}
            >
              <IconTrash />
            </button>
          )}
        </span>
      </div>
      {subtitle && <div className="layer-subtitle">{subtitle}</div>}
      {onOpacity && opacity !== undefined && (
        <div className="layer-opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            aria-label={`${name} opacity`}
          />
          <span className="mono">{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}
