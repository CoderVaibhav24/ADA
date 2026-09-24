import type { StyleSpecification } from "maplibre-gl";

// Agra city — the default view before anything else positions the map.
export const AGRA_CENTER: [number, number] = [78.0081, 27.1767];

/** The one OpenStreetMap basemap every map in the portal draws, attribution included. */
export function osmBasemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "basemap-osm",
        type: "raster",
        source: "osm",
        paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.85 },
      },
    ],
  };
}
