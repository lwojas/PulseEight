// The chain: entries that play a pattern some number of times, how they load (including projects from before repeats), and how they edit.
import { beforeEach, describe, expect, it } from "vitest";
import { baseLayout, cueLayout } from "../src/engine/nativeseq";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import {
  chainAdd, chainLabel, chainMove, chainPasses, chainPattern, chainRemove, chainRepeats, firstPass, locateSong, normalizeChain, passAt, passCount,
} from "../src/engine/song";
import { initialState, MAX_CHAIN, MAX_LABEL, MAX_PASSES, MAX_REPEATS, newPattern, type ChainEntry } from "../src/engine/state";
import { getState, replaceState, setState } from "../src/engine/store";

const e = (pattern: number, repeats = 1, label?: string): ChainEntry => ({ pattern, repeats, ...(label ? { label } : {}) });

beforeEach(() => replaceState(initialState()));

describe("passes", () => {
  const chain = [e(0, 2), e(3), e(1, 3)];
  it("a chain plays each entry's pattern as many times as it repeats", () => {
    expect(chainPasses(chain)).toEqual([0, 0, 3, 1, 1, 1]);
    expect(passCount(chain)).toBe(6);
    expect(chainPasses([])).toEqual([]);
  });
  it("names the entry and the repeat of a pass", () => {
    expect(passAt(chain, 0)).toEqual({ entry: 0, rep: 0 });
    expect(passAt(chain, 1)).toEqual({ entry: 0, rep: 1 });
    expect(passAt(chain, 2)).toEqual({ entry: 1, rep: 0 });
    expect(passAt(chain, 5)).toEqual({ entry: 2, rep: 2 });
    expect(passAt(chain, 6)).toBeNull();
    expect(firstPass(chain, 2)).toBe(3);
  });
});

describe("loading a chain", () => {
  it("turns a project from before repeats into entries, folding consecutive duplicates", () => {
    expect(normalizeChain([0, 0, 0, 1, 0, 0])).toEqual([e(0, 3), e(1), e(0, 2)]);
    expect(chainPasses(normalizeChain([0, 0, 0, 1, 0, 0]))).toEqual([0, 0, 0, 1, 0, 0]);
  });
  it("drops what is not a pattern and keeps what is", () => {
    expect(normalizeChain([0, 99, -1, 1.5, "x", null, 2])).toEqual([e(0), e(2)]);
    expect(normalizeChain(undefined)).toEqual([]);
    expect(normalizeChain({})).toEqual([]);
  });
  it("keeps entries as saved, with a label trimmed to length and repeats within range", () => {
    expect(normalizeChain([{ pattern: 2, repeats: 4, label: "  Intro  " }])).toEqual([e(2, 4, "Intro")]);
    expect(normalizeChain([{ pattern: 2, repeats: 0 }, { pattern: 2, repeats: 500 }, { pattern: 1 }])).toEqual([e(2, 1), e(2, MAX_REPEATS), e(1)]);
    expect(normalizeChain([{ pattern: 0, repeats: 1, label: "x".repeat(40) }])[0].label).toHaveLength(MAX_LABEL);
    expect(normalizeChain([{ pattern: 0, repeats: 1, label: "   " }])).toEqual([e(0)]);
  });
  it("does not fold saved entries: two entries for one pattern stay two", () => {
    expect(normalizeChain([e(0, 2, "A"), e(0, 2, "B")])).toEqual([e(0, 2, "A"), e(0, 2, "B")]);
  });
  it("stays within the entry and pass limits", () => {
    expect(normalizeChain(Array.from({ length: 200 }, (_, i) => i % 2))).toHaveLength(MAX_CHAIN);
    const big = normalizeChain(Array.from({ length: 10 }, () => e(0, MAX_REPEATS)).concat(Array.from({ length: 10 }, () => e(1, MAX_REPEATS))));
    expect(passCount(big)).toBeLessThanOrEqual(MAX_PASSES);
    expect(normalizeChain(new Array(400).fill(0))).toEqual([e(0, MAX_REPEATS), e(0, MAX_REPEATS), e(0, MAX_PASSES - 2 * MAX_REPEATS)]);
  });
});

describe("the project in a file or a host session", () => {
  it("round-trips entries with labels and repeats", () => {
    const chain = [e(0, 2, "Intro"), e(4, 8)];
    setState({ chain, chainOn: true });
    expect(fromHostSnapshot(toHostSnapshot())!.chain).toEqual(chain);
  });
  it("reads a snapshot whose chain is a list of pattern numbers", () => {
    const snap = toHostSnapshot();
    const data = JSON.parse(snap.data);
    data.project.chain = [1, 1, 2];
    expect(fromHostSnapshot({ ...snap, format: 2, data: JSON.stringify(data) })!.chain).toEqual([e(1, 2), e(2)]);
  });
});

describe("editing", () => {
  const chain = [e(0, 2, "Intro"), e(1), e(2, 4)];
  it("adds an entry playing once, until the chain is full", () => {
    expect(chainAdd(chain, 5)).toEqual([...chain, e(5)]);
    expect(chainAdd(Array.from({ length: MAX_CHAIN }, () => e(0)), 1)).toHaveLength(MAX_CHAIN);
    expect(chainAdd([e(0, MAX_REPEATS), e(0, MAX_REPEATS), e(0, MAX_PASSES - 2 * MAX_REPEATS)], 1)).toHaveLength(3);
  });
  it("sets the repeats within 1..max and what is left of the pass limit", () => {
    expect(chainRepeats(chain, 1, 8)[1].repeats).toBe(8);
    expect(chainRepeats(chain, 1, 0)[1].repeats).toBe(1);
    expect(chainRepeats(chain, 1, 1000)[1].repeats).toBe(MAX_REPEATS);
    const nearly = [e(0, MAX_REPEATS), e(0, MAX_REPEATS), e(0, 50), e(1, 1)];
    expect(chainRepeats(nearly, 3, 99)[3].repeats).toBe(MAX_PASSES - (2 * MAX_REPEATS + 50));
    expect(chainRepeats(chain, 9, 3)).toBe(chain);
  });
  it("changes the pattern and the label of one entry only", () => {
    expect(chainPattern(chain, 1, 7)).toEqual([chain[0], e(7), chain[2]]);
    expect(chainLabel(chain, 1, "Break")[1]).toEqual(e(1, 1, "Break"));
    expect(chainLabel(chain, 0, "")[0]).toEqual(e(0, 2));
    expect(chainLabel(chain, 0, " ")[0]).toEqual(e(0, 2));
  });
  it("removes and moves", () => {
    expect(chainRemove(chain, 1)).toEqual([chain[0], chain[2]]);
    expect(chainMove(chain, 0, 1)).toEqual([chain[1], chain[0], chain[2]]);
    expect(chainMove(chain, 0, -1)).toBe(chain);
    expect(chainMove(chain, 2, 1)).toBe(chain);
  });
  it("the same pattern can sit in two entries with different labels", () => {
    const two = chainAdd(chainLabel(chainAdd([], 2), 0, "Groove"), 2);
    expect(chainLabel(two, 1, "Groove + Build").map((x) => x.label)).toEqual(["Groove", "Groove + Build"]);
  });
});

describe("playing the passes", () => {
  const ps = [newPattern(), newPattern(), newPattern()];
  ps[1].length = 32;
  const chain = [e(0, 2), e(1, 1), e(2, 3)];
  it("the host's base layout holds a pattern once per pass", () => {
    expect(baseLayout({ chainOn: true, chain, pattern: 0 })).toEqual({ patterns: [0, 0, 1, 2, 2, 2], origin: 0 });
    expect(baseLayout({ chainOn: false, chain, pattern: 2 })).toEqual({ patterns: [2], origin: 0 });
  });
  it("a cue goes to the first pass of the first entry with that pattern", () => {
    expect(cueLayout(ps, true, chain, 1, 100)).toEqual({ patterns: [0, 0, 1, 2, 2, 2], origin: 100 - 8 });
  });
  it("a song position lands on the right entry and repeat", () => {
    const s = { ...initialState(), chainOn: true, chain, patterns: ps };
    expect(locateSong(s, 16)).toMatchObject({ pattern: 0, chainPos: 1, step: 0, run: 16 });
    expect(locateSong(s, 32 + 5)).toMatchObject({ pattern: 1, chainPos: 2, step: 5, run: 5 });
    expect(locateSong(s, 32 + 32 + 16 + 2)).toMatchObject({ pattern: 2, chainPos: 4, step: 2, run: 18 });
    expect(locateSong(s, 32 + 32 + 48)).toMatchObject({ pattern: 0, chainPos: 0, step: 0, run: 0 });
  });
});

describe("the store", () => {
  it("starts with no chain and nothing selected", () => {
    expect(getState().chain).toEqual([]);
    expect(getState().chainSel).toBe(-1);
  });
});
