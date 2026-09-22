/**
 * SEED DICTIONARY — not imported by `<DataTable>` itself.
 *
 * The grid takes `labels` as a required prop precisely so that no English lives
 * inside it. This file exists so the i18n layer has the exact strings to seed
 * `en.json` from, and so a register can be built today without waiting for the
 * provider. When i18n lands, move these under the keys below and delete it.
 *
 * Every string that interpolates a value is a FUNCTION, not a template. Hindi
 * orders these clauses differently — "3 चयनित" is fine, but "4,318 में से 1–25
 * दिखा रहे हैं" puts the total first — and a positional `%s` would force the
 * English order onto every translation.
 *
 * i18n key namespace: `dataTable.*`.
 */

import type { DataTableLabels } from "./types";

export const dataTableLabelsEn: DataTableLabels = {
  grid: "Records",
  searchLabel: "Search records",
  searchPlaceholder: "Search",
  clearSearch: "Clear search",
  clearFilters: "Clear filters",
  columns: "Columns",
  density: "Row height",
  densityCompact: "Compact",
  densityStandard: "Comfortable",
  selectAllOnPage: "Select all rows on this page",
  selectRow: (id) => `Select ${id}`,
  selected: (count) => `${count.toLocaleString()} selected`,
  clearSelection: "Clear selection",
  exportLabel: "Export",
  exporting: "Exporting…",
  savedViews: "Views",
  saveCurrentView: "Save current view",
  saveViewNamePrompt: "Name this filter so you can return to it.",
  deleteView: (name) => `Delete view ${name}`,
  noSavedViews: "No saved views yet. Filter the register, then save it here.",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  sortClear: "Clear sort",
  sortedAscending: "Sorted ascending",
  sortedDescending: "Sorted descending",
  notSorted: "Not sorted",
  loading: "Loading records",
  resultsAnnouncement: (total) =>
    total === 0 ? "No records match" : `${total.toLocaleString()} records`,
  facetSearchPlaceholder: "Filter options",
  facetNoResults: "No matching option",
  facetClear: "Clear",
};
