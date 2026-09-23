/**
 * The register grid's contract.
 *
 * One `<DataTable>` for every ICMS register. The audit of the system this
 * replaces found 305 `mat-table` screens and **zero** wrapper components — no
 * `@Input()`, no `@Output()`, no shared folder — so each screen re-declared its
 * columns, its filter box, its paginator, its spinner calls and its error
 * alert by hand. This type is the thing whose absence produced that.
 *
 * Two properties are deliberate and worth stating, because they are the two the
 * legacy grid gets wrong:
 *
 * **It is server-driven and controlled.** The grid holds no rows it did not
 * receive, resolves no filter itself and sorts nothing locally. `state` in,
 * `onStateChange` out; the screen owns the query. A grid that filters what it
 * already downloaded is a grid that has already downloaded the whole table.
 *
 * **It holds no English.** Every user-facing string arrives through `labels` or
 * through a column's `header`. `DataTableLabels.selected` and the pagination
 * summary are functions rather than template strings because Hindi reorders the
 * clause, and a positional `%s` would force the English order onto it.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { RegisterPaginationLabels } from "@/components/icms/RegisterPagination";
import type { IconKey } from "@/lib/icons";

/**
 * Everything about a register that belongs in the URL.
 *
 * All of it, not some of it: a filtered register has to be a link an officer
 * can paste into an email, and the back button has to undo a filter change. In
 * the legacy app only 4 files of 1,192 touch `queryParams` at all, so no view
 * anywhere in it is linkable.
 *
 * `page` is 1-based because the API counts from 1 (`PageParams.page >= 1`).
 * Translating between a 0-based UI and a 1-based API in the middle of the grid
 * is how off-by-one paging bugs are born, so the UI simply counts the same way.
 */
export type RegisterState = {
  page: number;
  size: number;
  /** The API's own sort string: a whitelisted key, `-` prefixed for descending. */
  sort: string;
  /** Free-text search. Debounced before it reaches the query, never before the input. */
  q: string;
  /** Facet id -> selected values. An empty array means "no filter", never "match none". */
  filters: Readonly<Record<string, readonly string[]>>;
  /** Columns the officer has switched off. Absent = visible. */
  hiddenColumns: readonly string[];
};

export type RegisterStatePatch = Partial<RegisterState>;

/** A multi-select facet in the filter row. */
export type FacetOption = {
  value: string;
  /** Already translated by the caller. */
  label: ReactNode;
  /** Optional leading glyph — a status chip's icon, a priority arrow. */
  icon?: IconKey;
};

export type FacetDef = {
  /** The query parameter this facet maps to, e.g. `status`, `priority`. */
  id: string;
  /** Translated trigger label, e.g. "All Statuses". */
  label: string;
  options: readonly FacetOption[];
  /** Shown while the options are still being fetched. */
  loading?: boolean;
};

/** An action offered for one row. */
export type RowAction<TRow> = {
  id: string;
  label: ReactNode;
  icon?: IconKey;
  onSelect: (row: TRow) => void;
  disabled?: boolean;
  /**
   * Why it is disabled, in words. A disabled control with no explanation is the
   * single most common accessibility complaint on a government register.
   */
  disabledReason?: ReactNode;
  variant?: "default" | "primary";
};

/** An action offered for the current selection. */
export type BulkAction<TRow> = {
  id: string;
  label: ReactNode;
  icon?: IconKey;
  onSelect: (rows: readonly TRow[]) => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "destructive";
};

/** A stored filter set. The name is the officer's own words, so it is never translated. */
export type SavedView = {
  id: string;
  name: string;
  /** Everything except the page number: a saved view is a filter, not a position. */
  state: Omit<RegisterState, "page">;
};

export type SavedViewsController = {
  views: readonly SavedView[];
  onSave: (name: string) => void;
  onApply: (view: SavedView) => void;
  onDelete: (id: string) => void;
};

export type ExportFormat = "csv";

export type ExportController = {
  formats: readonly ExportFormat[];
  /** Must honour the ACTIVE filter and sort, and the visible columns. */
  onExport: (format: ExportFormat) => void | Promise<void>;
  busy?: boolean;
  /** Progress line while a large export streams, e.g. "1,200 of 4,318". */
  progress?: ReactNode;
};

/**
 * Per-column presentation the grid needs and TanStack's `ColumnDef` has no slot
 * for. Reached as `column.columnDef.meta`.
 */
export type DataTableColumnMeta<TRow = unknown> = {
  /**
   * The sort key the API accepts for this column. Absent means the column is
   * NOT sortable and gets no sort affordance — which is the correct answer for
   * `Area` (a correlated subquery over the latest round) and for `Actions`.
   */
  sortKey?: string;
  /** Short label for the column-visibility menu, when the header is a node. */
  menuLabel?: string;
  /** Stops the officer hiding the column that identifies the row. */
  alwaysVisible?: boolean;
  align?: "start" | "end";
  /** Numeric columns get tabular figures so digits line up down the column. */
  numeric?: boolean;
  /** Plain-text value for the export, when the cell renders a chip or a link. */
  exportValue?: (row: TRow) => string;
  /** Minimum width, so a horizontal scroll is honest rather than a squeeze. */
  minWidth?: string;
  /**
   * Which columns survive below `md`. `primary` stays in the table; everything
   * else moves into the per-row record sheet. Default is `secondary`, so a
   * register that declares nothing degrades to identity + actions rather than
   * to a table 1,500px wide on a 360px phone.
   */
  priority?: "primary" | "secondary";
};

export type DataTableLabels = {
  /** Accessible name of the grid itself. */
  grid: string;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  clearFilters: string;
  columns: string;
  density: string;
  densityCompact: string;
  densityStandard: string;
  selectAllOnPage: string;
  selectRow: (id: string) => string;
  selected: (count: number) => ReactNode;
  clearSelection: string;
  exportLabel: string;
  exporting: string;
  savedViews: string;
  saveCurrentView: string;
  saveViewNamePrompt: string;
  deleteView: (name: string) => string;
  noSavedViews: string;
  sortAscending: string;
  sortDescending: string;
  sortClear: string;
  sortedAscending: string;
  sortedDescending: string;
  notSorted: string;
  loading: string;
  /** Announced through aria-live once a page lands. */
  resultsAnnouncement: (total: number) => string;
  facetSearchPlaceholder: string;
  facetNoResults: string;
  facetClear: string;
  /* ---- narrow layout: the columns that did not fit --------------------- */
  /** Header of the disclosure column below `md`. */
  detailsColumn: string;
  /** Accessible name of one row's disclosure button. Names the RECORD, not "more". */
  openDetails: (id: string) => string;
  detailsTitle: string;
  detailsClose: string;
};

export type DataTableStatus = "pending" | "error" | "success";

export type DataTableProps<TRow> = {
  columns: ColumnDef<TRow, unknown>[];
  rows: readonly TRow[];
  /** From the envelope's `total`, counted over the zone-scoped selectable. */
  total: number;
  getRowId: (row: TRow) => string;

  state: RegisterState;
  onStateChange: (patch: RegisterStatePatch) => void;

  status: DataTableStatus;
  /** True during a background refetch, when stale rows are still on screen. */
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /** The live value of the search box — undebounced, so typing feels immediate. */
  searchValue: string;
  onSearchChange: (value: string) => void;

  facets?: readonly FacetDef[];
  bulkActions?: readonly BulkAction<TRow>[];

  /**
   * The register's resting sort, e.g. `-raised_at`.
   *
   * Needed because the header cycles asc -> desc -> *back to this*. Without it
   * the third click has nothing to return to and the officer cannot undo a sort
   * except by reloading. Row actions are NOT a prop: they belong to the
   * `actions` column, which renders them with `DataTableRowActions`.
   */
  defaultSort?: string;
  enableSelection?: boolean;
  enableColumnVisibility?: boolean;
  savedViews?: SavedViewsController;
  exporter?: ExportController;

  /**
   * Windowing. Below `thresholdRows` every row is rendered, because windowing a
   * 25-row page costs more than it saves and breaks find-in-page.
   */
  virtualize?: false | { rowHeight: number; overscan?: number; thresholdRows: number };

  density?: "compact" | "standard";
  onDensityChange?: (density: "compact" | "standard") => void;

  pageSizeOptions?: readonly number[];

  /** Nothing matches, and nothing WOULD match — the register is genuinely empty. */
  emptyState?: ReactNode;
  /**
   * Records exist; these filters exclude them all. A different state and a
   * different useful action: clear the filters, not create a record.
   */
  noResultsState?: ReactNode;
  errorState?: (error: unknown, retry: () => void) => ReactNode;

  labels: DataTableLabels;
  paginationLabels: RegisterPaginationLabels;

  /** Extra controls for the toolbar's trailing edge, e.g. a date range. */
  toolbarExtra?: ReactNode;

  /**
   * The band across the top of the table panel — Figma's "Complaints Register"
   * card header. Every ICMS register has one, which is why it is a slot here
   * rather than something each screen wraps the grid in and gets subtly wrong.
   */
  caption?: ReactNode;
  /** The trailing end of that band. Figma puts the record count here. */
  captionAction?: ReactNode;

  className?: string;
};
