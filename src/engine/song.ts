// Mapping a linear song position (16th-note steps from the start, as MIDI Song Position Pointer counts)
// onto this app's playback: the chain when it is on, otherwise the current pattern looping.
import { MAX_CHAIN, MAX_LABEL, MAX_PASSES, MAX_REPEATS, NUM_PATTERNS, type AppState, type ChainEntry } from "./state";

export interface SongPosition {
  pattern: number;
  chainPos: number;
  step: number;
  /** Steps into the run of this pattern (see `trackStepAt`). */
  run: number;
}

/** The patterns a chain plays, one per pass: every entry as many times as it repeats. The scheduler and the host's layout both walk this list. */
export const chainPasses = (chain: readonly ChainEntry[]): number[] => chain.flatMap((e) => new Array<number>(e.repeats).fill(e.pattern));

/** The total passes of a chain. */
export const passCount = (chain: readonly ChainEntry[]): number => chain.reduce((n, e) => n + e.repeats, 0);

/** The entry a pass belongs to and which repeat of it that is (0-based), or null past the end. */
export function passAt(chain: readonly ChainEntry[], pass: number): { entry: number; rep: number } | null {
  let rest = pass;
  for (let i = 0; i < chain.length; i++) {
    if (rest < chain[i].repeats) return { entry: i, rep: rest };
    rest -= chain[i].repeats;
  }
  return null;
}

/** The first pass of an entry. */
export const firstPass = (chain: readonly ChainEntry[], entry: number): number => passCount(chain.slice(0, entry));

/**
 * A chain as loaded: entries as they are saved, or a project from before repeats, which held one pattern index per pass. Those collapse
 * consecutive duplicates into one entry with repeats (they carried no other state, so `A A A B` is `A ×3, B`). Anything unusable is dropped,
 * and the entries are kept within `MAX_CHAIN` and `MAX_PASSES`.
 */
export function normalizeChain(raw: unknown): ChainEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChainEntry[] = [];
  let passes = 0;
  let legacy = false;
  for (const item of raw) {
    if (out.length >= MAX_CHAIN || passes >= MAX_PASSES) break;
    const old = typeof item === "number";
    const pattern = old ? item : (item as ChainEntry | null)?.pattern;
    if (!Number.isInteger(pattern) || (pattern as number) < 0 || (pattern as number) >= NUM_PATTERNS) continue;
    const last = out[out.length - 1];
    if (old && legacy && last && last.pattern === pattern) {
      if (last.repeats < MAX_REPEATS) {
        last.repeats++;
        passes++;
        continue;
      }
    }
    const wanted = old ? 1 : (item as ChainEntry).repeats;
    const repeats = Math.min(Number.isFinite(wanted) ? Math.max(1, Math.round(wanted)) : 1, MAX_REPEATS, MAX_PASSES - passes);
    const label = old || typeof (item as ChainEntry).label !== "string" ? "" : (item as ChainEntry).label!.trim().slice(0, MAX_LABEL);
    out.push({ pattern: pattern as number, repeats, ...(label ? { label } : {}) });
    passes += repeats;
    legacy = old;
  }
  return out;
}

// ---- editing: each returns a new chain (the same one when the edit does not fit) ------------------

const replaceAt = (chain: readonly ChainEntry[], i: number, entry: ChainEntry): ChainEntry[] => chain.map((e, k) => (k === i ? entry : e));

/** A new entry at the end, playing once, if there is room for it. */
export function chainAdd(chain: readonly ChainEntry[], pattern: number): readonly ChainEntry[] {
  return chain.length >= MAX_CHAIN || passCount(chain) >= MAX_PASSES ? chain : [...chain, { pattern, repeats: 1 }];
}

/** Entry `i` repeating `repeats` times, held within 1..`MAX_REPEATS` and what is left of `MAX_PASSES`. */
export function chainRepeats(chain: readonly ChainEntry[], i: number, repeats: number): readonly ChainEntry[] {
  if (!chain[i]) return chain;
  const room = MAX_PASSES - (passCount(chain) - chain[i].repeats);
  const n = Math.max(1, Math.min(Math.round(repeats), MAX_REPEATS, room));
  return n === chain[i].repeats ? chain : replaceAt(chain, i, { ...chain[i], repeats: n });
}

export function chainPattern(chain: readonly ChainEntry[], i: number, pattern: number): readonly ChainEntry[] {
  return !chain[i] || chain[i].pattern === pattern ? chain : replaceAt(chain, i, { ...chain[i], pattern });
}

/** Entry `i` with a label (an empty one takes the label off). */
export function chainLabel(chain: readonly ChainEntry[], i: number, text: string): readonly ChainEntry[] {
  if (!chain[i]) return chain;
  const { label: _old, ...rest } = chain[i];
  const label = text.slice(0, MAX_LABEL);
  return replaceAt(chain, i, label.trim() ? { ...rest, label } : rest);
}

export const chainRemove = (chain: readonly ChainEntry[], i: number): readonly ChainEntry[] => chain.filter((_, k) => k !== i);

/** Entry `i` swapped with its neighbour (`dir` -1 earlier, +1 later). */
export function chainMove(chain: readonly ChainEntry[], i: number, dir: -1 | 1): readonly ChainEntry[] {
  const j = i + dir;
  if (!chain[i] || !chain[j]) return chain;
  const out = chain.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Whether a chain is one pattern over and over, which is just that pattern looping: its run never restarts. */
export const isOnePattern = (chain: readonly number[]): boolean => chain.length > 0 && chain.every((p) => p === chain[0]);

/**
 * For each chain entry, the steps between the start of its run and its own start. A run starts when the pattern changes (and when the chain
 * wraps round, unless it is one pattern: `isOnePattern`) and carries on through repeats of the same pattern, so tracks shorter than their
 * pattern keep their own loop across them.
 */
export function runStarts(chain: readonly number[], lengthOf: (pattern: number) => number): number[] {
  const out: number[] = [];
  let run = 0;
  chain.forEach((p, i) => {
    if (i === 0 || p !== chain[i - 1]) run = 0;
    out.push(run);
    run += lengthOf(p);
  });
  return out;
}

export function locateSong(
  s: Pick<AppState, "patterns" | "chain" | "chainOn" | "pattern">,
  songStep: number,
): SongPosition {
  const pos = Math.max(0, Math.floor(songStep));
  if (s.chainOn && s.chain.length) {
    const passes = chainPasses(s.chain);
    const lengths = passes.map((p) => s.patterns[p].length);
    const starts = runStarts(passes, (p) => s.patterns[p].length);
    const one = isOnePattern(passes);
    let rest = pos % lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (rest < lengths[i]) return { pattern: passes[i], chainPos: i, step: rest, run: one ? pos : starts[i] + rest };
      rest -= lengths[i];
    }
  }
  return { pattern: s.pattern, chainPos: 0, step: pos % s.patterns[s.pattern].length, run: pos };
}
