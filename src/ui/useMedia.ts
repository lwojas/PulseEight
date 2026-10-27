import { useSyncExternalStore } from "react";

/** Reactive `matchMedia`, used to pick between the two compositions (wide vs. phone). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export const WIDE = "(min-width: 1100px)";
