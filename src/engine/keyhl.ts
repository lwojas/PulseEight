// Piano-key highlights. Like the playhead this bypasses React: keys register their DOM element by
// (track, note) and the controller / key presses flip a data attribute on them directly.
import { getState } from "./store";

const keys = new Map<string, Set<HTMLElement>>();
const lit = new Map<number, number[]>(); // track -> notes lit by the sequencer
const flashes = new Map<string, number>();

const id = (track: number, note: number) => `${track}:${note}`;

function set(track: number, note: number, on: boolean) {
  for (const el of keys.get(id(track, note)) ?? []) {
    if (on) el.setAttribute("data-hl", "true");
    else el.removeAttribute("data-hl");
  }
}

/** Register a key's element; returns the unregister function. */
export function registerKey(track: number, note: number, el: HTMLElement): () => void {
  const k = id(track, note);
  let s = keys.get(k);
  if (!s) keys.set(k, (s = new Set()));
  s.add(el);
  if (getState().keyHighlight && (lit.get(track)?.includes(note) || flashes.has(k))) el.setAttribute("data-hl", "true");
  return () => {
    s!.delete(el);
    el.removeAttribute("data-hl");
  };
}

/** The sequencer is sounding exactly these notes on `track` (empty to clear). */
export function setLit(track: number, notes: number[]): void {
  const prev = lit.get(track) ?? [];
  for (const n of prev) if (!notes.includes(n) && !flashes.has(id(track, n))) set(track, n, false);
  lit.set(track, notes);
  if (getState().keyHighlight) for (const n of notes) set(track, n, true);
}

export function clearLit(): void {
  for (const t of [...lit.keys()]) setLit(t, []);
}

/** Light a key briefly for a manual press. */
export function flashKey(track: number, note: number, ms = 180): void {
  if (!getState().keyHighlight) return;
  const k = id(track, note);
  window.clearTimeout(flashes.get(k));
  set(track, note, true);
  flashes.set(k, window.setTimeout(() => {
    flashes.delete(k);
    if (!lit.get(track)?.includes(note)) set(track, note, false);
  }, ms));
}

/** Setting switched: relight or clear everything. */
export function refreshKeys(): void {
  const on = getState().keyHighlight;
  for (const [t, notes] of lit) for (const n of notes) set(t, n, on);
  if (!on) for (const els of keys.values()) for (const el of els) el.removeAttribute("data-hl");
}
