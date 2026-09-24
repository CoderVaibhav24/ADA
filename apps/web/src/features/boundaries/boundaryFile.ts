/**
 * The boundary import's pure parts: which file is acceptable and how a result reads.
 *
 * No React and no `@/` import, so `npm test` runs it with type stripping alone.
 */

export const BOUNDARY_ACCEPT = ".kml,.kmz";

export const FOLDER_ORDER = ["zones", "villages", "parcels", "reserved"] as const;

export type Folder = (typeof FOLDER_ORDER)[number];

export type Counts = { inserted: number; updated: number; deactivated: number; rejected: number };

/** A KML or KMZ by its name; the server checks the content. */
export function isBoundaryFile(name: string): boolean {
  return /\.(kml|kmz)$/i.test(name.trim());
}

/** The folders the server reported, in the spec's order. */
export function reportedFolders(counts: Partial<Record<Folder, Counts>>): Folder[] {
  return FOLDER_ORDER.filter((folder) => counts[folder] !== undefined);
}

/** Every folder's counts added up, for a one-line summary of a past import. */
export function totalCounts(counts: Partial<Record<Folder, Counts>>): Counts {
  const total: Counts = { inserted: 0, updated: 0, deactivated: 0, rejected: 0 };
  for (const folder of reportedFolders(counts)) {
    const row = counts[folder];
    if (row === undefined) continue;
    total.inserted += row.inserted;
    total.updated += row.updated;
    total.deactivated += row.deactivated;
    total.rejected += row.rejected;
  }
  return total;
}

/** A file size as "840 KB" or "12.4 MB"; units are the same in both languages. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
