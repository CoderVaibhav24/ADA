import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { currentAppConfig } from '@/services/config/app-config';
import { cacheStore } from '@/services/storage/kv';

import { AdaApiError } from './errors';

/*
 * Reads are TanStack Query, and the cache is persisted.
 *
 * The reason is the field: a surveyor opening the app at a gate with one bar
 * must see yesterday's assigned work immediately, and must be told how old it is
 * rather than shown a spinner that never resolves (`ui-rules.md`, Architecture.md
 * §4.1). `networkMode: 'offlineFirst'` is what makes a query run from the cache
 * instead of parking itself while the device is offline.
 *
 * Writes do not go through here. There is no offline write queue in this build
 * (progress-tracker.md §6, 2026-09-22); a write is a direct request carrying an
 * idempotency key.
 */
const MMKV_PERSISTER_KEY = 'query-cache';

// A week: long enough that a handset left in a drawer over a weekend still opens with content.
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const storage = {
  getItem: (key: string): string | null => cacheStore.getString(key) ?? null,
  setItem: (key: string, value: string): void => cacheStore.set(key, value),
  removeItem: (key: string): void => {
    cacheStore.remove(key);
  },
};

// A 4xx is the server's considered answer; retrying it only wastes a field battery.
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof AdaApiError) {
    if (error.isOffline) return failureCount < 3;
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 3;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 60_000,
      gcTime: CACHE_MAX_AGE_MS,
      retry: shouldRetry,
      refetchOnReconnect: true,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: false,
    },
  },
});

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({ storage, key: MMKV_PERSISTER_KEY }),
  maxAge: CACHE_MAX_AGE_MS,
  /*
   * Bumping the buster discards every persisted entry. Change it when a response
   * shape changes, so a stale cache cannot render into a screen that no longer
   * understands it.
   */
  buster: 'ada-icms-v1',
};

let wired = false;

/*
 * Connects TanStack's online and focus managers to the platform. Called once from
 * the root layout; the listeners live as long as the app does.
 */
export function wireQueryLifecycle(): () => void {
  if (wired) return () => undefined;
  wired = true;

  const network = Network.addNetworkStateListener((state) => {
    onlineManager.setOnline(state.isConnected === true && state.isInternetReachable !== false);
  });

  void Network.getNetworkStateAsync()
    .then((state) => {
      onlineManager.setOnline(state.isConnected === true && state.isInternetReachable !== false);
    })
    .catch(() => onlineManager.setOnline(true));

  const appState = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });

  return () => {
    network.remove();
    appState.remove();
    wired = false;
  };
}

export type DataAge = {
  /** Milliseconds since the server last answered. */
  readonly ageMs: number;
  /** True once the age passes the served threshold — the screen says so out loud. */
  readonly isStale: boolean;
  /** Null when this data has never been fetched. */
  readonly fetchedAt: Date | null;
};

/*
 * How old a cached answer is. Screens render this; they do not compute it, and
 * they do not decide the threshold — it comes from the served app config.
 */
export function dataAge(dataUpdatedAt: number, now: number = Date.now()): DataAge {
  if (dataUpdatedAt === 0) {
    return { ageMs: 0, isStale: false, fetchedAt: null };
  }
  const ageMs = now - dataUpdatedAt;
  return {
    ageMs,
    isStale: ageMs > currentAppConfig().staleAfterMs,
    fetchedAt: new Date(dataUpdatedAt),
  };
}
