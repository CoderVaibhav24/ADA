import type { Polygon } from "geojson";
import type { ChangeFeatureCollection } from "../api/types";

export type BBox = [number, number, number, number];

export function polygonBounds(poly: Polygon): BBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of poly.coordinates) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function featureCollectionBounds(fc: ChangeFeatureCollection): BBox | null {
  let out: BBox | null = null;
  for (const f of fc.features) {
    const b = polygonBounds(f.geometry);
    if (!b) continue;
    out = out
      ? [
          Math.min(out[0], b[0]),
          Math.min(out[1], b[1]),
          Math.max(out[2], b[2]),
          Math.max(out[3], b[3]),
        ]
      : b;
  }
  return out;
}

export function formatArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString("en-IN")} m²`;
}

export function shortId(id: string | number): string {
  const s = String(id);
  return s.length > 6 ? s.slice(0, 6) : s;
}
