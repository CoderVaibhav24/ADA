import type { QueryValue } from '@/services/api/client';

import { CALL_API_DENY_PREFIXES, DATA_PATH_PREFIXES, OPEN_URL_HOSTS } from './contract';
import { interpolate, toDisplay, type Labeller, type Scope } from './template';
import type { QueryLiteral } from './types';

/*
 * The only way a screen definition turns into a request or a URL. Every result is
 * re-checked here after interpolation, on the device, whatever the server allowed:
 * a path is an `/api/icms/` path made of plain segments, and a URL is https on a
 * host this binary lists. Anything else answers null and the node does nothing.
 */

const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const WHOLE_TEMPLATE = /^\{\{[^{}]*\}\}$/;
const HTTPS_URL = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(\/[^\s{}]*)?$/;

const noLabels: Labeller = (_domain, code) => code;

/*
 * Interpolates a path template segment by segment. A templated value is encoded
 * into one opaque segment, so `../admin` cannot climb; an empty value makes the
 * whole path null rather than collapsing two segments into one. The segment after
 * the prefix (the resource) must be literal, as the server also insists.
 */
export function resolvePath(template: string, scope: Scope, mode: 'data' | 'call' = 'data'): string | null {
  const prefix = DATA_PATH_PREFIXES.find((candidate) => template.startsWith(candidate));
  if (prefix === undefined) return null;
  const resourceIndex = prefix.split('/').length - 2;

  const segments: string[] = [];
  const raw = template.slice(1).split('/');
  for (const [index, segment] of raw.entries()) {
    if (WHOLE_TEMPLATE.test(segment) && index > resourceIndex) {
      const value = toDisplay(interpolate(segment, scope, noLabels));
      if (value === '' || value === '.' || value === '..') return null;
      segments.push(encodeURIComponent(value));
    } else if (SEGMENT.test(segment) && segment !== '.' && segment !== '..') {
      segments.push(segment);
    } else {
      return null;
    }
  }

  const path = `/${segments.join('/')}`;
  if (!path.startsWith(prefix)) return null;
  if (mode === 'call' && CALL_API_DENY_PREFIXES.some((denied) => path.startsWith(denied))) return null;
  return path;
}

// The query object with its templates resolved, in the shape the API client sends.
export function resolveQuery(
  query: Readonly<Record<string, QueryLiteral>> | undefined,
  scope: Scope,
): Record<string, QueryValue> {
  const resolved: Record<string, QueryValue> = {};
  if (query === undefined) return resolved;
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      resolved[key] = (value as readonly (string | number)[]).map((item) =>
        toDisplay(interpolate(item, scope, noLabels)),
      );
    } else if (typeof value === 'string') {
      const text = toDisplay(interpolate(value, scope, noLabels));
      resolved[key] = text === '' ? undefined : text;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      resolved[key] = value;
    }
  }
  return resolved;
}

// An https URL on an allowed host, or null. The allowlist ships in the binary.
export function safeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const host = HTTPS_URL.exec(url)?.[1];
  return host !== undefined && OPEN_URL_HOSTS.includes(host) ? url : null;
}
