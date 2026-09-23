import * as Crypto from 'expo-crypto';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';

import { apiRequest } from '@/services/api/client';
import { errorText } from '@/services/api/error-text';
import { idempotencyKeyFor, releaseIdempotencyKey } from '@/services/api/idempotency';

import { isRouteName, routeParams, type RouteName } from './contract';
import { resolvePath, safeUrl } from './paths';
import { interpolate, toDisplay, type Labeller, type Scope } from './template';
import { isRecord } from './types';

/*
 * The action registry: navigate, refresh, open_url, call_api. Nothing else runs.
 * A definition names an action and its arguments; what the action does is code in
 * this file, and every argument is re-checked here before it is used.
 */

export type ActionContext = {
  readonly screenId: string;
  readonly nodeId?: string;
  readonly scope: Scope;
  readonly labeller: Labeller;
  readonly refresh: () => void;
};

const SCREEN_ID = /^[a-z][a-z0-9_]{1,63}$/;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

// One entry per contract route; the `satisfies` makes a route added to the contract a type error here.
const ROUTES = {
  home: () => '/home',
  complaints: () => '/complaints',
  profile: () => '/profile',
  notifications: () => '/notifications',
  complaint_detail: (params) => ({
    pathname: '/complaint/[caseRef]',
    params: { caseRef: params.caseRef ?? '' },
  }),
} satisfies Record<RouteName, (params: Readonly<Record<string, string>>) => Href>;

const inFlight = new Set<string>();

function warn(message: string): void {
  console.warn(`[sdui] ${message}`);
}

function text(value: unknown, context: ActionContext): string {
  return toDisplay(interpolate(value, context.scope, context.labeller));
}

function resolveParams(params: unknown, context: ActionContext): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!isRecord(params)) return resolved;
  for (const [key, value] of Object.entries(params)) {
    if (PARAM_KEY.test(key)) resolved[key] = text(value, context);
  }
  return resolved;
}

function navigate(action: Record<string, unknown>, context: ActionContext): void {
  const params = resolveParams(action.params, context);
  if (action.route !== undefined) {
    if (!isRouteName(action.route)) return warn(`unknown route ${String(action.route)}`);
    const route = action.route;
    if (routeParams(route).some((name) => (params[name] ?? '') === '')) {
      return warn(`route ${route} is missing a parameter`);
    }
    router.push(ROUTES[route](params));
    return;
  }
  const screen = action.screen;
  if (typeof screen !== 'string' || !SCREEN_ID.test(screen)) return warn('navigate names no screen');
  router.push({ pathname: '/s/[screenId]', params: { ...params, screenId: screen } });
}

// Resolves a call_api body: whole templates keep their primitive type, nested values recurse.
function resolveBody(value: unknown, context: ActionContext, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') {
    const resolved = interpolate(value, context.scope, context.labeller);
    return typeof resolved === 'number' || typeof resolved === 'boolean' ? resolved : toDisplay(resolved);
  }
  if (Array.isArray(value)) return value.map((item) => resolveBody(item, context, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveBody(item, context, depth + 1)]),
    );
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
}

// Sorted keys, so the same body always hashes to the same idempotency scope.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/*
 * The write. The idempotency key is minted for this action on this screen with this
 * body, at the tap, and kept until the server confirms — so a retry after a dropped
 * connection is the same request, not a second record (code-standards.md rule 4).
 */
async function execute(path: string, body: unknown, context: ActionContext, refreshAfter: boolean): Promise<void> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${path}\n${stableStringify(body)}`,
  );
  const scope = `sdui:${context.screenId}:${context.nodeId ?? 'action'}:${digest}`;
  if (inFlight.has(scope)) return;
  inFlight.add(scope);
  try {
    await apiRequest<unknown>(path, {
      method: 'POST',
      body,
      idempotencyKey: idempotencyKeyFor(scope),
    });
    releaseIdempotencyKey(scope);
    if (refreshAfter) context.refresh();
  } catch (error) {
    Alert.alert('That did not go through', errorText(error).message);
  } finally {
    inFlight.delete(scope);
  }
}

function callApi(action: Record<string, unknown>, context: ActionContext): void {
  const path = typeof action.path === 'string' ? resolvePath(action.path, context.scope, 'call') : null;
  if (path === null) return warn('call_api path refused');
  const confirm = action.confirm;
  if (!isRecord(confirm)) return warn('call_api without a confirmation');
  const title = text(confirm.title, context);
  const message = text(confirm.message, context);
  const confirmLabel = text(confirm.confirmLabel, context) || 'Confirm';
  const body = resolveBody(action.body ?? {}, context);
  const refreshAfter = action.then !== 'none';

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, onPress: () => void execute(path, body, context, refreshAfter) },
  ]);
}

// Runs one action. Never throws: a broken action is logged and does nothing.
export function runAction(action: unknown, context: ActionContext): void {
  if (!isRecord(action)) return;
  try {
    switch (action.type) {
      case 'navigate':
        navigate(action, context);
        return;
      case 'refresh':
        context.refresh();
        return;
      case 'open_url': {
        const url = safeUrl(action.url);
        if (url === null) return warn('open_url refused');
        void WebBrowser.openBrowserAsync(url);
        return;
      }
      case 'call_api':
        callApi(action, context);
        return;
      default:
        warn(`unknown action ${String(action.type)}`);
    }
  } catch (error) {
    warn(`action ${String(action.type)} failed: ${error instanceof Error ? error.name : 'error'}`);
  }
}
