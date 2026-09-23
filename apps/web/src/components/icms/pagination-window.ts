/**
 * Windowed page list. Always shows first and last so the ends stay reachable
 * in one click; `null` marks an ellipsis gap.
 */
export function buildPageWindow(
  page: number,
  pageCount: number,
  siblings = 1,
): Array<number | null> {
  // 5 = first + last + current + two ellipses; below that just list them all.
  const slots = siblings * 2 + 5;
  if (pageCount <= slots) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, pageCount);
  const showLeftGap = left > 2;
  const showRightGap = right < pageCount - 1;

  const out: Array<number | null> = [1];
  if (showLeftGap) out.push(null);
  else if (left === 2) out.push(2);

  for (let p = Math.max(left, 2); p <= Math.min(right, pageCount - 1); p++) {
    if (!out.includes(p)) out.push(p);
  }

  if (showRightGap) out.push(null);
  else if (right === pageCount - 1 && !out.includes(pageCount - 1)) {
    out.push(pageCount - 1);
  }
  out.push(pageCount);
  return out;
}

