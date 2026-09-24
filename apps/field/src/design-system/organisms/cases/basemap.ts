import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import { caseMetrics, casePalette } from '../../tokens';

export type MapPoint = { readonly latitude: number; readonly longitude: number };

// Required by the OSM tile licence wherever the tiles are shown; not translated.
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

// The portal's OSM raster (apps/web basemap.ts), darkened into the case palette, with the case pin drawn in GL.
export function caseMapStyle(point: MapPoint): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION,
      },
      site: {
        type: 'geojson',
        data: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      },
    },
    layers: [
      { id: 'backdrop', type: 'background', paint: { 'background-color': casePalette.mapBackdrop } },
      {
        id: 'basemap-osm',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-saturation': -0.55,
          'raster-brightness-max': 0.58,
          'raster-brightness-min': 0.03,
          'raster-contrast': 0.1,
          'raster-fade-duration': 0,
        },
      },
      { id: 'tint', type: 'background', paint: { 'background-color': casePalette.mapTint, 'background-opacity': 0.3 } },
      {
        id: 'site-halo',
        type: 'circle',
        source: 'site',
        paint: {
          'circle-radius': caseMetrics.pinHalo / 2,
          'circle-color': casePalette.mapPinHalo,
          'circle-blur': 0.35,
        },
      },
      {
        id: 'site-pin',
        type: 'circle',
        source: 'site',
        paint: {
          'circle-radius': caseMetrics.pinSize / 2,
          'circle-color': casePalette.mapPin,
          'circle-stroke-width': caseMetrics.pinBorder,
          'circle-stroke-color': casePalette.mapPinBorder,
        },
      },
    ],
  };
}
