/**
 * Register state, kept in the URL.
 *
 * The URL is the single source of truth for page, size, sort, search, facets
 * and hidden columns. Not a mirror of component state — the source. That buys
 * three things the legacy estate has none of: a filtered register is a link
 * that can be pasted into an email, the browser's back button undoes a filter
 * change, and a refresh lands on the same rows.
 *
 * What is deliberately NOT in the URL is the row selection. A selection is a
 * thing the officer is holding, not a thing they are looking at; putting it in
 * a shared link would hand someone else a pre-ticked set of cases.
 *
 * The search box is debounced here rather than in the input, so the *typed*
 * value is never delayed — only the commit to the URL and therefore the
 * request. A debounce in the other place makes the field feel broken.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RegisterState, RegisterStatePatch } from "./types";

/** Keys this module owns in the query string. Anything else is left alone. */
const PAGE_KEY = "page";
const SIZE_KEY = "size";
const SORT_KEY = "sort";
const SEARCH_KEY = "q";
const HIDDEN_KEY = "cols";

export type RegisterStateConfig = {
  /** Where the register starts: page 1, the API's default sort, no filters. */
  defaults: RegisterState;
  /** The facet ids that may appear in the URL, e.g. `["status","priority"]`. */
  facetKeys: readonly string[];
  /** How long to wait after the last keystroke before committing the search. */
  debounceMs?: number;
};

type Settings = {
  defaults: RegisterState;
  facetKeys: readonly string[];
  debounceMs: number;
};

function readInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Read the canonical state out of a query string. */
export function decodeRegisterState(
  params: URLSearchParams,
  config: { defaults: RegisterState; facetKeys: readonly string[] },
): RegisterState {
  const { defaults, facetKeys } = config;

  const filters: Record<string, readonly string[]> = {};
  for (const key of facetKeys) {
    const values = params.getAll(key).filter((value) => value !== "");
    // Only present keys are recorded. An empty array and an absent key mean the
    // same thing and must serialise identically, or two links to the same view
    // would differ.
    if (values.length > 0) filters[key] = values;
  }

  const rawHidden = params.get(HIDDEN_KEY);
  const hidden =
    rawHidden === null
      ? defaults.hiddenColumns
      : rawHidden === "-"
        ? []
        : rawHidden
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value !== "");

  return {
    page: readInt(params.get(PAGE_KEY), defaults.page, 1, 100_000),
    // The API refuses a size above 200 with a 422 rather than clamping, so a
    // hand-edited URL is clamped here instead of being turned into an error.
    size: readInt(params.get(SIZE_KEY), defaults.size, 1, 200),
    sort: params.get(SORT_KEY) ?? defaults.sort,
    q: params.get(SEARCH_KEY) ?? defaults.q,
    filters,
    hiddenColumns: hidden,
  };
}

/**
 * Write a state back into a query string, preserving parameters this module
 * does not own and omitting everything that is at its default.
 *
 * Omitting defaults matters: `/complaints` and
 * `/complaints?page=1&size=25&sort=-raised_at` are the same view, and only one
 * of them is a URL anyone would send to a colleague.
 */
export function encodeRegisterState(
  state: RegisterState,
  config: { defaults: RegisterState; facetKeys: readonly string[] },
  base?: URLSearchParams,
): URLSearchParams {
  const { defaults, facetKeys } = config;
  const next = new URLSearchParams(base);

  for (const key of [PAGE_KEY, SIZE_KEY, SORT_KEY, SEARCH_KEY, HIDDEN_KEY, ...facetKeys]) {
    next.delete(key);
  }

  if (state.page !== defaults.page) next.set(PAGE_KEY, String(state.page));
  if (state.size !== defaults.size) next.set(SIZE_KEY, String(state.size));
  if (state.sort !== defaults.sort) next.set(SORT_KEY, state.sort);
  if (state.q !== "") next.set(SEARCH_KEY, state.q);
  // Compared against the register's OWN default, not against "nothing hidden".
  // The Complaints register hides four columns out of the box; encoding those
  // every time would put `?cols=…` on the plain, unfiltered URL.
  const hidden = [...state.hiddenColumns].sort().join(",");
  if (hidden !== [...defaults.hiddenColumns].sort().join(",")) {
    // An explicit empty marker, so "the officer switched every column back on"
    // is distinguishable from "the officer changed nothing".
    next.set(HIDDEN_KEY, hidden === "" ? "-" : hidden);
  }
  for (const key of facetKeys) {
    for (const value of state.filters[key] ?? []) next.append(key, value);
  }

  next.sort();
  return next;
}

/** True when anything narrows the register beyond its defaults. */
export function isFiltered(state: RegisterState): boolean {
  return state.q !== "" || Object.values(state.filters).some((v) => v.length > 0);
}

export type RegisterStateHandle = {
  /** The committed state. Drives the URL and the fetch. */
  state: RegisterState;
  /** Merge a patch. Any change other than the page resets to page 1. */
  setState: (patch: RegisterStatePatch) => void;
  /** The live, undebounced search text. Bind this to the input. */
  searchValue: string;
  setSearchValue: (value: string) => void;
  /** Clear the search and every facet, keeping sort, size and columns. */
  clearFilters: () => void;
  isFiltered: boolean;
};

export function useRegisterState(config: RegisterStateConfig): RegisterStateHandle {
  const [params, setParams] = useSearchParams();

  const {
    defaults,
    facetKeys,
    debounceMs = 350,
  } = config;

  // Callers rebuild `config` on every render, so the memo keys off its contents
  // rather than its identity.
  const facetSignature = facetKeys.join("|");
  const defaultSignature = `${defaults.page}|${defaults.size}|${defaults.sort}|${defaults.q}|${[...defaults.hiddenColumns].sort().join(",")}`;
  const settings = useMemo<Settings>(
    () => ({ defaults, facetKeys, debounceMs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, not identity
    [defaultSignature, facetSignature, debounceMs],
  );

  const state = useMemo(() => decodeRegisterState(params, settings), [params, settings]);

  const setState = useCallback(
    (patch: RegisterStatePatch) => {
      setParams(
        (current) => {
          const merged: RegisterState = { ...decodeRegisterState(current, settings), ...patch };
          // Any narrowing or reordering invalidates the current page number.
          // Staying on page 7 of a filter that now has two pages is the classic
          // "it says no records but there are records" bug.
          const changedBeyondPage = Object.keys(patch).some((key) => key !== "page");
          if (changedBeyondPage && patch.page === undefined) merged.page = 1;
          return encodeRegisterState(merged, settings, current);
        },
        // A push, not a replace: the back button has to undo a filter change.
        { replace: false },
      );
    },
    [setParams, settings],
  );

  // ---- the debounced search box -----------------------------------------
  const [searchValue, setSearchValue] = useState(state.q);
  const committed = useRef(state.q);
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  // The URL moved underneath us — back/forward, or a saved view was applied.
  // Adopt it, or the box would keep showing what the officer typed two views
  // ago while the rows show something else.
  useEffect(() => {
    if (state.q !== committed.current) {
      committed.current = state.q;
      setSearchValue(state.q);
    }
  }, [state.q]);

  useEffect(() => {
    if (searchValue === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = searchValue;
      setStateRef.current({ q: searchValue });
    }, settings.debounceMs);
    return () => window.clearTimeout(timer);
  }, [searchValue, settings.debounceMs]);

  const clearFilters = useCallback(() => {
    committed.current = "";
    setSearchValue("");
    setStateRef.current({ q: "", filters: {} });
  }, []);

  return {
    state,
    setState,
    searchValue,
    setSearchValue,
    clearFilters,
    isFiltered: isFiltered(state),
  };
}
