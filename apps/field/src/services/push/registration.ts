import type { components } from '@ada/api-types/notify-api';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getAccessToken } from '@/services/auth/session';

import { NOTIFY_PATHS, NOTIFY_TIMEOUT_MS, REREGISTER_AFTER_MS, pushEnv } from './constants';
import { currentPushPermission } from './permission';
import { readRegistration, writeRegistration } from './storage';

/*
 * The device registry, from the handset's side (push-and-permissions.md §4).
 *
 * The token is the native one — FCM on Android, APNs on iOS — from
 * `getDevicePushTokenAsync`. `getExpoPushTokenAsync` would need an Expo account
 * and route every payload through Expo; neither is acceptable here.
 *
 * Every function in this file swallows its failures. A registration that fails is
 * retried on the next sign-in, token change or launch; it never surfaces as an
 * error to a surveyor and never blocks anything they are doing.
 */

// Body of POST /v1/me/devices. `apns_environment` is required for iOS and must be null for Android.
export type DeviceRegistration = components['schemas']['DeviceRegister'];

// Registrations run one after another, so a token change mid-flight is never dropped.
let queue: Promise<void> = Promise.resolve();

function pushSupported(): boolean {
  return (Platform.OS === 'android' || Platform.OS === 'ios') && pushEnv.notifyBaseUrl !== null;
}

// One POST to ada-notify with the session's bearer. Answers whether it succeeded; never throws.
export async function notifyRequest(path: string, body?: unknown): Promise<boolean> {
  if (pushEnv.notifyBaseUrl === null) return false;
  const bearer = await getAccessToken();
  if (bearer === null) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    const response = await fetch(`${pushEnv.notifyBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The native token, or null on a simulator, a build without Firebase, or no Play Services.
async function nativeToken(): Promise<string | null> {
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' && token.data !== '' ? token.data : null;
  } catch {
    return null;
  }
}

// ada-notify accepts [A-Za-z0-9:_-], 16–4096 characters. Anything else is not sent.
const TOKEN_SHAPE = /^[A-Za-z0-9:_-]{16,4096}$/;

// "1.0.0 (42)": the JS-visible version and, when the build set one, the native build number.
function appVersion(): string | null {
  const config = Constants.expoConfig;
  const version = config?.version;
  if (typeof version !== 'string' || version === '') return null;
  const build = Platform.OS === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode;
  return build === undefined || build === null ? version : `${version} (${String(build)})`;
}

function describe(token: string): DeviceRegistration {
  const ios = Platform.OS === 'ios';
  return {
    platform: ios ? 'ios' : 'android',
    token,
    // The entitlement is `development` or `production`; the server's names are `sandbox` or `production`.
    apns_environment: ios ? (pushEnv.apnsEnvironment === 'production' ? 'production' : 'sandbox') : null,
    app_version: appVersion(),
  };
}

async function register(subject: string, knownToken: string | null): Promise<void> {
  const { status } = await currentPushPermission();
  const previous = readRegistration();

  // Permission revoked since the last registration: tell the server to stop sending.
  if (status !== 'granted') {
    if (previous !== null && (await notifyRequest(NOTIFY_PATHS.unregisterDevice, { token: previous.token }))) {
      writeRegistration(null);
    }
    return;
  }

  const token = knownToken ?? (await nativeToken());
  if (token === null || !TOKEN_SHAPE.test(token)) return;

  const fresh =
    previous !== null &&
    previous.token === token &&
    previous.subject === subject &&
    Date.now() - previous.registeredAt < REREGISTER_AFTER_MS;
  if (fresh) return;

  if (await notifyRequest(NOTIFY_PATHS.registerDevice, describe(token))) {
    writeRegistration({ token, subject, registeredAt: Date.now() });
  }
}

/*
 * Registers this handset for `subject` if it is not already, or if the token or
 * the user changed. Safe to call as often as the session changes.
 */
export function syncRegistration(subject: string, knownToken: string | null = null): Promise<void> {
  if (!pushSupported()) return Promise.resolve();
  queue = queue.then(() => register(subject, knownToken)).catch(() => undefined);
  return queue;
}

/*
 * Removes this handset from the registry. Runs before sign-out clears the bearer.
 * The local record is forgotten whatever the server says, so the next person to
 * sign in on this handset registers afresh; ada-notify's upsert is keyed on the
 * token, so that registration re-owns it even if this unregister never arrived.
 */
export async function unregisterDevice(): Promise<void> {
  const previous = readRegistration();
  writeRegistration(null);
  if (previous === null || !pushSupported()) return;
  await notifyRequest(NOTIFY_PATHS.unregisterDevice, { token: previous.token });
}

// Forgets the local record without a network call; for a session the provider already ended.
export function forgetRegistration(): void {
  writeRegistration(null);
}
