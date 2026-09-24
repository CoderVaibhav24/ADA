import { cachedAccessToken } from "../../auth/oidc";

/**
 * MapLibre issues tile requests itself, so the bearer token has to be attached
 * here — nothing else in the app sees them. Only our own /api tiles get the
 * header: sending it to the OpenStreetMap basemap would hand an access token to
 * a third party.
 *
 * `transformRequest` is synchronous, so it can only use a token already in
 * hand. The route guard (routes/RequireAuth) primes that cache before a map
 * mounts, and MapView's refresh interval keeps it fresh.
 */
export function authorizeTileRequest(
  url: string,
  resourceType?: string,
): { url: string; headers?: Record<string, string> } {
  if (resourceType !== "Tile") return { url };
  // MapLibre substitutes {z}/{x}/{y} into the tile template and hands the
  // result here unchanged, so our own tiles arrive as the relative path
  // "/api/tiles/..." — never as an absolute URL. A startsWith(origin) test
  // therefore never matched, every raster and mask tile went out without the
  // bearer token, and the API answered 401: layers READY in the sidebar,
  // nothing drawn on the map. Resolve against the page first, then decide.
  let target: URL;
  try {
    target = new URL(url, window.location.href);
  } catch {
    return { url };
  }
  if (
    target.origin !== window.location.origin ||
    !target.pathname.startsWith("/api/")
  ) {
    return { url };
  }
  const token = cachedAccessToken();
  return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
}
