/**
 * The Layer Controls card — Figma 17:4835.
 *
 * The frame lists four flat rows: Encroachments, Parcel Boundaries, Road
 * Network, Satellite Imagery. Two of those four have nothing behind them —
 * there is no cadastral parcel layer and no road layer in this API — so they
 * are not drawn. What replaces them is the layer stack the map actually has,
 * in the OneMap UP shape the scope decision requires: grouped over a common
 * base map, fixed order, one toggle each.
 *
 * Reordering is not here, and there is no affordance suggesting it exists.
 *
 * The frame's bare pill toggles become shadcn `Switch`es, which are focusable,
 * announce their own state, and carry "Shown"/"Hidden" in text beside the
 * colour rather than relying on the fill.
 */

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

import type { ChangeDetectionLabels } from "./labels";
import type { LayerGroupId, LayerId } from "./model";
import { PanelSection, Swatch } from "./parts";
import type { LayerState } from "./useLayerTree";

export function LayerControls({
  labels,
  layers,
  groups,
  onVisibleChange,
  onOpacityChange,
}: {
  labels: ChangeDetectionLabels;
  layers: LayerState[];
  groups: LayerGroupId[];
  onVisibleChange: (id: LayerId, visible: boolean) => void;
  onOpacityChange: (id: LayerId, opacity: number) => void;
}) {
  return (
    <PanelSection title={labels.layers.title} headingId="cd-layers-heading">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-1.5">
            <p className="text-2xs font-medium tracking-wider text-fg-faint uppercase">
              {labels.layers.group(group)}
            </p>
            <ul className="flex flex-col gap-1.5">
              {layers
                .filter((layer) => layer.group === group)
                .map((layer) => (
                  <LayerRow
                    key={layer.id}
                    labels={labels}
                    layer={layer}
                    onVisibleChange={onVisibleChange}
                    onOpacityChange={onOpacityChange}
                  />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelSection>
  );
}

function LayerRow({
  labels,
  layer,
  onVisibleChange,
  onOpacityChange,
}: {
  labels: ChangeDetectionLabels;
  layer: LayerState;
  onVisibleChange: (id: LayerId, visible: boolean) => void;
  onOpacityChange: (id: LayerId, opacity: number) => void;
}) {
  const name = labels.layers.layer(layer.id);
  const switchId = `cd-layer-${layer.id}`;
  const percent = String(Math.round(layer.opacity * 100));
  // An unavailable layer keeps its row rather than vanishing: a tree whose
  // length changes with the data is one the officer has to re-read every time.
  const showSlider = layer.hasOpacity && layer.available && layer.visible;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={switchId}
          className="flex min-w-0 items-center gap-2 text-sm font-normal text-fg-muted"
        >
          {layer.swatch && <Swatch color={layer.swatch} />}
          <span className="truncate">{name}</span>
        </Label>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-2xs text-fg-faint">
            {!layer.available
              ? labels.layers.unavailable
              : layer.visible
                ? labels.layers.on
                : labels.layers.off}
          </span>
          <Switch
            id={switchId}
            checked={layer.available && layer.visible}
            disabled={!layer.available}
            aria-label={labels.layers.toggle(name)}
            onCheckedChange={(next) => onVisibleChange(layer.id, next)}
          />
        </div>
      </div>

      {layer.detail && (
        <p className="truncate ps-4.5 text-2xs text-fg-faint">{layer.detail}</p>
      )}

      {showSlider && (
        <div className="flex items-center gap-2 ps-4.5">
          {/* aria-label, not a <Label htmlFor>: Radix's slider Root is a span
              and cannot be the target of a label. See components/ui/slider. */}
          <Slider
            aria-label={labels.layers.opacity(name)}
            min={0}
            max={100}
            step={5}
            value={[Math.round(layer.opacity * 100)]}
            className="h-4 flex-1"
            onValueChange={([next]) => onOpacityChange(layer.id, (next ?? 100) / 100)}
          />
          <span className="w-9 shrink-0 text-end font-mono text-2xs text-fg-faint tabular">
            {labels.layers.opacityValue(percent)}
          </span>
        </div>
      )}
    </li>
  );
}
