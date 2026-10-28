import { useCallback, useSyncExternalStore } from "react";

/** Reactive `matchMedia`, used to pick between the two compositions (wide vs. phone). */
export function useMedia(query: string): boolean {
  // a stable `subscribe`: a new function every render would resubscribe every render
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export const WIDE = "(min-width: 1100px)";
