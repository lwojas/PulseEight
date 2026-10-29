// Per-track last step: a track wraps at its own last step (absolute across the bars) against the shared pattern clock.
import { beforeEach, describe, expect, it } from "vitest";
import { defaultArp } from "../src/engine/arp";
import { setLastStep, setLength } from "../src/engine/actions";
import type { GraphIds } from "../src/engine/audio";
import { baseLayout, positionAt, steadySequence, type NativeCtx, type Song } from "../src/engine/nativeseq";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import { NUM_TRACKS } from "../src/engine/spec";
import { initialState, newPattern, runSteps, trackLast, trackStepAt, type Pattern } from "../src/engine/state";
import { getState, replaceState } from "../src/engine/store";

const ids: GraphIds = {
  trackBus: [1, 2, 3, 4, 5, 6, 7, 8], busB: [11, 12, 13, 14, 15, 16, 17, 18], busC: [21, 22, 23, 24, 25, 26, 27, 28],
  delayBus: [31, 32, 33, 34, 35, 36, 37, 38], reverbBus: [41, 42, 43, 44, 45, 46, 47, 48],
  delayFx: Array.from({ length: 8 }, (_, i) => ({ dub: 100 + i, free: 200 + i })), reverbFx: [300, 301, 302, 303, 304, 305, 306, 307],
  inst: [51, 52, 53, 54, 55, 56, 57, 58], manglerBus: 60,
  fx: { filter: 1, sat: 2, crush: 3, phaser: 4, flange: 5, dub: 6, verb: 7 },
};
const ctx: NativeCtx = { ids, clamp: (_p, v) => v };
const song = (p: Pattern | Pattern[]): Song => ({
  patterns: Array.isArray(p) ? p : [p], mutes: new Array(NUM_TRACKS).fill(false), solos: new Array(NUM_TRACKS).fill(false), swing: 0.5,
  arp: Array.from({ length: NUM_TRACKS }, defaultArp), fxPlay: true, lanes: true,
});
/** The steps (0-based) a track sounds in one cycle of the pattern. */
const played = (p: Pattern, track: number): number[] =>
  (steadySequence(song(p), baseLayout({ chainOn: false, chain: [], pattern: 0 }), ctx)?.events ?? [])
    .filter((e) => e.kind === "instrument" && e.instrument === ids.inst[track])
    .map((e) => Math.round(e.beat * 4));
const allOn = (p: Pattern, track: number) => p.tracks[track].steps.forEach((s) => (s.on = true));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => replaceState(initialState()));

const layoutOf = (...patterns: number[]) => ({ patterns, origin: 0 });
const seqOf = (ps: Pattern[], layout = layoutOf(0)) => steadySequence(song(ps), layout, ctx)!;
/** What the polymeter should sound: every pattern step `g` of the cycle plays the track's step `g mod last`. */
const expected = (p: Pattern, track: number, cycle: number): number[] => {
  const last = trackLast(p, track);
  return range(cycle).filter((g) => p.tracks[track].steps[g % last].on);
};

describe("last step: playback (polymeter)", () => {
  it("defaults to the pattern length and plays as before", () => {
    const p = newPattern();
    p.length = 32;
    expect(trackLast(p, 0)).toBe(32);
    allOn(p, 0);
    expect(runSteps(p)).toBe(32);
    expect(seqOf([p]).lengthBeats).toBe(8);
    expect(played(p, 0)).toEqual(range(32));
  });

  it.each([1, 2, 4, 7, 13])("last step %i loops on its own period, across the pattern repeats", (last) => {
    const p = newPattern();
    p.tracks[0].last = last;
    [0, 2, 3, 5].forEach((i) => (p.tracks[0].steps[i % last].on = true));
    const cycle = runSteps(p); // lcm(16, last) steps: the track and the pattern come round together
    expect(cycle).toBe((16 * last) / gcd(16, last));
    expect(seqOf([p]).lengthBeats).toBe(cycle / 4);
    expect(played(p, 0)).toEqual(expected(p, 0, cycle));
    // a single hit on step 1 repeats exactly every `last` steps, straight through the pattern boundary
    const q = newPattern();
    q.tracks[0].last = last;
    q.tracks[0].steps[0].on = true;
    expect(played(q, 0)).toEqual(range(cycle).filter((g) => g % last === 0));
  });

  it.each([17, 18, 23, 27, 32])("cross-bar: last step %i is absolute across two bars", (last) => {
    const p = newPattern();
    p.length = 32;
    p.tracks[0].last = last;
    allOn(p, 0);
    p.tracks[0].steps[0].on = true;
    p.tracks[0].steps.forEach((s, i) => (s.on = i % 3 === 0 || i === last - 1));
    const cycle = runSteps(p);
    expect(cycle).toBe(last >= 32 ? 32 : (32 * last) / gcd(32, last));
    expect(played(p, 0)).toEqual(expected(p, 0, cycle));
    // steps past the last step never sound (unless they are reached as an earlier step on a later lap)
    if (last < 32) expect(trackStepAt(p, 0, 31, 31)).toBeLessThan(last);
  });

  it("tracks loop independently against one clock: Kick 16, Snare 13, Bass 7", () => {
    const p = newPattern();
    p.tracks[0].last = 16;
    p.tracks[1].last = 13;
    p.tracks[2].last = 7;
    for (const t of [0, 1, 2]) p.tracks[t].steps[0].on = true;
    const cycle = runSteps(p);
    expect(cycle).toBe(16 * 13 * 7);
    expect(played(p, 0)).toEqual(range(cycle).filter((g) => g % 16 === 0));
    expect(played(p, 1)).toEqual(range(cycle).filter((g) => g % 13 === 0));
    expect(played(p, 2)).toEqual(range(cycle).filter((g) => g % 7 === 0));
  });

  it("an unlucky mix is cut at the cap, a whole number of passes, and still loops cleanly", () => {
    const p = newPattern();
    p.length = 64;
    [13, 11, 7].forEach((l, i) => ((p.tracks[i].last = l), (p.tracks[i].steps[0].on = true)));
    expect(runSteps(p)).toBe(4096);
    expect(runSteps(p) % p.length).toBe(0);
    expect(played(p, 0)).toEqual(range(4096).filter((g) => g % 13 === 0));
  });

  it("locks follow the track's own loop", () => {
    const p = newPattern();
    p.tracks[1].last = 5;
    p.tracks[1].steps[0].parameterLocks = { "instrument.tune": 0.9 };
    const writes = (seq: { events: Array<{ kind: string; beat: number }> }) => seq.events.filter((e) => e.kind === "param").map((e) => Math.round(e.beat * 4));
    const at = writes(seqOf([p]));
    // the lock lands on every first step of the track's loop (every 5th step of the 80-step cycle)
    expect(new Set(at.filter((g) => g % 5 === 0)).size).toBeGreaterThan(10);
  });

  it("a chain starts each pattern's run afresh; one pattern repeated carries on", () => {
    const a = newPattern();
    a.tracks[0].last = 13;
    a.tracks[0].steps[0].on = true;
    const b = newPattern();
    // [A, B]: A plays once per chain loop, so its track restarts with it: steps 1 and 14 (index 0, 13)
    const chain = steadySequence(song([a, b]), layoutOf(0, 1), ctx)!;
    expect(chain.lengthBeats).toBe(8);
    expect(chain.events.filter((e) => e.kind === "instrument").map((e) => Math.round(e.beat * 4))).toEqual([0, 13]);
    // [A, A]: one run, unrolled to a whole number of chain loops and of polymeter cycles
    const twice = steadySequence(song([a]), layoutOf(0, 0), ctx)!;
    expect(twice.lengthBeats).toBe((2 * 16 * 13) / 4); // a whole number of chain loops, and of polymeter cycles
  });

  it("positionAt reports the run, so the playhead and host notes follow each track's own loop", () => {
    const p = newPattern();
    p.tracks[0].last = 13;
    const ps = [p];
    const l = layoutOf(0);
    expect(positionAt(ps, l, 5)).toMatchObject({ step: 4, run: 20 }); // beat 5 = step 20 = pass 1, step 4
    expect(trackStepAt(p, 0, 4, 20)).toBe(7); // 20 mod 13
    expect(positionAt(ps, l, (16 * 13) / 4)).toMatchObject({ step: 0, run: 0 }); // the cycle repeats
    expect(trackStepAt(p, 1, 4, 20)).toBe(4); // a track with no last step is just the pattern step
  });

  it("steps past the last step keep their data and play again when it is raised", () => {
    const p = newPattern();
    p.tracks[0].steps[10].on = true;
    p.tracks[0].last = 8;
    expect(played(p, 0)).toEqual([]);
    expect(p.tracks[0].steps[10].on).toBe(true);
    delete p.tracks[0].last;
    expect(played(p, 0)).toEqual([10]);
  });
});

describe("last step: state", () => {
  const tracks = () => getState().patterns[getState().pattern].tracks;

  it("is per track, clamped to 1..length, and the full length is 'none'", () => {
    setLength(32);
    setLastStep(1, 27);
    expect(tracks()[1].last).toBe(27);
    expect(tracks()[0].last).toBeUndefined();
    setLastStep(1, 0);
    expect(tracks()[1].last).toBe(1);
    setLastStep(1, 99);
    expect(tracks()[1].last).toBeUndefined();
  });

  it("changing the pattern length resets every track's last step to the new length", () => {
    setLength(32);
    setLastStep(0, 13);
    setLastStep(3, 27);
    setLength(48);
    expect(tracks().every((t) => t.last === undefined)).toBe(true);
    expect(tracks().every((_, i) => trackLast(getState().patterns[getState().pattern], i) === 48)).toBe(true);
    setLastStep(0, 40);
    setLength(16);
    expect(trackLast(getState().patterns[getState().pattern], 0)).toBe(16);
  });

  it("an out-of-range last step in a save is clamped", () => {
    const p = newPattern();
    p.tracks[0].last = 40; // longer than the 16-step pattern
    expect(trackLast(p, 0)).toBe(16);
    p.tracks[0].last = -3;
    expect(trackLast(p, 0)).toBe(16);
  });

  it("survives the host snapshot (save / restore)", () => {
    setLength(32);
    setLastStep(2, 27);
    const restored = fromHostSnapshot(toHostSnapshot())!;
    expect(restored.patterns[getState().pattern].tracks[2].last).toBe(27);
    expect(restored.patterns[getState().pattern].tracks[0].last).toBeUndefined();
  });
});
