import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

/*
 * Live position for the check-in and the camera.
 *
 * Always a watched, live fix — never `getLastKnownPositionAsync` — because a
 * cached position presented as current is the one thing ui-rules.md §3 forbids.
 * The age of every fix is judged, so a watch that has gone quiet cannot stamp a
 * capture with where the surveyor stood five minutes ago.
 */
export type LiveFix = {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres, the platform's own estimate. Null when the platform gave none. */
  readonly accuracyM: number | null;
  /** When the platform took the fix, epoch milliseconds. */
  readonly timestamp: number;
  /** True when the OS reports the position as coming from a mock-location provider. */
  readonly mocked: boolean;
  /** True when the user granted approximate location only; the fix is then ~km, never usable. */
  readonly approximate: boolean;
};

export type PermissionStatus = 'checking' | 'undetermined' | 'granted' | 'denied';

export type PermissionState = {
  readonly status: PermissionStatus;
  /** False once the OS will no longer show its dialog; the only route is Settings. */
  readonly canAskAgain: boolean;
  /**
   * False when granted but approximate only (Android 12+ "Approximate", iOS 14+ Precise
   * Location off). Null until granted.
   */
  readonly precise: boolean | null;
  readonly request: () => Promise<void>;
  readonly openSettings: () => void;
};

/*
 * Whether a granted location permission is approximate only: `android.accuracy` is
 * 'coarse' (Android 12+ user chose "Approximate") or `ios.accuracy` is 'reduced'
 * (iOS 14+ Precise Location off). Every fix is then kilometre-scale.
 */
export function isApproximateOnly(response: Location.LocationPermissionResponse): boolean {
  return response.android?.accuracy === 'coarse' || response.ios?.accuracy === 'reduced';
}

// Where the surveyor turns precise location back on, in this platform's words.
export function preciseLocationHowTo(): string {
  return Platform.OS === 'ios'
    ? 'Open Settings, then ADA ICMS, then Location, and turn on Precise Location.'
    : 'Open Settings, then Apps, ADA ICMS, Permissions, Location, and turn on "Use precise location".';
}

// Maps an expo permission response onto the four states the primer renders.
function toStatus(response: Location.LocationPermissionResponse): PermissionStatus {
  if (response.granted) return 'granted';
  return response.status === Location.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

/*
 * Foreground location permission, read without prompting. The OS dialog is shown
 * only when `request` is called, which the primer does after explaining why.
 * Re-read when the app returns from Settings.
 */
export function useLocationPermission(): PermissionState {
  const [status, setStatus] = useState<PermissionStatus>('checking');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [precise, setPrecise] = useState<boolean | null>(null);

  const apply = useCallback((response: Location.LocationPermissionResponse) => {
    setStatus(toStatus(response));
    setCanAskAgain(response.canAskAgain);
    setPrecise(response.granted ? !isApproximateOnly(response) : null);
  }, []);

  useEffect(() => {
    let active = true;
    const read = () =>
      Location.getForegroundPermissionsAsync().then((response) => {
        if (active) apply(response);
      });
    void read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [apply]);

  const request = useCallback(async () => {
    apply(await Location.requestForegroundPermissionsAsync());
  }, [apply]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return { status, canAskAgain, precise, request, openSettings };
}

export type LiveFixState = {
  readonly fix: LiveFix | null;
  /** False when location services are switched off at the OS level. Null while unknown. */
  readonly servicesEnabled: boolean | null;
  readonly error: string | null;
  /** True when the permission is approximate only, so no fix can pass the accuracy gate. */
  readonly approximate: boolean;
};

type WatchState = Omit<LiveFixState, 'approximate'>;

/*
 * Whether the current grant is approximate only, re-read on return from Settings.
 * Null until read; an unreadable answer counts as precise, leaving the accuracy gate to judge.
 */
function useApproximateGrant(enabled: boolean): boolean | null {
  const [approximate, setApproximate] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const read = () =>
      Location.getForegroundPermissionsAsync()
        .then((response) => {
          if (active) setApproximate(response.granted && isApproximateOnly(response));
        })
        .catch(() => {
          if (active) setApproximate(false);
        });
    void read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled]);

  return approximate;
}

// Watches the position at the highest accuracy the handset offers while `enabled`; restarts when precision changes.
export function useLiveFix(enabled: boolean): LiveFixState {
  const approximate = useApproximateGrant(enabled);
  const [state, setState] = useState<WatchState>({ fix: null, servicesEnabled: null, error: null });

  useEffect(() => {
    if (!enabled || approximate === null) return undefined;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    void (async () => {
      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => null);
      if (cancelled) return;
      // A fix from before a precision change must not survive it.
      setState({ fix: null, error: null, servicesEnabled });
      if (servicesEnabled === false) return;
      try {
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1_000, distanceInterval: 0 },
          (location) => {
            setState({
              servicesEnabled: true,
              error: null,
              fix: {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracyM: location.coords.accuracy,
                timestamp: location.timestamp,
                mocked: location.mocked === true,
                approximate,
              },
            });
          },
        );
        if (cancelled) subscription.remove();
      } catch (cause) {
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          error: cause instanceof Error ? cause.message : 'The position could not be read.',
        }));
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, approximate]);

  return { ...state, approximate: approximate === true };
}

export type FixVerdict =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: string };

/*
 * Whether a fix may stamp a check-in or a capture, and if not, what is wrong and
 * what to do about it — stated, so the screen never shows a bare spinner.
 */
export function judgeFix(
  fix: LiveFix | null,
  thresholdM: number,
  maxAgeMs: number,
  now: number,
): FixVerdict {
  if (fix === null) {
    return {
      usable: false,
      reason: 'Waiting for a GPS fix. Stand in the open, away from walls and trees; this usually takes under a minute.',
    };
  }
  if (fix.approximate) {
    return {
      usable: false,
      reason:
        'ICMS has only your approximate location, accurate to about a kilometre, so a site visit cannot be verified. ' +
        preciseLocationHowTo(),
    };
  }
  if (fix.mocked) {
    return {
      usable: false,
      reason:
        'The handset reports this position as simulated. Turn off any mock-location app in developer settings, then try again.',
    };
  }
  if (fix.accuracyM === null || !Number.isFinite(fix.accuracyM)) {
    return {
      usable: false,
      reason: 'The handset has not reported how accurate this position is. Wait a moment for the fix to settle.',
    };
  }
  if (now - fix.timestamp > maxAgeMs) {
    return {
      usable: false,
      reason: `The last fix is ${Math.round((now - fix.timestamp) / 1000)} s old. Stay where you are while GPS updates.`,
    };
  }
  if (fix.accuracyM > thresholdM) {
    return {
      usable: false,
      reason: `Accuracy is ±${Math.round(fix.accuracyM)} m and ±${Math.round(thresholdM)} m or better is needed. Move into open sky and wait for the reading to improve.`,
    };
  }
  return { usable: true };
}
