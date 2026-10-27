// A tiny external store: one immutable AppState, selector subscriptions via useSyncExternalStore.
// Selectors should return primitives or stable references so only the components that care re-render.
import { useSyncExternalStore } from "react";
import { initialState, withPattern, type AppState, type Pattern } from "./state";

let state: AppState = initialState();
const listeners = new Set<() => void>();
const observers = new Set<(next: AppState, prev: AppState) => void>();

export const getState = (): AppState => state;

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const prev = state;
  const p = typeof patch === "function" ? patch(prev) : patch;
  state = { ...prev, ...p };
  for (const o of observers) o(state, prev);
  for (const l of listeners) l();
}

/** Non-React subscription that also sees the previous state (used by the audio layer). */
export function observe(fn: (next: AppState, prev: AppState) => void): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/** Edit pattern `index` (default: the one on screen). */
export function editPattern(edit: (p: Pattern) => void, index: number = state.pattern): void {
  setState((s) => {
    const patterns = s.patterns.slice();
    patterns[index] = withPattern(s.patterns[index], edit);
    return { patterns };
  });
}

export function replaceState(next: AppState): void {
  setState(next);
}
