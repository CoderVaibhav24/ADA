/**
 * The controls around the grid.
 *
 * Figma draws three inert dropdowns, a search box and nothing else: no sort
 * affordance, no column chooser, no selection, no saved filters, no export
 * feedback. Everything here that the frame does not contain is designed against
 * the same token layer the frame samples — `--surface-2` for a control well,
 * `--line` for its edge, `--radius-lg` for its corner — so a new control reads
 * as part of the screen rather than as something bolted on.
 *
 * No English anywhere: every string is a label prop.
 */

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/lib/icons";
import { InlineSpinner } from "@/components/icms/states";
import { directionOf } from "./sort";
import type {
  BulkAction,
  DataTableLabels,
  FacetDef,
  SavedView,
  SavedViewsController,
} from "./types";

/* ------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------ */

/**
 * A sortable column header.
 *
 * The API takes ONE sort key, so this is a single-column control and the click
 * cycles asc -> desc -> back to the register's default. A three-state cycle
 * rather than a two-state toggle because the default sort (`-raised_at`,
 * newest first) is itself meaningful, and an officer who sorted by complainant
 * name needs a way back to it that is not the browser's reload button.
 *
 * The `<th>` carries `aria-sort`; this renders only its contents.
 */
export function DataTableColumnHeader({
  header,
  sortKey,
  sort,
  defaultSort,
  onSortChange,
  labels,
  align = "start",
}: {
  header: ReactNode;
  /** Absent = not sortable. No affordance is rendered at all. */
  sortKey?: string;
  sort: string;
  defaultSort: string;
  onSortChange: (sort: string) => void;
  labels: DataTableLabels;
  align?: "start" | "end";
}) {
  if (!sortKey) {
    return <span className={cn("block", align === "end" && "text-end")}>{header}</span>;
  }

  const direction = directionOf(sort, sortKey);
  const next = direction === null ? sortKey : direction === "asc" ? `-${sortKey}` : defaultSort;
  const nextLabel =
    direction === null
      ? labels.sortAscending
      : direction === "asc"
        ? labels.sortDescending
        : labels.sortClear;

  return (
    <button
      type="button"
      onClick={() => {
        onSortChange(next);
      }}
      // The state is already on the <th> as aria-sort; the button's own name
      // says what pressing it will DO, which is what a screen-reader user needs
      // at the moment of deciding whether to press it.
      aria-label={nextLabel}
      className={cn(
        "group -mx-1 inline-flex max-w-full items-center gap-1 rounded-xs px-1 py-0.5",
        "transition-colors duration-fast ease-standard hover:text-fg-strong",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        align === "end" && "flex-row-reverse",
      )}
    >
      <span className="min-w-0 truncate">{header}</span>
      <Icon
        name={
          direction === "asc"
            ? "form.chevronUp"
            : direction === "desc"
              ? "form.chevronDown"
              : "action.sort"
        }
        className={cn(
          "size-3 shrink-0 transition-opacity duration-fast ease-standard",
          // Invisible until wanted, so nine chevrons do not compete with the
          // data — but never `display:none`, which would shift the header text
          // sideways the moment it appeared.
          direction === null &&
            "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60",
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export function DataTableSearch({
  value,
  onChange,
  labels,
  id,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  labels: DataTableLabels;
  id: string;
  busy?: boolean;
}) {
  return (
    <div className="relative w-full max-w-[22rem] min-w-0">
      {/* A real label, visually hidden. A placeholder is not a label: it
          disappears the moment the officer types, and it is not announced. */}
      <label htmlFor={id} className="sr-only">
        {labels.searchLabel}
      </label>
      <Icon
        name="nav.search"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint"
      />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={labels.searchPlaceholder}
        className="h-9 rounded-lg bg-surface-2 pr-9 pl-9"
        autoComplete="off"
        spellCheck={false}
      />
      {busy ? (
        <Icon
          name="feedback.loading"
          spin
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-faint"
        />
      ) : value !== "" ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={labels.clearSearch}
          className="absolute top-1/2 right-2 -translate-y-1/2"
          onClick={() => {
            onChange("");
          }}
        >
          <Icon name="action.clear" className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Facets
 * ------------------------------------------------------------------ */

/**
 * A multi-select facet.
 *
 * Multi-select because the API ORs repeated values of one parameter, and
 * because "everything that is not closed" is several statuses, not one. Figma's
 * dropdowns are single-value placeholders; this keeps their trigger shape and
 * adds a count badge once more than one value is chosen.
 */
export function DataTableFacetFilter({
  facet,
  selected,
  onChange,
  labels,
}: {
  facet: FacetDef;
  selected: readonly string[];
  onChange: (values: readonly string[]) => void;
  labels: DataTableLabels;
}) {
  const [open, setOpen] = useState(false);
  const chosen = new Set(selected);

  const toggle = (value: string) => {
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="listbox"
          className={cn(
            "h-9 min-w-0 max-w-full justify-between gap-2 rounded-lg border-line bg-surface-2 font-normal",
            chosen.size > 0 && "border-accent-soft-border text-fg-strong",
          )}
        >
          <span className="truncate">{facet.label}</span>
          {chosen.size > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 text-2xs text-fg-strong tabular">
              {chosen.size}
            </span>
          )}
          <Icon name="form.chevronDown" className="size-3.5 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[16rem] p-0">
        <Command>
          <CommandInput placeholder={labels.facetSearchPlaceholder} />
          <CommandList>
            <CommandEmpty>{labels.facetNoResults}</CommandEmpty>
            <CommandGroup>
              {facet.options.map((option) => {
                const isChosen = chosen.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      toggle(option.value);
                    }}
                    className="gap-2"
                    aria-selected={isChosen}
                  >
                    <Checkbox
                      checked={isChosen}
                      tabIndex={-1}
                      aria-hidden
                      className="shrink-0"
                    />
                    {option.icon && <Icon name={option.icon} className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {chosen.size > 0 && (
            <>
              <Separator />
              <div className="p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    onChange([]);
                  }}
                >
                  {labels.facetClear}
                </Button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ *
 * Column visibility and density
 * ------------------------------------------------------------------ */

export type ColumnToggle = {
  id: string;
  label: ReactNode;
  visible: boolean;
  locked: boolean;
};

export function DataTableViewOptions({
  columns,
  onToggle,
  density,
  onDensityChange,
  labels,
}: {
  columns: readonly ColumnToggle[];
  onToggle: (id: string, visible: boolean) => void;
  density: "compact" | "standard";
  onDensityChange?: (density: "compact" | "standard") => void;
  labels: DataTableLabels;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={labels.columns} className="size-9">
          <Icon name="data.table" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[14rem]">
        <DropdownMenuLabel>{labels.columns}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            disabled={column.locked}
            onCheckedChange={(checked) => {
              onToggle(column.id, checked === true);
            }}
            onSelect={(event) => {
              // Keep the menu open: hiding four columns should be four clicks,
              // not four round trips through the trigger.
              event.preventDefault();
            }}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        {onDensityChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{labels.density}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={density === "compact"}
              onCheckedChange={() => {
                onDensityChange("compact");
              }}
            >
              {labels.densityCompact}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={density === "standard"}
              onCheckedChange={() => {
                onDensityChange("standard");
              }}
            >
              {labels.densityStandard}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ *
 * Saved views
 * ------------------------------------------------------------------ */

export function DataTableSavedViews({
  controller,
  labels,
}: {
  controller: SavedViewsController;
  labels: DataTableLabels;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    controller.onSave(name);
    setName("");
    setNaming(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Icon name="action.save" className="size-4" />
            <span className="hidden sm:inline">{labels.savedViews}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[16rem]">
          <DropdownMenuLabel>{labels.savedViews}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {controller.views.length === 0 ? (
            <p className="px-2 py-3 text-sm text-fg-muted">{labels.noSavedViews}</p>
          ) : (
            controller.views.map((view: SavedView) => (
              <div key={view.id} className="flex items-center gap-1 pr-1">
                <DropdownMenuItem
                  className="min-w-0 flex-1"
                  onSelect={() => {
                    controller.onApply(view);
                  }}
                >
                  <span className="truncate">{view.name}</span>
                </DropdownMenuItem>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={labels.deleteView(view.name)}
                  onClick={() => {
                    controller.onDelete(view.id);
                  }}
                >
                  <Icon name="action.delete" className="size-3.5" />
                </Button>
              </div>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setNaming(true);
            }}
          >
            <Icon name="action.add" className="size-4" />
            {labels.saveCurrentView}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* A dialog rather than window.prompt: prompt() cannot be translated,
          cannot be styled and is blocked outright in some browsers. */}
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-[26rem]">
          <DialogHeader>
            <DialogTitle>{labels.saveCurrentView}</DialogTitle>
            <DialogDescription>{labels.saveViewNamePrompt}</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            autoFocus
            aria-label={labels.saveViewNamePrompt}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() !== "") save();
            }}
          />
          <DialogFooter>
            <Button disabled={name.trim() === ""} onClick={save}>
              {labels.saveCurrentView}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function DataTableExportButton({
  onExport,
  busy,
  progress,
  labels,
}: {
  onExport: () => void;
  busy?: boolean;
  progress?: ReactNode;
  labels: DataTableLabels;
}) {
  return (
    <div className="flex items-center gap-2">
      {busy && progress != null && <InlineSpinner label={progress} />}
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2"
        disabled={busy}
        onClick={onExport}
      >
        <Icon name="action.export" className="size-4" />
        {busy ? labels.exporting : labels.exportLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/**
 * The bulk-action bar.
 *
 * Appears above the table once anything is selected, so the count and the
 * actions sit next to each other and the officer does not have to hunt.
 * `aria-live` announces the count, because otherwise selecting with the
 * keyboard gives no feedback at all.
 */
export function DataTableSelectionBar<TRow>({
  count,
  rows,
  actions,
  onClear,
  labels,
}: {
  count: number;
  rows: readonly TRow[];
  actions: readonly BulkAction<TRow>[];
  onClear: () => void;
  labels: DataTableLabels;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-soft-border bg-accent-soft px-3 py-2">
      <p className="text-sm text-fg-strong tabular" aria-live="polite">
        {labels.selected(count)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.variant === "primary" ? "default" : "outline"}
            disabled={action.disabled}
            onClick={() => {
              action.onSelect(rows);
            }}
          >
            {action.icon && <Icon name={action.icon} className="size-4" />}
            {action.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onClear}>
          {labels.clearSelection}
        </Button>
      </div>
    </div>
  );
}
