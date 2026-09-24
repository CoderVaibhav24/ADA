import { useEffect, useEffectEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { locate, parcel, type Located, type ParcelLookup } from "@/api/icms/geo";
import { LOCATE_DEBOUNCE_MS, pinPoint, suggestionFrom, type LocationSuggestion } from "./locationSuggestion";

/** Query key prefix of the parcel lookup; a boundary import invalidates it. */
export const PARCEL_QUERY_KEY = ["icms", "geo-parcel"] as const;

/** Looks the pin up after it settles, in the locator and the land record; a failure is silent. */
export function useLocationSuggestion(
  latitude: string,
  longitude: string,
  enabled: boolean,
  onSuggestion: (suggestion: LocationSuggestion) => void,
  onParcel: (answer: ParcelLookup) => void,
): void {
  const client = useQueryClient();
  const deliver = useEffectEvent(onSuggestion);
  const deliverParcel = useEffectEvent(onParcel);
  const point = enabled ? pinPoint(latitude, longitude) : null;
  const lat = point?.lat ?? null;
  const lon = point?.lon ?? null;

  useEffect(() => {
    if (lat === null || lon === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      client
        .fetchQuery({
          queryKey: ["icms", "geo-locate", lat, lon],
          queryFn: ({ signal }) => locate(lat, lon, signal),
          // A failed lookup is retried on the next pin rather than remembered.
          staleTime: (query) =>
            (query.state.data as Located | undefined)?.source === "unavailable" ? 0 : Infinity,
          retry: false,
        })
        .then((located) => {
          const suggestion = suggestionFrom(located);
          if (!controller.signal.aborted && suggestion !== null) deliver(suggestion);
        })
        .catch(() => undefined);
      client
        .fetchQuery({
          queryKey: [...PARCEL_QUERY_KEY, lat, lon],
          queryFn: ({ signal }) => parcel(lat, lon, signal),
          staleTime: Infinity,
          retry: false,
        })
        .then((answer) => {
          if (!controller.signal.aborted) deliverParcel(answer);
        })
        .catch(() => undefined);
    }, LOCATE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, lat, lon]);
}
