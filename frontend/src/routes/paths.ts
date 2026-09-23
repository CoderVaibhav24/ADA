export const LOGIN_PATH = "/login";
export const CALLBACK_PATH = "/auth/callback";
export const LEGACY_SIGNED_OUT_PATH = "/auth/signed-out";
export const AUTH_PATHS = [CALLBACK_PATH, LOGIN_PATH] as const;

export const ROUTES = {
  dashboard: "/dashboard",
  changeDetection: "/change-detection",

  complaints: "/complaints",
  complaintNew: "/complaints/new",
  complaint: (id = ":complaintId") => `/complaints/${id}`,

  inspections: "/inspections",
  inspection: (id = ":inspectionId") => `/inspections/${id}`,
  inspectionFindings: (id = ":inspectionId") => `/inspections/${id}/findings`,

  notices: "/notices",
  noticeNew: "/notices/new",
  notice: (id = ":noticeId") => `/notices/${id}`,

  reports: "/reports",

  // One route for the whole policy area; its three screens are tabs on it, kept
  // linkable by `?tab=`. Three paths would put three rail-matching prefixes
  // where the product has one section.
  administration: "/administration",

  // A path UNDER /administration rather than beside it, because officers and
  // policy are one administrative area — but its own route and its own rail
  // entry, because the two are gated on different permissions (`user.read` and
  // `policy.read`) and one entry would hide whichever screen the officer is not
  // gated for. `activeNavId` resolves the overlap on longest prefix.
  administrationUsers: "/administration/users",
} as const;

export const HOME_PATH: string = ROUTES.complaints;
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return HOME_PATH;
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return HOME_PATH;
  if (value.startsWith("/auth/")) return HOME_PATH;
  return value;
}
