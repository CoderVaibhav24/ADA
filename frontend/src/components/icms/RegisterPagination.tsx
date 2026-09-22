import { useId, type ReactNode } from "react";
import { cn } from "cn";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icons";
import { buildPageWindow } from "./pagination-window";

/**
 * The working register pagination.
 *
 * Figma designs a static `Showing 8 records` on the left and three bare page
 * buttons `1 2 3` on the right — no prev/next, no page-size control, no
 * range readout, and the count disagrees with the rows drawn on all three
 * registers. That is a mock, not a control. This is the control: first/prev,
 * a windowed page list with ellipses, next/last, a page-size select, and a
 * live "Showing X-Y of N" readout.
 *
 * Controlled only. The registers will drive it from URL search params so a
 * page is linkable and survives a refresh; owning page state internally would
 * make that impossible.
 *
 * No English: every string arrives through `labels`. See pagination-labels.en.ts.
 */
export type RegisterPaginationLabels = {
  summary: (range: { from: number; to: number; total: number }) => ReactNode;
  previous: string;
  next: string;
  first: string;
  last: string;
  pageSize: string;
  page: (n: number) => string;
  currentPage: (n: number) => string;
  morePages: string;
  navigation: string;
};

export type RegisterPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  labels: RegisterPaginationLabels;
  /** How many numbered pages to show around the current one. */
  siblings?: number;
  className?: string;
  disabled?: boolean;
};

export function RegisterPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  labels,
  siblings = 1,
  className,
  disabled = false,
}: RegisterPaginationProps) {
  const selectId = useId();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const window = buildPageWindow(current, pageCount, siblings);

  const go = (p: number) => {
    if (disabled) return;
    const next = Math.min(Math.max(1, p), pageCount);
    if (next !== current) onPageChange(next);
  };

  const atStart = current <= 1 || disabled;
  const atEnd = current >= pageCount || disabled;

  return (
    <div
      className={cn(
        // Wraps rather than truncates: a Hindi summary line is materially
        // longer and must never be clipped.
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-sm text-fg-muted tabular" aria-live="polite">
          {labels.summary({ from, to, total })}
        </p>

        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label
              htmlFor={selectId}
              className="text-sm text-fg-muted whitespace-nowrap"
            >
              {labels.pageSize}
            </label>
            <Select
              value={String(pageSize)}
              disabled={disabled}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger id={selectId} size="sm" className="w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)} className="tabular">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Pagination className="mx-0 w-auto justify-end" aria-label={labels.navigation}>
        <PaginationContent className="gap-1">
          {/* First/last and the numbered list are desktop-only. At 360px the
              full control is 11 targets wide (~350px) and would be the one
              thing on the page forcing a horizontal scrollbar; below `sm` it
              degrades to prev / "3 / 25" / next, which is the same
              information in three targets. */}
          <PaginationItem className="hidden sm:block">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={labels.first}
              disabled={atStart}
              onClick={() => go(1)}
            >
              <Icon name="form.chevronsLeft" className="size-4" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={labels.previous}
              disabled={atStart}
              onClick={() => go(current - 1)}
            >
              <Icon name="form.chevronLeft" className="size-4" />
            </Button>
          </PaginationItem>

          <PaginationItem className="sm:hidden">
            <span
              className="px-2 font-mono text-sm text-fg-muted tabular"
              aria-label={labels.currentPage(current)}
            >
              {current} / {pageCount}
            </span>
          </PaginationItem>

          {window.map((p, i) =>
            p === null ? (
              // Key is positional on purpose: two gaps can coexist and neither
              // has a stable identity of its own.
              <PaginationItem key={`gap-${i}`} className="hidden sm:block">
                <PaginationEllipsis className="size-8">
                  <span className="sr-only">{labels.morePages}</span>
                </PaginationEllipsis>
              </PaginationItem>
            ) : (
              <PaginationItem key={p} className="hidden sm:block">
                <PaginationLink
                  href="#"
                  size="icon"
                  isActive={p === current}
                  aria-label={p === current ? labels.currentPage(p) : labels.page(p)}
                  aria-disabled={disabled}
                  className={cn(
                    "size-8 tabular",
                    p === current &&
                      "bg-accent-solid text-fg-on-accent border-transparent hover:bg-accent-solid-hover hover:text-fg-on-accent",
                    disabled && "pointer-events-none opacity-50",
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    go(p);
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={labels.next}
              disabled={atEnd}
              onClick={() => go(current + 1)}
            >
              <Icon name="form.chevronRight" className="size-4" />
            </Button>
          </PaginationItem>
          <PaginationItem className="hidden sm:block">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={labels.last}
              disabled={atEnd}
              onClick={() => go(pageCount)}
            >
              <Icon name="form.chevronsRight" className="size-4" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
