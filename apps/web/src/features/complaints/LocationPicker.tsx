import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { AGRA_CENTER, osmBasemapStyle } from "@/components/map/basemap";
import { Icon } from "@/lib/icons";
import { parseCoordinate } from "./complaintForm";
import type { ComplaintNewLabels } from "./complaintLabels";

type Props = {
  labels: ComplaintNewLabels;
  latitude: string;
  longitude: string;
  disabled: boolean;
  onPick: (latitude: string, longitude: string) => void;
};

const PIN_COLOUR = "#ce862e";

// Six decimals is about a tenth of a metre, the precision the form stores.
function fixed(value: number): string {
  return value.toFixed(6);
}

function validPoint(lat: string, lon: string): [number, number] | null {
  const la = parseCoordinate(lat);
  const lo = parseCoordinate(lon);
  if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return [lo, la];
}

/** Hemisphere-suffixed read-back, e.g. "27.176700°N, 78.008100°E". */
function describe([lon, lat]: [number, number]): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}°${ns}, ${Math.abs(lon).toFixed(6)}°${ew}`;
}

// Decided once, before the map is built, so the fallback is known at first render.
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) !== null;
  } catch {
    return false;
  }
}

/**
 * Figma's "Select Location on Map": click the map, drag the pin, or pan with the
 * keyboard and press "Pin location" to drop it at the centre. Writes the form's
 * latitude/longitude and nothing else.
 */
export function LocationPicker({ labels, latitude, longitude, disabled, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  const disabledRef = useRef(disabled);
  const [failed] = useState(() => !webglAvailable());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pickRef.current = onPick;
    disabledRef.current = disabled;
  }, [onPick, disabled]);

  const point = validPoint(latitude, longitude);
  const lon = point?.[0];
  const lat = point?.[1];
  const canvasLabel = labels.map.canvas;

  // Built once. The starting view is read from a ref so a later coordinate
  // change moves the pin (below) instead of rebuilding the map.
  const startRef = useRef(point);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || failed) return;

    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        center: startRef.current ?? AGRA_CENTER,
        zoom: startRef.current ? 16 : 12,
        attributionControl: false,
        style: osmBasemapStyle(),
      });
    } catch {
      // The pin button stays disabled; the coordinate boxes beside this card still work.
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("click", (event) => {
      if (disabledRef.current) return;
      pickRef.current(fixed(event.lngLat.lat), fixed(event.lngLat.lng));
    });
    map.on("load", () => {
      setReady(true);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [failed]);

  useEffect(() => {
    mapRef.current?.getCanvas().setAttribute("aria-label", canvasLabel);
  }, [canvasLabel, ready]);

  // The pin follows the form, whichever way the form was changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lon === undefined || lat === undefined) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current === null) {
      const marker = new maplibregl.Marker({ color: PIN_COLOUR, draggable: true });
      marker.on("dragend", () => {
        const at = marker.getLngLat();
        if (!disabledRef.current) pickRef.current(fixed(at.lat), fixed(at.lng));
      });
      // The read-back below says where the pin is; the glyph adds nothing to a screen reader.
      marker.getElement().setAttribute("aria-hidden", "true");
      markerRef.current = marker;
    }
    markerRef.current.setLngLat([lon, lat]).addTo(map);
    if (!map.getBounds().contains([lon, lat])) map.easeTo({ center: [lon, lat] });
  }, [lon, lat, ready]);

  useEffect(() => {
    markerRef.current?.setDraggable(!disabled);
  }, [disabled, lon, lat]);

  const pinCentre = () => {
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    onPick(fixed(centre.lat), fixed(centre.lng));
  };

  return (
    <section
      aria-labelledby="complaint-map-title"
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line-subtle bg-surface-sunken"
    >
      <header className="border-b border-line-subtle px-3.5 py-2.5">
        <h2 id="complaint-map-title" className="font-display text-xs font-bold text-fg-strong">
          {labels.map.title}
        </h2>
      </header>

      <div className="relative h-64 w-full bg-surface-canvas">
        {failed ? (
          <p
            role="status"
            className="flex h-full items-center justify-center p-4 text-center text-xs text-fg-muted text-pretty"
          >
            {labels.map.unavailable}
          </p>
        ) : (
          <>
            {/* Sized, not positioned: maplibre's own CSS sets `position: relative`
                on this node, which would collapse `absolute inset-0` to zero height. */}
            <div ref={containerRef} className="size-full" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !ready}
              onClick={pinCentre}
              className="absolute right-2 bottom-2 z-10 h-7 border-line-accent bg-surface-sunken/90 text-2xs font-semibold tracking-wide text-fg-link uppercase"
            >
              <Icon name="map.pin" className="size-3.5" />
              {point ? labels.map.movePin : labels.map.pin}
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 px-3.5 py-2.5">
        <p aria-live="polite" className="flex items-center gap-1.5 font-mono text-xs text-fg-link">
          <Icon name="map.pin" className="size-3.5 shrink-0" />
          {point ? describe(point) : labels.map.none}
        </p>
        <p className="text-2xs text-fg-faint text-pretty">{labels.map.hint}</p>
      </div>
    </section>
  );
}
