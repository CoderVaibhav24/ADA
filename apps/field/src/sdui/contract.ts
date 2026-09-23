import contractJson from './contract.json';

/*
 * The SDUI contract as this binary knows it. `contract.json` is byte-identical to
 * `services/api/app/icms/sdui_contract.json`; the backend suite fails if they drift.
 * The server validates against it on write, and this app re-checks the security
 * parts (paths, URLs, routes) on render, so neither side trusts the other alone.
 */
export const contract = contractJson;

/** Sent as `?runtime=` so the server never serves a screen needing a component this binary lacks. */
export const SDUI_RUNTIME: string = contractJson.runtime;

export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = contractJson.schemaVersions;

export type RouteName = keyof typeof contractJson.routes;

export const DATA_PATH_PREFIXES: readonly string[] = contractJson.dataPathPrefixes;
export const CALL_API_DENY_PREFIXES: readonly string[] = contractJson.callApiDenyPrefixes;
export const OPEN_URL_HOSTS: readonly string[] = contractJson.openUrlHosts;
export const MAX_LIST_ITEMS: number = contractJson.limits.maxListItems;

// True when a route name is one this binary registered.
export function isRouteName(value: unknown): value is RouteName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(contractJson.routes, value);
}

// The params a registered route takes, in contract order.
export function routeParams(route: RouteName): readonly string[] {
  return contractJson.routes[route].params;
}
