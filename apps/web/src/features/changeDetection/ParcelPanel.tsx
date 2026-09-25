/**
 * The Parcel Change card: per-parcel built-area change for the chosen run.
 *
 * Summary tiles, the change histogram, one filter per change class, and a
 * windowed table of every measured parcel. The table sorts locally because it
 * holds the whole run (the geojson the map draws), not a server page, so it is
 * a plain column list over @tanstack/react-virtual rather than DataTable. Picking
 * a row flies the map to the parcel. No owner is ever shown: the API never
 * sends one.
 */

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { useVirtualizer } from "@tanstack/react-virtual";

import { ApiError, download, downloadUrl } from "@/api/client";
import type { ParcelChangeClass, ParcelSummary } from "@/api/types";
import { LoadingState, NoResultsState } from "@/components/icms/states";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icons";

import type { ChangeDetectionLabels } from "./labels";
import {
  classCounts,
  countRowsByClass,
  DEFAULT_PARCEL_SORT,
  histogramBars,
  histogramTone,
  nextParcelSort,
  PARCEL_COLOURS,
  parcelFilters,
  parcelLabel,
  rovingIndex,
  sortParcelRows,
  type ParcelRow,
  type ParcelSort,
  type ParcelSortKey,
} from "./parcelModel";
import { Failure, PanelSection, Swatch } from "./parts";
import type { LoadFailure } from "./useChangeDetection";
import type { Parcels } from "./useParcels";

const ROW_HEIGHT = 32;

type Format = (value: number) => string;

// Whole square metres, or the "not recorded" word for a missing figure.
function areaText(labels: ChangeDetectionLabels, format: Format, value: number | null): string {
  return value === null
    ? labels.parcels.notRecorded
    : labels.parcels.area(format(Math.round(value)));
}

// A signed change: growth reads "+12", loss "-8".
function deltaText(labels: ChangeDetectionLabels, format: Format, value: number | null): string {
  if (value === null) return labels.parcels.notRecorded;
  const rounded = Math.round(value);
  return labels.parcels.area(rounded > 0 ? `+${format(rounded)}` : format(rounded));
}

function ClassSwatch({ cls }: { cls: ParcelChangeClass }) {
  return cls === "unassessable" ? (
    <Swatch color="transparent" className="border border-dashed border-fg-faint" />
  ) : (
    <Swatch color={PARCEL_COLOURS[cls]} />
  );
}

type Column = { id: ParcelSortKey; numeric: boolean; cell: (row: ParcelRow) => ReactNode };

export function ParcelPanel({
  labels,
  runId,
  parcels,
  summary,
  selectedKey,
  onSelect,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  runId: string;
  parcels: Parcels;
  summary: ParcelSummary;
  selectedKey: string | null;
  onSelect: (row: ParcelRow) => void;
  formatNumber: Format;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<LoadFailure | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    const suffix = parcels.filter ? `_${parcels.filter}` : "";
    try {
      await download(
        downloadUrl.parcelsCsv(runId, parcelFilters(parcels.filter)),
        `ada_analysis_${runId}_parcels${suffix}.csv`,
      );
    } catch (cause: unknown) {
      setExportError(
        cause instanceof ApiError
          ? { message: cause.message, requestId: cause.requestId }
          : { message: labels.parcels.csvFailed, requestId: null },
      );
    } finally {
      setExporting(false);
    }
  };

  const counts =
    Object.keys(summary.counts_by_class).length > 0
      ? summary.counts_by_class
      : countRowsByClass(parcels.rows);

  return (
    <PanelSection
      title={labels.parcels.titleWithCount(formatNumber(summary.parcels_total))}
      headingId="cd-parcels-heading"
      bodyClassName="flex flex-col gap-3"
      action={
        <Button variant="outline" size="xs" disabled={exporting} onClick={() => void exportCsv()}>
          <Icon
            name={exporting ? "feedback.loading" : "action.download"}
            spin={exporting}
            className="size-3.5"
          />
          {exporting ? labels.parcels.csvRunning : labels.parcels.csv}
        </Button>
      }
    >
      {exportError && (
        <Failure
          compact
          title={labels.parcels.csvFailed}
          message={exportError.message}
          requestId={exportError.requestId}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
        />
      )}

      <dl className="grid grid-cols-3 gap-2">
        <Tile label={labels.parcels.total} value={formatNumber(summary.parcels_total)} />
        <Tile label={labels.parcels.assessable} value={formatNumber(summary.assessable)} />
        <Tile
          label={labels.parcels.bias}
          title={labels.parcels.biasHint}
          value={
            summary.bias_offset_sqm == null
              ? labels.parcels.notRecorded
              : labels.parcels.area(formatNumber(Math.round(summary.bias_offset_sqm * 10) / 10))
          }
        />
      </dl>

      <Histogram labels={labels} summary={summary} formatNumber={formatNumber} />

      <div
        role="group"
        aria-label={labels.parcels.filterLabel}
        className="flex flex-wrap gap-1.5"
      >
        <FilterChip pressed={parcels.filter === null} onClick={parcels.clearFilter}>
          {labels.parcels.filterCount(labels.parcels.all, formatNumber(summary.parcels_total))}
        </FilterChip>
        {classCounts(counts).map(({ cls, count }) => (
          <FilterChip
            key={cls}
            pressed={parcels.filter === cls}
            disabled={count === 0 && parcels.filter !== cls}
            onClick={() => parcels.toggleFilter(cls)}
          >
            <ClassSwatch cls={cls} />
            {labels.parcels.filterCount(labels.parcels.changeClass(cls), formatNumber(count))}
          </FilterChip>
        ))}
      </div>

      {parcels.status === "ready" && parcels.partial && parcels.total !== null && (
        <p role="note" className="rounded-xs border border-line bg-surface-1 px-2 py-1.5 text-2xs text-fg-muted">
          {labels.parcels.partial(formatNumber(parcels.rows.length), formatNumber(parcels.total))}
        </p>
      )}

      {parcels.status === "loading" && (
        <LoadingState label={labels.parcels.loading} lines={4} className="p-0" />
      )}

      {parcels.status === "error" && parcels.error && (
        <Failure
          compact
          title={labels.parcels.errorTitle}
          message={parcels.error.message || labels.parcels.errorBody}
          requestId={parcels.error.requestId}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
          onRetry={parcels.reload}
          retryLabel={labels.parcels.retry}
        />
      )}

      {parcels.status === "ready" && parcels.shown.length === 0 && (
        <NoResultsState
          size="compact"
          title={labels.parcels.noResultsTitle}
          description={labels.parcels.noResultsBody}
          action={
            parcels.filter !== null ? (
              <Button variant="outline" size="sm" onClick={parcels.clearFilter}>
                <Icon name="action.clear" className="size-4" />
                {labels.parcels.showAll}
              </Button>
            ) : undefined
          }
        />
      )}

      {parcels.status === "ready" && parcels.shown.length > 0 && (
        <>
          <ParcelTable
            labels={labels}
            rows={parcels.shown}
            selectedKey={selectedKey}
            onSelect={onSelect}
            formatNumber={formatNumber}
          />
          <p role="status" className="text-2xs text-fg-faint">
            {labels.parcels.showing(
              formatNumber(parcels.shown.length),
              formatNumber(parcels.rows.length),
            )}
          </p>
        </>
      )}
    </PanelSection>
  );
}

function Tile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 rounded-xs border border-line bg-surface-1 px-2 py-1.5"
      title={title}
    >
      <dt className="truncate text-2xs text-fg-faint">{label}</dt>
      <dd className="truncate font-mono text-sm text-fg-strong tabular">{value}</dd>
    </div>
  );
}

function FilterChip({
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium tabular",
        "transition-colors duration-fast ease-standard focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-line-accent bg-surface-3 text-fg-strong"
          : "border-line bg-surface-1 text-fg-muted hover:bg-surface-3",
      )}
    >
      {children}
    </button>
  );
}

// Plain divs: bins above the epoch bias red, below it blue, straddling it grey; zero when none.
function Histogram({
  labels,
  summary,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  summary: ParcelSummary;
  formatNumber: Format;
}) {
  const bars = useMemo(() => histogramBars(summary.histogram), [summary.histogram]);
  if (bars.length === 0) return null;
  const edge = (value: number) => formatNumber(Math.round(value));
  const bias = summary.bias_offset_sqm ?? null;
  const tones = {
    growth: PARCEL_COLOURS.new_build,
    loss: PARCEL_COLOURS.demolition,
    straddle: PARCEL_COLOURS.unchanged,
  };

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex flex-col text-2xs text-fg-faint">
        <span>{labels.parcels.histogramTitle}</span>
        <span>
          {bias === null ? labels.parcels.histogramUncorrected : labels.parcels.histogramPivot}
        </span>
      </figcaption>
      <ul
        aria-label={labels.parcels.histogramLabel(formatNumber(summary.assessable))}
        className="flex h-16 items-end gap-px border-b border-line"
      >
        {bars.map((bar, index) => {
          const text = labels.parcels.histogramBin(
            edge(bar.from),
            edge(bar.to),
            formatNumber(bar.count),
          );
          const colour = tones[histogramTone(bar, bias ?? 0)];
          return (
            <li key={index} className="flex h-full min-w-0 flex-1 items-end" title={text}>
              <span className="sr-only">{text}</span>
              <span
                aria-hidden
                className="w-full rounded-t-[1px]"
                style={{
                  backgroundColor: colour,
                  height: `${bar.count > 0 ? Math.max(bar.height * 100, 4) : 0}%`,
                }}
              />
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="flex justify-between font-mono text-2xs text-fg-faint tabular">
        <span>{edge(bars[0].from)}</span>
        <span>{edge(bars[bars.length - 1].to)}</span>
      </div>
    </figure>
  );
}

function ParcelTable({
  labels,
  rows,
  selectedKey,
  onSelect,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  rows: ParcelRow[];
  selectedKey: string | null;
  onSelect: (row: ParcelRow) => void;
  formatNumber: Format;
}) {
  const [sort, setSort] = useState<ParcelSort>(DEFAULT_PARCEL_SORT);
  const sorted = useMemo(() => sortParcelRows(rows, sort), [rows, sort]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const columns = useMemo<Column[]>(() => {
    const area = (value: number | null) => areaText(labels, formatNumber, value);
    const column = (
      id: ParcelSortKey,
      cell: (row: ParcelRow) => ReactNode,
      numeric = false,
    ): Column => ({ id, cell, numeric });
    return [
      column("parcel", (row) => parcelLabel(row)),
      column("changeClass", (row) => (
        <span className="inline-flex items-center gap-1.5">
          <ClassSwatch cls={row.changeClass} />
          {labels.parcels.changeClass(row.changeClass)}
        </span>
      )),
      column("delta", (row) => deltaText(labels, formatNumber, row.deltaCorrectedSqm), true),
      column("sanctioned", (row) => area(row.sanctionedSqm), true),
      column("builtT1", (row) => area(row.builtSqmT1), true),
      column("builtT2", (row) => area(row.builtSqmT2), true),
      column("verdictT1", (row) => labels.parcels.verdict(row.verdictT1)),
      column("verdictT2", (row) => labels.parcels.verdict(row.verdictT2)),
      column("landUse", (row) => row.landUse ?? ""),
      column("plotType", (row) => row.plotType ?? ""),
    ];
  }, [labels, formatNumber]);

  const bodyRows = sorted;

  const virtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length > 0 ? items[0].start : 0;
  const padBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const columnCount = columns.length;
  const active = Math.max(0, Math.min(bodyRows.length - 1, activeIndex));

  // Enter or Space picks the row; arrows, Home and End move the one tabbable row.
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: ParcelRow, index: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(row);
      return;
    }
    const next = rovingIndex(index, event.key, bodyRows.length);
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${next}"]`)?.focus(),
    );
  };

  return (
    <div ref={scrollRef} className="max-h-80 overflow-auto rounded-xs border border-line">
      <table
        role="grid"
        aria-label={labels.parcels.tableLabel}
        aria-rowcount={bodyRows.length + 1}
        className="w-max min-w-full border-collapse text-xs"
      >
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr aria-rowindex={1}>
            {columns.map(({ id, numeric }, index) => {
              const active = sort.key === id;
              return (
                <th
                  key={id}
                  scope="col"
                  aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                  className={cn(
                    "h-8 border-b border-line px-2 font-medium whitespace-nowrap text-fg-muted",
                    numeric ? "text-end" : "text-start",
                    index === 0 && "sticky start-0 z-10 bg-surface-2",
                  )}
                >
                  <button
                    type="button"
                    title={labels.parcels.sortBy(labels.parcels.column(id))}
                    onClick={() => setSort((current) => nextParcelSort(current, id))}
                    className="inline-flex items-center gap-1 rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {labels.parcels.column(id)}
                    <Icon
                      name={
                        active ? (sort.desc ? "form.chevronDown" : "form.chevronUp") : "action.sort"
                      }
                      className={cn("size-3", active ? "text-fg-strong" : "text-fg-faint")}
                    />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden>
              <td colSpan={columnCount} style={{ height: padTop }} />
            </tr>
          )}
          {items.map((item) => {
            const parcel = bodyRows[item.index];
            const selected = parcel.key === selectedKey;
            return (
              <tr
                key={parcel.key}
                role="row"
                data-row-index={item.index}
                aria-rowindex={item.index + 2}
                aria-selected={selected}
                tabIndex={item.index === active ? 0 : -1}
                onFocus={() => setActiveIndex(item.index)}
                title={
                  parcel.bounds
                    ? labels.parcels.locate(parcelLabel(parcel))
                    : labels.parcels.noGeometry
                }
                onClick={() => {
                  setActiveIndex(item.index);
                  onSelect(parcel);
                }}
                onKeyDown={(event) => onRowKey(event, parcel, item.index)}
                className={cn(
                  "cursor-pointer border-b border-line-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  selected ? "bg-surface-3" : "hover:bg-surface-3",
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.id}
                    role="gridcell"
                    className={cn(
                      "px-2 whitespace-nowrap text-fg-muted",
                      column.numeric && "text-end font-mono tabular",
                      index === 0 && "sticky start-0 font-mono font-medium text-fg-strong",
                      index === 0 && (selected ? "bg-surface-3" : "bg-surface-2"),
                    )}
                  >
                    {column.cell(parcel)}
                  </td>
                ))}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={columnCount} style={{ height: padBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The map's hover card for one parcel, inside MapView's `.hover-popup`. */
export function ParcelHoverCard({
  labels,
  row,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  row: ParcelRow;
  formatNumber: Format;
}) {
  const colour = PARCEL_COLOURS[row.changeClass];
  const area = (value: number | null) => areaText(labels, formatNumber, value);
  const facts: [string, string][] = [
    [labels.parcels.column("sanctioned"), area(row.sanctionedSqm)],
    [labels.parcels.column("builtT1"), area(row.builtSqmT1)],
    [labels.parcels.column("builtT2"), area(row.builtSqmT2)],
    [labels.parcels.column("delta"), deltaText(labels, formatNumber, row.deltaCorrectedSqm)],
    [labels.parcels.column("verdictT1"), labels.parcels.verdict(row.verdictT1)],
    [labels.parcels.column("verdictT2"), labels.parcels.verdict(row.verdictT2)],
  ];
  return (
    <>
      <div className="hover-popup-head">
        <span
          className="badge"
          style={{ color: colour, border: `1px solid ${colour}`, background: "transparent" }}
        >
          {labels.parcels.changeClass(row.changeClass)}
        </span>
        <span className="hover-label">{parcelLabel(row)}</span>
      </div>
      <dl className="hover-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
