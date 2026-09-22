import type { RegisterPaginationLabels } from "./RegisterPagination";

/**
 * SEED DICTIONARY — not imported by RegisterPagination itself.
 * The component takes `labels` as a required prop so no English lives inside a
 * primitive. Move these into the EN resource bundle when i18n lands.
 *
 * `summary` is a function, not a template string, because Hindi orders the
 * clause differently ("N में से X–Y दिखा रहे हैं") and a positional %s would
 * force the wrong order.
 */
export const paginationLabelsEn: RegisterPaginationLabels = {
  summary: ({ from, to, total }) =>
    total === 0 ? "No records" : `Showing ${from}–${to} of ${total}`,
  previous: "Previous",
  next: "Next",
  first: "First page",
  last: "Last page",
  pageSize: "Rows per page",
  page: (n) => `Page ${n}`,
  currentPage: (n) => `Page ${n}, current page`,
  morePages: "More pages",
  navigation: "Pagination",
};
