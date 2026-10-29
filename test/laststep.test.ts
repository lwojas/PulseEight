// Per-track last step: a track loops at its own last step (absolute across the bars) against the shared pattern clock, drifting against the others.
import { beforeEach, describe, expect, it } from "vitest";
import { defaultArp } from "../src/engine/arp";
import { setLastStep, setLength } from "../src/engine/actions";
import type { GraphIds } from "../src/engine/audio";
import type { Sequence } from "webdsp";
import { positionAt, steadySequence, transitionSequence, type NativeCtx, type Song } from "../src/engine/nativeseq";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import { NUM_TRACKS } from "../src/engine/spec";
import { MELODIC, StepCompiler } from "../src/engine/stepcompile";
import { initialState, newPattern, trackLast, trackStepAt, type Pattern } from "../src/engine/state";
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
const allOn = (p: Pattern, track: number) => p.tracks[track].steps.forEach((s) => (s.on = true));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => replaceState(initialState()));

/** What a host does with a sequence: every event of the main cycle and of each loop repeats on its own length against the DAW timeline.
 * Returns the beats (absolute, up to `until`) at which `instrument` sounds. */
const simulate = (seq: Sequence | null, instrument: number, until: number): number[] => {
  if (!seq) return [];
  const cycles = [{ lengthBeats: seq.lengthBeats, events: seq.events }, ...(seq.loops ?? [])];
  const out: number[] = [];
  for (const c of cycles) {
    for (let base = 0; base < until; base += c.lengthBeats) {
      for (const e of c.events) if (e.kind === "instrument" && e.instrument === instrument && base + e.beat < until - 1e-9) out.push(round(base + e.beat));
    }
  }
  return out.sort((a, b) => a - b);
};
const round = (b: number) => Math.round(b * 1e6) / 1e6;
const seqOf = (ps: Pattern | Pattern[], layout = layoutOf(0), over: Partial<Song> = {}) => steadySequence({ ...song(ps), ...over }, layout, ctx);
const layoutOf = (...patterns: number[]) => ({ patterns, origin: 0 });
/** The polymeter, by definition: at pattern step g the track plays its step g mod last. */
const expected = (p: Pattern, track: number, steps: number, swing = 0.5): number[] => {
  const last = trackLast(p, track);
  const off = (swing - 0.5) * 2 * 0.25;
  return range(steps).filter((g) => p.tracks[track].steps[g % last].on).map((g) => round(g * 0.25 + (g % 2 === 1 ? off : 0)));
};
const hits = (p: Pattern, track: number, steps: number, swing = 0.5) => simulate(seqOf(p, layoutOf(0), { swing }), ids.inst[track], steps * 0.25);

describe("last step: playback (polymeter)", () => {
  it("defaults to the pattern length: one cycle, no loops, as before", () => {
    const p = newPattern();
    p.length = 32;
    allOn(p, 0);
    const seq = seqOf(p)!;
    expect(seq.lengthBeats).toBe(8);
    expect(seq.loops).toBeUndefined();
    expect(hits(p, 0, 32)).toEqual(range(32).map((g) => g / 4));
  });

  it.each([1, 2, 4, 7, 13])("last step %i is a loop of its own length, straight through the pattern's repeats", (last) => {
    const p = newPattern();
    p.tracks[0].last = last;
    [0, 2, 3, 5].forEach((i) => (p.tracks[0].steps[i % last].on = true));
    const seq = seqOf(p)!;
    expect(seq.lengthBeats).toBe(4); // the pattern's cycle is untouched
    expect(seq.loops).toHaveLength(1);
    expect(seq.loops![0].lengthBeats).toBe(((last % 2 ? 2 * last : last) * 0.25)); // odd: two laps, so swing stays on the grid
    expect(hits(p, 0, 400)).toEqual(expected(p, 0, 400));
    // a single hit on step 1 repeats exactly every `last` steps, across pattern boundaries
    const q = newPattern();
    q.tracks[0].last = last;
    q.tracks[0].steps[0].on = true;
    expect(hits(q, 0, 400)).toEqual(range(400).filter((g) => g % last === 0).map((g) => g / 4));
  });

  it.each([17, 18, 23, 27, 31])("cross-bar: last step %i is absolute across two bars", (last) => {
    const p = newPattern();
    p.length = 32;
    p.tracks[0].last = last;
    p.tracks[0].steps.forEach((s, i) => (s.on = i % 3 === 0 || i === last - 1 || i === last));
    expect(hits(p, 0, 700)).toEqual(expected(p, 0, 700));
    expect(trackStepAt(p, 0, 31, 31)).toBe(31 % last);
  });

  it("a track as long as the pattern is not a loop", () => {
    const p = newPattern();
    p.length = 32;
    p.tracks[0].last = 32;
    p.tracks[0].steps[0].on = true;
    expect(seqOf(p)!.loops).toBeUndefined();
  });

  it("tracks loop independently against one clock: Kick 16, Snare 13, Bass 7", () => {
    const p = newPattern();
    p.tracks[0].last = 16;
    p.tracks[1].last = 13;
    p.tracks[2].last = 7;
    for (const t of [0, 1, 2]) p.tracks[t].steps[0].on = true;
    const seq = seqOf(p)!;
    expect(seq.loops).toHaveLength(2); // 13 and 7 loop; 16 is the pattern
    expect(seq.loops!.map((l) => l.lengthBeats)).toEqual([6.5, 3.5]);
    for (const [t, l] of [[0, 16], [1, 13], [2, 7]]) expect(hits(p, t, 1500)).toEqual(range(1500).filter((g) => g % l === 0).map((g) => g / 4));
    // the three realign only every 16 x 13 x 7 steps: no cycle that long is ever built
    expect(JSON.stringify(seq).length).toBeLessThan(5000);
  });

  it("swing sits on the grid, not on the track's own step", () => {
    const p = newPattern();
    p.tracks[0].last = 3;
    p.tracks[0].steps.forEach((s, i) => i < 3 && (s.on = true));
    expect(hits(p, 0, 30, 0.6)).toEqual(expected(p, 0, 30, 0.6));
  });

  it("locks follow the track's own loop", () => {
    const p = newPattern();
    p.tracks[1].last = 5;
    p.tracks[1].steps[0].parameterLocks = { "instrument.tune": 0.9 };
    const seq = seqOf(p)!;
    const loop = seq.loops![0];
    expect(loop.events.some((e) => e.kind === "param")).toBe(true);
    expect(seq.events.some((e) => e.kind === "param")).toBe(false);
  });

  it("a chain plays each pattern once per cycle, so its shorter tracks wrap inside it; one pattern repeated loops", () => {
    const a = newPattern();
    a.tracks[0].last = 13;
    a.tracks[0].steps[0].on = true;
    const chain = seqOf([a, newPattern()], layoutOf(0, 1))!;
    expect(chain.loops).toBeUndefined();
    expect(simulate(chain, ids.inst[0], 8)).toEqual([0, 3.25]);
    expect(seqOf([a], layoutOf(0, 0))!.loops).toHaveLength(1);
  });

  it("an origin shifts every loop with the rest of the song", () => {
    const p = newPattern();
    p.tracks[0].last = 7;
    p.tracks[0].steps[0].on = true;
    const seq = seqOf(p, { patterns: [0], origin: 2 })!;
    expect(simulate(seq, ids.inst[0], 6)).toEqual(range(24).filter((g) => (g - 8) % 7 === 0 && g >= 0).map((g) => g / 4).filter((b) => b < 6));
  });

  it("positionAt reports the run, so the playhead and host notes follow each track's own loop", () => {
    const p = newPattern();
    p.tracks[0].last = 13;
    const ps = [p, newPattern()];
    expect(positionAt(ps, layoutOf(0), 5)).toMatchObject({ step: 4, run: 20 }); // beat 5 = step 20 = pass 1, step 4
    expect(trackStepAt(p, 0, 4, 20)).toBe(7);
    expect(trackStepAt(p, 1, 4, 20)).toBe(4); // a track with no last step is just the pattern step
    expect(positionAt(ps, { patterns: [0], origin: 2 }, 3)).toMatchObject({ step: 4, run: 4 });
    expect(positionAt(ps, layoutOf(0, 1), 5)).toMatchObject({ step: 4, run: 4 }); // not repeating: the step
  });

  it("a cue transition is laid out event by event: the old loop stops at the boundary, the new one starts on it", () => {
    const a = newPattern();
    a.tracks[0].last = 3;
    a.tracks[0].steps[0].on = true;
    const b = newPattern();
    b.tracks[0].last = 5;
    b.tracks[0].steps[0].on = true;
    const seq = transitionSequence(song([a, b]), layoutOf(0), { patterns: [1], origin: 8 }, 8, 6, ctx)!;
    expect(seq.loops).toBeUndefined();
    const at = simulate(seq, ids.inst[0], 20).filter((x) => x >= 6 && x < 12);
    // A (3-step loop, 1.5 beats with its second lap: hits every 0.75 beats) up to beat 8, B (5 steps = 1.25 beats) from 8
    expect(at.filter((x) => x < 8)).toEqual([6, 6.75, 7.5]);
    expect(at.filter((x) => x >= 8)).toEqual([8, 9.25, 10.5, 11.75]);
  });

  it.each([[2, 5], [3, 5], [3, 8], [2, 3]])("an arpeggiated track (rate %i) loops with its loop: the host plays what the live scheduler would (last step %i)", (rate, last) => {
    const track = MELODIC[0];
    const p = newPattern();
    p.tracks[track].last = last;
    [0, 2, 3].forEach((i, k) => ((p.tracks[track].steps[i].on = true), (p.tracks[track].steps[i].note = 40 + 3 * k)));
    const arp = Array.from({ length: NUM_TRACKS }, defaultArp);
    arp[track] = { ...defaultArp(), on: true, rate, octaves: 2, dir: "updown" };
    // the live scheduler: the pattern is walked with a run counter that never restarts, one compiler for the whole session
    const live = new StepCompiler();
    const clock = { stepDur: 0.125, swing: 0.5, arp, rnd: () => 0.5 };
    const played: Array<[number, number]> = [];
    for (let g = 0; g < 160; g++) {
      live.step(p, g % p.length, g, g, g * 0.125, clock, (n) => n.track === track && played.push([round(n.params.time * 2), n.params.pitch ?? 0]));
    }
    const host = steadySequence({ ...song(p), arp }, layoutOf(0), ctx)!;
    const cycles = [{ lengthBeats: host.lengthBeats, events: host.events }, ...(host.loops ?? [])];
    const got: Array<[number, number]> = [];
    for (const c of cycles) {
      for (let base = 0; base < 40; base += c.lengthBeats) {
        for (const e of c.events) if (e.kind === "instrument" && e.instrument === ids.inst[track] && base + e.beat < 40 - 1e-9) got.push([round(base + e.beat), e.pitch ?? 0]);
      }
    }
    const order = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
    expect(got.sort(order)).toEqual(played.filter(([b]) => b < 40 - 1e-9).sort(order));
    expect(played.length).toBeGreaterThan(20);
  });

  it("steps past the last step keep their data and play again when it is raised", () => {
    const p = newPattern();
    p.tracks[0].steps[10].on = true;
    p.tracks[0].last = 8;
    expect(hits(p, 0, 64)).toEqual([]);
    expect(p.tracks[0].steps[10].on).toBe(true);
    delete p.tracks[0].last;
    expect(hits(p, 0, 64)).toEqual([2.5, 6.5, 10.5, 14.5].filter((b) => b < 16));
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
