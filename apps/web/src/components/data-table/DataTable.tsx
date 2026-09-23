/**
 * The register grid.
 *
 * Server-driven throughout: it renders the page it was handed and asks for a
 * different one. It never sorts, filters or slices locally, because a grid that
 * can do that locally is a grid that has already downloaded the whole table —
 * which is exactly what the 305 legacy grids do, and the single reason they
 * fall over on the registers that matter.
 *
 * Three things here that Figma does not draw and that a register cannot ship
 * without:
 *
 * **Loading, empty, no-results and error are four distinct states.** "No
 * complaints have been filed" and "your filters exclude all 4,318 of them" look
 * identical if you only build one empty state, and the useful action differs:
 * one is "file a complaint", the other is "clear the filters".
 *
 * **It is a real ARIA grid.** `role="grid"` with `aria-rowcount` over the whole
 * result set rather than the page, `aria-rowindex` carrying the row's true
 * position, `aria-sort` on the sorted header, and a roving tabindex so the
 * whole table is reachable with the arrow keys instead of 250 tab stops.
 *
 * **It reflows by column PRIORITY, not by turning rows into cards.** A
 * government register is read by comparing rows down a column, and a card list
 * destroys that. At `md` and above the columns keep their minimum widths and
 * the container scrolls sideways. Below `md` the grid keeps only the columns
 * whose `meta.priority` is `primary` — identity and state — and moves the rest
 * into a per-row record sheet. It is still a table, still one row per record,
 * still comparable down the column that matters, and it fits 360px without a
 * horizontal scrollbar.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ErrorState, TableLoadingRows } from "@/components/icms/states";
import { RegisterPagination } from "@/components/icms/RegisterPagination";
import { IcmsApiError } from "@/api/icms/http";
import { Icon } from "@/lib/icons";
import { useIsNarrow } from "@/lib/useMediaQuery";
import {
  DataTableColumnHeader,
  DataTableExportButton,
  DataTableFacetFilter,
  DataTableSavedViews,
  DataTableSearch,
  DataTableSelectionBar,
  DataTableViewOptions,
} from "./DataTableParts";
import { directionOf } from "./sort";
import type { DataTableColumnMeta, DataTableProps, RowAction } from "./types";

const SELECT_COLUMN_ID = "__select";
const DETAILS_COLUMN_ID = "__details";

/** Row heights, in px, used only when windowing is on and rows must be uniform. */
const ROW_HEIGHT = { compact: 48, standard: 60 } as const;

function metaOf<TRow>(
  definition: ColumnDef<TRow, unknown>,
): DataTableColumnMeta<TRow> | undefined {
  // `meta` is deliberately open on TanStack's side; this is the one place the
  // grid's own contract is read back out of it.
  return definition.meta as DataTableColumnMeta<TRow> | undefined;
}

export function DataTable<TRow>({
  columns,
  rows,
  total,
  getRowId,
  state,
  onStateChange,
  status,
  isFetching = false,
  error,
  onRetry,
  searchValue,
  onSearchChange,
  facets = [],
  bulkActions = [],
  defaultSort,
  enableSelection = false,
  enableColumnVisibility = true,
  savedViews,
  exporter,
  virtualize = { rowHeight: ROW_HEIGHT.compact, thresholdRows: 60 },
  density = "compact",
  onDensityChange,
  pageSizeOptions = [10, 25, 50, 100],
  emptyState,
  noResultsState,
  errorState,
  labels,
  paginationLabels,
  toolbarExtra,
  caption,
  captionAction,
  className,
}: DataTableProps<TRow>) {
  const searchId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow();

  /* ---- narrow layout --------------------------------------------------
     Below `md` the table keeps its `primary` columns and the rest of the
     record moves into a sheet, one row at a time. Held by row id rather than
     by row object so a background refetch cannot leave the sheet showing a
     row that is no longer on the page. */
  const [detailId, setDetailId] = useState<string | null>(null);

  /* ---- selection ------------------------------------------------------
     Kept locally and NOT in the URL: a selection is something the officer is
     holding, not something they are looking at, and a shared link should not
     arrive with someone else's cases pre-ticked. Cleared whenever the visible
     set changes, because a hidden selection acted on by a bulk action is how
     the wrong records get modified. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const visibleKey = `${state.page}|${state.size}|${state.sort}|${state.q}|${JSON.stringify(state.filters)}`;
  useEffect(() => {
    setSelected(new Set());
    setDetailId(null);
  }, [visibleKey]);

  /* ---- columns --------------------------------------------------------- */
  const selectionColumn = useMemo<ColumnDef<TRow, unknown>>(
    () => ({
      id: SELECT_COLUMN_ID,
      header: () => null,
      cell: () => null,
      enableHiding: false,
      meta: { alwaysVisible: true, minWidth: "2.5rem" },
    }),
    [],
  );

  // 44px target, and its accessible name carries the record id: twenty-five
  // buttons all called "Details" are twenty-five identical stops in a rotor.
  const detailsColumn = useMemo<ColumnDef<TRow, unknown>>(
    () => ({
      id: DETAILS_COLUMN_ID,
      header: () => <span className="sr-only">{labels.detailsColumn}</span>,
      enableHiding: false,
      meta: {
        alwaysVisible: true,
        align: "end",
        priority: "primary",
        menuLabel: labels.detailsColumn,
      },
      cell: ({ row }) => {
        const id = getRowId(row.original);
        return (
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={labels.openDetails(id)}
            onClick={() => {
              setDetailId(id);
            }}
          >
            <Icon name="action.more" className="size-4" />
          </Button>
        );
      },
    }),
    [getRowId, labels],
  );

  // Selection is a desktop affordance. Below `md` the 82px rail has already
  // taken a quarter of a 360px screen, and a tick column would cost another 40
  // of what is left; the record sheet is the mobile answer to "act on this row".
  const allColumns = useMemo(() => {
    const withSelection = enableSelection && !narrow;
    const base = withSelection ? [selectionColumn, ...columns] : [...columns];
    return narrow ? [...base, detailsColumn] : base;
  }, [columns, detailsColumn, enableSelection, narrow, selectionColumn]);

  /** Columns the BREAKPOINT hides, as opposed to the ones the officer hid. */
  const narrowHiddenIds = useMemo(() => {
    if (!narrow) return [] as string[];
    return columns
      .filter((column) => metaOf(column)?.priority !== "primary")
      .map((column) => column.id)
      .filter((id): id is string => id != null);
  }, [columns, narrow]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const visibility: VisibilityState = {};
    for (const id of state.hiddenColumns) visibility[id] = false;
    for (const id of narrowHiddenIds) visibility[id] = false;
    return visibility;
  }, [narrowHiddenIds, state.hiddenColumns]);

  const table = useReactTable<TRow>({
    data: rows as TRow[],
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    // Everything is the server's job. Handing TanStack a sorting or filtering
    // model here would silently re-sort the 25 rows of the current page and
    // make the grid disagree with the register.
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(total / state.size)),
    state: { columnVisibility },
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const bodyRows = table.getRowModel().rows;
  const columnCount = headers.length;

  /* ---- windowing ------------------------------------------------------
     Off below the threshold. Windowing a 25-row page costs more than it saves
     and breaks browser find-in-page, which officers genuinely use. It earns its
     keep only at the large page sizes (100, 200) the size control offers. */
  // Off in the narrow layout: wrapped Devanagari cells are not a uniform height,
  // and a virtualiser told otherwise leaves gaps mid-scroll.
  const windowing =
    !narrow && virtualize !== false && bodyRows.length >= virtualize.thresholdRows;
  const rowHeight = virtualize === false ? ROW_HEIGHT[density] : virtualize.rowHeight;

  const virtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: virtualize === false ? 8 : (virtualize.overscan ?? 8),
    enabled: windowing,
  });
  const virtualRows = windowing ? virtualizer.getVirtualItems() : [];
  const padTop = windowing && virtualRows.length > 0 ? virtualRows[0].start : 0;
  const padBottom =
    windowing && virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;
  // `index` is ABSOLUTE — the row's position on the page, not its position in
  // this array. When windowing is on the array is sparse (only what is on
  // screen), so anything keyed by index has to go through `bodyRows`, never
  // through `renderedRows[n]`.
  const renderedRows: { row: Row<TRow>; index: number }[] = windowing
    ? virtualRows.map((item) => ({ row: bodyRows[item.index], index: item.index }))
    : bodyRows.map((row, index) => ({ row, index }));

  /* ---- the record sheet -------------------------------------------------
     Everything the narrow layout could not show, for ONE row. It lists every
     column, including the ones the officer hid on desktop: the column chooser
     is a control about what fits across a table, not about what belongs to a
     record, and a "full record" that silently drops four fields is a bug
     report waiting to happen. */
  const detailRow =
    detailId === null
      ? null
      : (bodyRows.find((row) => getRowId(row.original) === detailId) ?? null);

  const detailCells = detailRow
    ? detailRow
        .getAllCells()
        .filter(
          (cell) =>
            cell.column.id !== SELECT_COLUMN_ID && cell.column.id !== DETAILS_COLUMN_ID,
        )
    : [];

  /* ---- selection helpers ------------------------------------------------ */
  const toggleRow = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pageIds = bodyRows.map((row) => getRowId(row.original));
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  const toggleAllOnPage = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) for (const id of pageIds) next.delete(id);
      else for (const id of pageIds) next.add(id);
      return next;
    });
  };

  const selectedRows = rows.filter((row) => selected.has(getRowId(row)));

  /* ---- roving tabindex -------------------------------------------------
     A grid with 25 rows and 10 columns is 250 tab stops if every cell is
     tabbable. One cell is tabbable at a time; the arrows move between them.
     Row -1 is the header row, so the sort controls are reachable the same way. */
  const [active, setActive] = useState({ row: -1, col: 0 });

  const focusCell = useCallback((row: number, col: number) => {
    tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
  }, []);

  const move = useCallback(
    (row: number, col: number) => {
      setActive({ row, col });
      if (windowing && row >= 0) {
        virtualizer.scrollToIndex(row);
        window.requestAnimationFrame(() => {
          focusCell(row, col);
        });
        return;
      }
      focusCell(row, col);
    },
    [focusCell, virtualizer, windowing],
  );

  // Interactive controls inside a cell belong to the tab order only while their
  // row is the active one. Without this, Tab walks every VIEW and ASSIGN button
  // on the page — fifty stops before reaching the pagination.
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    for (const cell of element.querySelectorAll<HTMLElement>("[data-cell]")) {
      const inActiveRow = cell.dataset.cell?.startsWith(`${active.row}:`) ?? false;
      const focusables = cell.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]:not([data-cell])",
      );
      for (const focusable of focusables) focusable.tabIndex = inActiveRow ? 0 : -1;
    }
  });

  // Absolute, so arrow keys and Ctrl+End reach the last row of the page even
  // when only a window of it is mounted.
  const lastRow = bodyRows.length - 1;
  const lastCol = columnCount - 1;

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    // A keystroke aimed at a control inside a cell is that control's business —
    // except Escape, which steps back out to the cell that contains it.
    if (target.dataset.cell === undefined) {
      if (event.key === "Escape") {
        const cell = target.closest<HTMLElement>("[data-cell]");
        if (cell) {
          event.preventDefault();
          cell.focus();
        }
      }
      return;
    }

    const { row, col } = active;
    const clampCol = (value: number) => Math.min(Math.max(value, 0), lastCol);
    const clampRow = (value: number) => Math.min(Math.max(value, -1), lastRow);

    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(row, clampCol(col + 1));
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(row, clampCol(col - 1));
        break;
      case "ArrowDown":
        event.preventDefault();
        move(clampRow(row + 1), col);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(clampRow(row - 1), col);
        break;
      case "Home":
        event.preventDefault();
        move(event.ctrlKey ? -1 : row, 0);
        break;
      case "End":
        event.preventDefault();
        move(event.ctrlKey ? lastRow : row, lastCol);
        break;
      case "PageDown":
        event.preventDefault();
        onStateChange({ page: state.page + 1 });
        break;
      case "PageUp":
        event.preventDefault();
        if (state.page > 1) onStateChange({ page: state.page - 1 });
        break;
      case "Enter": {
        // Step into the cell. Escape steps back out — the standard grid
        // contract for a cell that contains its own widgets.
        const first = target.querySelector<HTMLElement>("a[href], button, input");
        if (first) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
      case " ":
        if (enableSelection && row >= 0 && bodyRows[row]) {
          event.preventDefault();
          toggleRow(getRowId(bodyRows[row].original));
        }
        break;
      default:
        break;
    }
  };

  /* ---- states ---------------------------------------------------------- */
  const isEmpty = status === "success" && rows.length === 0;
  const hasFilters =
    state.q !== "" || Object.values(state.filters).some((values) => values.length > 0);

  const renderedError = (() => {
    if (status !== "error") return null;
    if (errorState && onRetry) return errorState(error, onRetry);
    const apiError = error instanceof IcmsApiError ? error : null;
    return (
      <ErrorState
        title={apiError?.message ?? labels.grid}
        detail={apiError?.requestId ?? undefined}
        onRetry={onRetry}
        size="compact"
      />
    );
  })();

  return (
    <TooltipProvider>
      <div className={cn("flex min-w-0 flex-col gap-3", className)}>
        {/* ---- toolbar ------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface-1 px-3 py-2.5">
          <DataTableSearch
            id={searchId}
            value={searchValue}
            onChange={onSearchChange}
            labels={labels}
            busy={isFetching && searchValue !== state.q}
          />

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {facets.map((facet) => (
              <DataTableFacetFilter
                key={facet.id}
                facet={facet}
                selected={state.filters[facet.id] ?? []}
                onChange={(values) => {
                  onStateChange({ filters: { ...state.filters, [facet.id]: values } });
                }}
                labels={labels}
              />
            ))}
            {toolbarExtra}
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  onSearchChange("");
                  onStateChange({ q: "", filters: {} });
                }}
              >
                <Icon name="action.clear" className="size-4" />
                {labels.clearFilters}
              </Button>
            )}
            {savedViews && <DataTableSavedViews controller={savedViews} labels={labels} />}
            {exporter && (
              <DataTableExportButton
                onExport={() => void exporter.onExport(exporter.formats[0])}
                busy={exporter.busy}
                progress={exporter.progress}
                labels={labels}
              />
            )}
            {/* The chooser is meaningless below `md`: the breakpoint, not the
                officer, decides which columns are on screen there. */}
            {enableColumnVisibility && !narrow && (
              <DataTableViewOptions
                columns={table
                  .getAllLeafColumns()
                  .filter((column) => column.id !== SELECT_COLUMN_ID)
                  .map((column) => {
                    const meta = metaOf(column.columnDef);
                    return {
                      id: column.id,
                      label: meta?.menuLabel ?? column.id,
                      visible: column.getIsVisible(),
                      locked: meta?.alwaysVisible === true,
                    };
                  })}
                onToggle={(id, visible) => {
                  const hidden = new Set(state.hiddenColumns);
                  if (visible) hidden.delete(id);
                  else hidden.add(id);
                  onStateChange({ hiddenColumns: [...hidden] });
                }}
                density={density}
                onDensityChange={onDensityChange}
                labels={labels}
              />
            )}
          </div>
        </div>

        {enableSelection && !narrow && bulkActions.length > 0 && (
          <DataTableSelectionBar
            count={selected.size}
            rows={selectedRows}
            actions={bulkActions}
            onClear={() => {
              setSelected(new Set());
            }}
            labels={labels}
          />
        )}

        {/* The one place the result count is announced. Without it a filter
            change is silent to a screen-reader user: the rows swap and nothing
            says how many there now are. */}
        <p className="sr-only" aria-live="polite" aria-atomic>
          {status === "pending"
            ? labels.loading
            : status === "error"
              ? // The error panel says what happened; announcing "no records
                // match" here as well would contradict it.
                ""
              : labels.resultsAnnouncement(total)}
        </p>

        {/* ---- the register card: header band, table, pagination ------- */}
        <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface-1">
          {(caption != null || captionAction != null) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-fg-strong">{caption}</h2>
              {captionAction != null && (
                <p className="text-sm text-fg-muted tabular">{captionAction}</p>
              )}
            </div>
          )}

          <div
            ref={scrollRef}
            className={cn(
              "relative w-full overflow-x-auto",
              windowing && "max-h-[70vh] overflow-y-auto",
            )}
          >
            <table
            ref={tableRef}
            role="grid"
            aria-label={labels.grid}
            aria-busy={isFetching}
            // Counted over the whole result set, not the page: "row 51 of 4,318"
            // is the useful fact, and it is the one the legacy grid cannot state
            // because its response envelope carries no total.
            aria-rowcount={total + 1}
            aria-colcount={columnCount}
            onKeyDown={onGridKeyDown}
            className="w-full caption-bottom border-separate border-spacing-0 text-sm"
          >
            <TableHeader className="sticky top-0 z-[1] bg-surface-sunken">
              <TableRow aria-rowindex={1} className="hover:bg-transparent">
                {headers.map((header, columnIndex) => {
                  const meta = metaOf(header.column.columnDef);
                  const direction = directionOf(state.sort, meta?.sortKey);
                  const isSelectColumn = header.column.id === SELECT_COLUMN_ID;
                  return (
                    <TableHead
                      key={header.id}
                      data-cell={`-1:${columnIndex}`}
                      tabIndex={active.row === -1 && active.col === columnIndex ? 0 : -1}
                      onFocus={() => {
                        setActive({ row: -1, col: columnIndex });
                      }}
                      aria-colindex={columnIndex + 1}
                      aria-sort={
                        meta?.sortKey === undefined
                          ? undefined
                          : direction === "asc"
                            ? "ascending"
                            : direction === "desc"
                              ? "descending"
                              : "none"
                      }
                      style={
                        !narrow && meta?.minWidth ? { minWidth: meta.minWidth } : undefined
                      }
                      className={cn(
                        // px-2 below `md`: three columns on a 360px phone minus an
                        // 82px rail cannot spare 8px of gutter each.
                        "h-11 border-b border-line text-2xs font-medium tracking-wider text-fg-muted uppercase",
                        narrow ? "px-2" : "px-3",
                        // The disclosure column is a 44px target, nothing else;
                        // its leading gutter is 44px the two data columns need.
                        narrow && header.column.id === DETAILS_COLUMN_ID && "ps-0 pe-1",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        meta?.align === "end" && "text-end",
                      )}
                    >
                      {isSelectColumn ? (
                        <Checkbox
                          checked={
                            allOnPageSelected
                              ? true
                              : someOnPageSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={toggleAllOnPage}
                          aria-label={labels.selectAllOnPage}
                        />
                      ) : (
                        <DataTableColumnHeader
                          header={flexRender(header.column.columnDef.header, header.getContext())}
                          sortKey={meta?.sortKey}
                          sort={state.sort}
                          defaultSort={defaultSort ?? state.sort}
                          onSortChange={(sort) => {
                            onStateChange({ sort });
                          }}
                          labels={labels}
                          align={meta?.align}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody>
              {status === "pending" && (
                <TableLoadingRows rows={Math.min(state.size, 8)} columns={columnCount} />
              )}

              {status === "error" && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="p-0">
                    {renderedError}
                  </TableCell>
                </TableRow>
              )}

              {isEmpty && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="p-0">
                    {hasFilters ? noResultsState : emptyState}
                  </TableCell>
                </TableRow>
              )}

              {padTop > 0 && (
                <tr aria-hidden style={{ height: padTop }}>
                  <td colSpan={columnCount} />
                </tr>
              )}

              {status === "success" &&
                renderedRows.map(({ row, index }) => {
                  const id = getRowId(row.original);
                  const isSelected = selected.has(id);
                  return (
                    <TableRow
                      key={id}
                      // The row's true position in the whole register, not its
                      // position on this page.
                      aria-rowindex={(state.page - 1) * state.size + index + 2}
                      aria-selected={enableSelection ? isSelected : undefined}
                      data-state={isSelected ? "selected" : undefined}
                      style={windowing ? { height: rowHeight } : undefined}
                      className="border-b border-line-subtle last:border-0"
                    >
                      {row.getVisibleCells().map((cell, columnIndex) => {
                        const meta = metaOf(cell.column.columnDef);
                        const isSelectColumn = cell.column.id === SELECT_COLUMN_ID;
                        return (
                          <TableCell
                            key={cell.id}
                            data-cell={`${index}:${columnIndex}`}
                            tabIndex={active.row === index && active.col === columnIndex ? 0 : -1}
                            onFocus={() => {
                              setActive({ row: index, col: columnIndex });
                            }}
                            aria-colindex={columnIndex + 1}
                            style={
                              !narrow && meta?.minWidth
                                ? { minWidth: meta.minWidth }
                                : undefined
                            }
                            className={cn(
                              density === "compact" ? "py-2" : "py-3",
                              narrow ? "px-2" : "px-3",
                              narrow && cell.column.id === DETAILS_COLUMN_ID && "ps-0 pe-1",
                              "align-middle whitespace-normal",
                              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              meta?.align === "end" && "text-end",
                              meta?.numeric && "tabular",
                            )}
                          >
                            {isSelectColumn ? (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => {
                                  toggleRow(id);
                                }}
                                aria-label={labels.selectRow(id)}
                              />
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}

              {padBottom > 0 && (
                <tr aria-hidden style={{ height: padBottom }}>
                  <td colSpan={columnCount} />
                </tr>
              )}
              </TableBody>
            </table>
          </div>

          {/* ---- footer ------------------------------------------------ */}
          <div className="border-t border-line">
            <RegisterPagination
              page={state.page}
              pageSize={state.size}
              total={total}
              onPageChange={(page) => {
                onStateChange({ page });
              }}
              onPageSizeChange={(size) => {
                onStateChange({ size });
              }}
              pageSizeOptions={pageSizeOptions}
              labels={paginationLabels}
              disabled={status !== "success"}
            />
          </div>
        </div>

        {/* Radix moves focus into the sheet and returns it to the trigger on
            close, so the disclosure does not cost the officer their place in
            the grid. The open/close animation is covered by the global
            prefers-reduced-motion rule in styles/icms-theme.css. */}
        <Sheet
          open={detailRow !== null}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-0"
          >
            <SheetHeader className="px-4 pt-4 pb-2">
              <SheetTitle className="font-mono text-base break-all">{detailId}</SheetTitle>
              <SheetDescription>{labels.detailsTitle}</SheetDescription>
            </SheetHeader>
            <dl className="grid grid-cols-1 gap-x-6 px-4 pb-8 sm:grid-cols-2">
              {detailCells.map((cell) => {
                const cellMeta = metaOf(cell.column.columnDef);
                return (
                  <div
                    key={cell.id}
                    className="flex min-w-0 flex-col gap-1 border-b border-line-subtle py-2.5 last:border-0"
                  >
                    <dt className="text-2xs font-medium tracking-wider text-fg-muted uppercase">
                      {cellMeta?.menuLabel ?? cell.column.id}
                    </dt>
                    <dd className="min-w-0 text-sm text-fg-base">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

/**
 * A row's action buttons.
 *
 * Exported so every register's `Actions` column renders them the same way: the
 * accessible name of each button names the RECORD as well as the verb, because
 * a screen-reader user otherwise hears "View" twenty-five times with nothing to
 * tell them apart — which is exactly what the legacy grids do.
 */
export function DataTableRowActions<TRow>({
  row,
  actions,
  rowLabel,
}: {
  row: TRow;
  actions: readonly RowAction<TRow>[];
  /** e.g. the case reference. Appended to each action's accessible name. */
  rowLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const button = (
          <Button
            type="button"
            size="sm"
            variant={action.variant === "primary" ? "outline" : "secondary"}
            disabled={action.disabled}
            aria-label={
              typeof action.label === "string" ? `${action.label}: ${rowLabel}` : undefined
            }
            onClick={() => {
              action.onSelect(row);
            }}
            className={cn(
              "h-8 rounded-xs px-2.5 text-2xs font-semibold tracking-wide uppercase",
              action.variant === "primary" &&
                "border-accent-soft-border bg-accent-soft text-fg-link hover:bg-accent-soft-hover",
            )}
          >
            {action.icon && <Icon name={action.icon} className="size-3.5" />}
            {action.label}
          </Button>
        );

        // A disabled control with no stated reason is the most common
        // accessibility complaint on a register. The tooltip keeps the
        // explanation reachable by keyboard, not only on hover.
        return action.disabled && action.disabledReason ? (
          <Tooltip key={action.id}>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex rounded-xs">
                {button}
              </span>
            </TooltipTrigger>
            <TooltipContent>{action.disabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          <span key={action.id} className="inline-flex">
            {button}
          </span>
        );
      })}
    </div>
  );
}
