import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as React state.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the first paint
 * must already know which layout it is in, or the register renders its desktop
 * column set at 360px and reflows a frame later.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      if (!list) return () => undefined;
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    // Server/prerender has no viewport; assume the wide layout so a crawler and
    // a print render both get the full register.
    () => false,
  );
}

/** Tailwind's `md` breakpoint. Below it the registers drop to their priority columns. */
export const NARROW_QUERY = "(max-width: 767px)";

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}
