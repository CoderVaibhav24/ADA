import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/*
 * The handset's last known position, for "how far is this case" and nothing
 * more. It never prompts: the permission request belongs to a priming screen
 * (ui-rules.md §6), and a detail screen that pops an OS dialog is the nag that
 * rule forbids. If permission has not been granted already, the answer is null
 * and the distance is simply not shown.
 *
 * A last-known fix is stale by nature, and callers label it as such.
 */
export type LastKnownPosition = {
  readonly latitude: number;
  readonly longitude: number;
  /** Epoch milliseconds of the fix. */
  readonly timestamp: number;
};

export function useLastKnownPosition(enabled: boolean): LastKnownPosition | null {
  const [position, setPosition] = useState<LastKnownPosition | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const fix = await Location.getLastKnownPositionAsync();
        if (!active || fix === null) return;
        setPosition({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          timestamp: fix.timestamp,
        });
      } catch {
        // No position is an answer: the distance is left out, not guessed.
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return position;
}

const EARTH_RADIUS_M = 6_371_000;

// Great-circle distance in metres. Straight line, not a route — callers say "approx.".
export function haversineMeters(
  from: { readonly latitude: number; readonly longitude: number },
  to: { readonly latitude: number; readonly longitude: number },
): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLon = rad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
