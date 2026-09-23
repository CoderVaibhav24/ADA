/**
 * The non-component half of this feature, kept out of `parts.tsx`.
 *
 * Same split `features/inspections/detailModel.ts` makes: a `.tsx` that exports
 * both components and a plain function costs Fast Refresh on that file, and
 * oxlint says so (`react(only-export-components)`).
 */

/** The name an officer is listed under, or their username when they have none. */
export function displayName(user: {
  first_name?: string | null;
  last_name?: string | null;
  username: string;
}): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full === "" ? user.username : full;
}
