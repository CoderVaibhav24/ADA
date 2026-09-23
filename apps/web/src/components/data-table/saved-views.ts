/**
 * Saved filters.
 *
 * An enforcement officer works the same three or four slices of the register
 * every day — "high priority in my zone", "awaiting my verification", "filed
 * this week and still unassigned" — and rebuilding them from the filter row
 * each morning is the kind of friction that makes people stop filtering at all.
 *
 * Stored in `localStorage`, per register, per browser. That is the honest scope
 * of this version and it is stated in the UI copy rather than implied: a view
 * saved on the desk machine is not on the handset. When a user-preferences
 * endpoint exists, swap `read`/`write` below for calls to it and nothing else
 * in the grid changes.
 *
 * A saved view holds no page number. A view is a slice, not a position, and
 * restoring someone to page 7 of a filter they have not looked at for a week is
 * never what they meant.
 */

import { useCallback, useEffect, useState } from "react";
import type { RegisterState, SavedView, SavedViewsController } from "./types";

const STORAGE_PREFIX = "icms.saved-views.v1.";
const MAX_VIEWS = 20;
const MAX_NAME_LENGTH = 60;

function storageKey(registerId: string): string {
  return `${STORAGE_PREFIX}${registerId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrow a parsed blob into a view, or reject it.
 *
 * `localStorage` is attacker-writable in the sense that matters here: anything
 * that ran in this origin could have put a shape in it, and a previous build of
 * this app certainly could have. A view that fails this check is dropped rather
 * than applied, because applying it would push nonsense into the query string
 * and the server would answer 422.
 */
function toSavedView(value: unknown): SavedView | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;

  const state = raw.state;
  if (typeof state !== "object" || state === null) return null;
  const s = state as Record<string, unknown>;

  if (typeof s.size !== "number" || typeof s.sort !== "string" || typeof s.q !== "string") {
    return null;
  }
  if (!isStringArray(s.hiddenColumns)) return null;

  const filters: Record<string, readonly string[]> = {};
  if (typeof s.filters === "object" && s.filters !== null) {
    for (const [key, values] of Object.entries(s.filters as Record<string, unknown>)) {
      if (isStringArray(values)) filters[key] = values;
    }
  }

  return {
    id: raw.id,
    name: raw.name.slice(0, MAX_NAME_LENGTH),
    state: {
      size: s.size,
      sort: s.sort,
      q: s.q,
      filters,
      hiddenColumns: s.hiddenColumns,
    },
  };
}

function read(registerId: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storageKey(registerId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toSavedView)
      .filter((view): view is SavedView => view !== null)
      .slice(0, MAX_VIEWS);
  } catch {
    // Quota, privacy mode, a corrupt value — none of which is a reason to stop
    // the register rendering.
    return [];
  }
}

function write(registerId: string, views: readonly SavedView[]): void {
  try {
    window.localStorage.setItem(storageKey(registerId), JSON.stringify(views));
  } catch {
    /* storage unavailable; the views simply do not persist this session */
  }
}

/**
 * The controller `<DataTable savedViews>` expects.
 *
 * `apply` is the register's own `setState`, so applying a view goes through the
 * URL like every other state change — which means it is linkable and the back
 * button undoes it, exactly like a hand-built filter.
 */
export function useSavedViews(
  registerId: string,
  current: RegisterState,
  apply: (patch: Partial<RegisterState>) => void,
): SavedViewsController {
  const [views, setViews] = useState<readonly SavedView[]>([]);

  useEffect(() => {
    setViews(read(registerId));
  }, [registerId]);

  const persist = useCallback(
    (next: readonly SavedView[]) => {
      setViews(next);
      write(registerId, next);
    },
    [registerId],
  );

  const onSave = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
      if (trimmed === "") return;
      const view: SavedView = {
        id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: trimmed,
        state: {
          size: current.size,
          sort: current.sort,
          q: current.q,
          filters: current.filters,
          hiddenColumns: current.hiddenColumns,
        },
      };
      // Same name replaces, rather than accumulating three "My cases".
      const without = views.filter((existing) => existing.name !== trimmed);
      persist([view, ...without].slice(0, MAX_VIEWS));
    },
    [current, persist, views],
  );

  const onApply = useCallback(
    (view: SavedView) => {
      apply({ ...view.state, page: 1 });
    },
    [apply],
  );

  const onDelete = useCallback(
    (id: string) => {
      persist(views.filter((view) => view.id !== id));
    },
    [persist, views],
  );

  return { views, onSave, onApply, onDelete };
}
