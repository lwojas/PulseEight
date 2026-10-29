// The playhead is the hottest UI loop (one update per step, many cells). It deliberately bypasses
// React and the store: cells register their DOM element once, and each step just flips one
// attribute on the old and new step's elements. Anything else that follows the playhead (the
// step readout, the page progress bar) subscribes here and writes to its own element.
import { NUM_TRACKS } from "./spec";
import { trackStepAt } from "./state";
import { getState, observe } from "./store";

type Listener = (visibleStep: number) => void;

const cells = new Map<number, Set<HTMLElement>>();
// Cells of one track's steps: that track wraps at its own last step, so its lit step can differ from the pattern's.
const trackCells = new Map<number, Set<HTMLElement>>();
const trackKey = (track: number, step: number) => track * 64 + step;
const shownTrack: number[] = new Array(NUM_TRACKS).fill(-1);
const listeners = new Set<Listener>();
let audible = { step: -1, pattern: -1, run: 0 };
let shown = -1;

/** The step to light on screen: only while playing and when the pattern on screen is the playing one. */
function visibleStep(): number {
  const s = getState();
  return s.playing && audible.pattern === s.pattern ? audible.step : -1;
}

function mark(step: number, on: boolean, map = cells) {
  if (step < 0) return;
  const set = map.get(step);
  if (!set) return;
  for (const el of set) {
    if (on) el.setAttribute("data-play", "true");
    else el.removeAttribute("data-play");
  }
}

function refresh() {
  const v = visibleStep();
  const pat = v >= 0 ? getState().patterns[audible.pattern] : null;
  for (let t = 0; t < NUM_TRACKS; t++) {
    const ts = pat ? trackStepAt(pat, t, v, audible.run) : -1;
    if (ts === shownTrack[t]) continue;
    if (shownTrack[t] >= 0) mark(trackKey(t, shownTrack[t]), false, trackCells);
    if (ts >= 0) mark(trackKey(t, ts), true, trackCells);
    shownTrack[t] = ts;
  }
  if (v === shown) return;
  mark(shown, false);
  mark(v, true);
  shown = v;
  for (const l of listeners) l(v);
}

/** Called by the controller when a step becomes audible (-1 to clear). */
export function setAudible(step: number, pattern: number, run: number): void {
  audible = { step, pattern, run };
  refresh();
}

/** Register a step cell's element; returns the unregister function. */
export function registerCell(step: number, el: HTMLElement, track?: number): () => void {
  const map = track === undefined ? cells : trackCells;
  const key = track === undefined ? step : trackKey(track, step);
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(el);
  if (track === undefined ? step === shown : step === shownTrack[track]) el.setAttribute("data-play", "true");
  return () => {
    set!.delete(el);
    el.removeAttribute("data-play");
  };
}

/** Follow the visible step; called once immediately with the current value. */
export function listenPlayhead(fn: Listener): () => void {
  listeners.add(fn);
  fn(shown);
  return () => listeners.delete(fn);
}

// Transport or view-pattern changes (stop, switching the pattern on screen) re-evaluate visibility.
observe(refresh);
