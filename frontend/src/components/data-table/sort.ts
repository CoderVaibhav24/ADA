/**
 * Reading the API's sort string.
 *
 * Its own module rather than a helper beside the header component, because a
 * file that exports both a component and a function loses React Fast Refresh
 * for everything in it — and the grid's header is exactly the thing you want to
 * iterate on without losing the page's state.
 *
 * The wire format is the API's: a whitelisted key, `-` prefixed for descending
 * (`-raised_at`). The frontend does not invent a `{id, desc}` shape and then
 * translate it at the boundary; there is one representation and it is the one
 * that goes over the wire.
 */

export type SortDirection = "asc" | "desc" | null;

export function directionOf(sort: string, sortKey: string | undefined): SortDirection {
  if (!sortKey) return null;
  if (sort === sortKey) return "asc";
  if (sort === `-${sortKey}`) return "desc";
  return null;
}
