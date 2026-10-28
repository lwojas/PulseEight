// Mapping a linear song position (16th-note steps from the start, as MIDI Song Position Pointer counts)
// onto this app's playback: the chain when it is on, otherwise the current pattern looping.
import type { AppState } from "./state";

export interface SongPosition {
  pattern: number;
  chainPos: number;
  step: number;
}

export function locateSong(
  s: Pick<AppState, "patterns" | "chain" | "chainOn" | "pattern">,
  songStep: number,
): SongPosition {
  const pos = Math.max(0, Math.floor(songStep));
  if (s.chainOn && s.chain.length) {
    const lengths = s.chain.map((p) => s.patterns[p].length);
    let rest = pos % lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (rest < lengths[i]) return { pattern: s.chain[i], chainPos: i, step: rest };
      rest -= lengths[i];
    }
  }
  return { pattern: s.pattern, chainPos: 0, step: pos % s.patterns[s.pattern].length };
}
