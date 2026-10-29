// Realtime note recording: pure helpers that turn "a key went down at this moment" into a step and a gate.
import { GATES } from "./state";

/** The step a key pressed `frac` of the way through audible step `step` is aimed at: the nearest step boundary, wrapping at `length`. */
export function recordStep(step: number, frac: number, length: number): number {
  const pos = step + Math.max(0, Math.min(1, frac));
  return Math.round(pos) % length;
}

/** The gate (index into `GATES`) whose length is nearest to a key held for `steps` steps. */
export function gateForHeld(steps: number): number {
  let best = 0;
  for (let i = 1; i < GATES.length; i++) if (Math.abs(GATES[i].len - steps) < Math.abs(GATES[best].len - steps)) best = i;
  return best;
}
