/**
 * The tab bar's outline pieces: a circular dip in the top edge, eased in by small fillets, plus the
 * bar's rounded sides. Paths are built once per layout; the notch slides by translating them.
 */

export type NotchGeometry = {
  /** Radius of the dip: the circle's radius plus the gap around it. */
  notchR: number;
  /** The dip's centre below the top edge (the circle's centre). */
  centreY: number;
  /** Radius of the fillets joining the top edge to the dip. */
  shoulder: number;
};

// Distance from the dip's centre to where its fillet leaves the flat top edge (fillet tangent to the edge and the dip).
export function notchHalfWidth({ notchR, centreY, shoulder }: NotchGeometry): number {
  'worklet';
  const reach = notchR + shoulder;
  const dy = shoulder - centreY;
  return Math.sqrt(Math.max(0, reach * reach - dy * dy));
}

// Keeps the dip's centre where the whole dip clears the bar's rounded corners.
export function clampNotchX(x: number, width: number, radius: number, half: number): number {
  'worklet';
  const min = radius + half;
  return Math.min(Math.max(x, min), Math.max(min, width - min));
}

// The top edge from x = 0 to `width` at y = 0, dipping about `notchX`: fillet, dip arc, fillet.
function topEdge(width: number, notchX: number, geometry: NotchGeometry): string {
  const { notchR, centreY, shoulder: f } = geometry;
  const half = notchHalfWidth(geometry);
  // Where each fillet meets the dip: on the line from the dip's centre to the fillet's centre.
  const k = notchR / (notchR + f);
  const tx = half * k;
  const ty = centreY + (f - centreY) * k;
  const large = ty < centreY ? 1 : 0;
  return (
    `M 0 0 L ${notchX - half} 0 ` +
    `A ${f} ${f} 0 0 1 ${notchX - tx} ${ty} ` +
    `A ${notchR} ${notchR} 0 ${large} 0 ${notchX + tx} ${ty} ` +
    `A ${f} ${f} 0 0 1 ${notchX + half} 0 L ${width} 0`
  );
}

// A strip `width` wide with the dip at its centre and square ends; the container's rounded clip makes the corners.
export function wideNotchPath(width: number, height: number, geometry: NotchGeometry): string {
  return `${topEdge(width, width / 2, geometry)} L ${width} ${height} L 0 ${height} Z`;
}

// The same top edge as an open line, for strokes.
export function wideNotchEdge(width: number, geometry: NotchGeometry): string {
  return topEdge(width, width / 2, geometry);
}

// The bar's sides, bottom and rounded corners as one open line inset by `inset`, top-left corner round to top-right.
export function barSidesPath(width: number, height: number, radius: number, inset: number): string {
  const r = radius;
  const a = r - inset;
  return (
    `M ${r} ${inset} A ${a} ${a} 0 0 0 ${inset} ${r} ` +
    `L ${inset} ${height - r} A ${a} ${a} 0 0 0 ${r} ${height - inset} ` +
    `L ${width - r} ${height - inset} A ${a} ${a} 0 0 0 ${width - inset} ${height - r} ` +
    `L ${width - inset} ${r} A ${a} ${a} 0 0 0 ${width - r} ${inset}`
  );
}
