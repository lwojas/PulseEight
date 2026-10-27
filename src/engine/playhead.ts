// The playhead is the hottest UI loop (one update per step, many cells). It deliberately bypasses
// React and the store: cells register their DOM element once, and each step just flips one
// attribute on the old and new step's elements. Anything else that follows the playhead (the
// step readout, the page progress bar) subscribes here and writes to its own element.
import { getState, observe } from "./store";

type Listener = (visibleStep: number) => void;

const cells = new Map<number, Set<HTMLElement>>();
const listeners = new Set<Listener>();
let audible = { step: -1, pattern: -1 };
let shown = -1;

/** The step to light on screen: only while playing and when the pattern on screen is the playing one. */
function visibleStep(): number {
  const s = getState();
  return s.playing && audible.pattern === s.pattern ? audible.step : -1;
}

function mark(step: number, on: boolean) {
  if (step < 0) return;
  const set = cells.get(step);
  if (!set) return;
  for (const el of set) {
    if (on) el.setAttribute("data-play", "true");
    else el.removeAttribute("data-play");
  }
}

function refresh() {
  const v = visibleStep();
  if (v === shown) return;
  mark(shown, false);
  mark(v, true);
  shown = v;
  for (const l of listeners) l(v);
}

/** Called by the controller when a step becomes audible (-1 to clear). */
export function setAudible(step: number, pattern: number): void {
  audible = { step, pattern };
  refresh();
}

/** Register a step cell's element; returns the unregister function. */
export function registerCell(step: number, el: HTMLElement): () => void {
  let set = cells.get(step);
  if (!set) cells.set(step, (set = new Set()));
  set.add(el);
  if (step === shown) el.setAttribute("data-play", "true");
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
