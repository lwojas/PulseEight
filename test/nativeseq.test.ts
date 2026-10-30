// The native sequence compiler (nativeseq.ts): notes through the shared step compile, per-pattern state only where patterns
// differ, written FX lanes, layouts and the cue transition.
import { describe, expect, it } from "vitest";
import type { SequenceEvent } from "webdsp";
import { defaultArp } from "../src/engine/arp";
import type { GraphIds } from "../src/engine/audio";
import {
  baseLayout, cueLayout, cycleBeats, nextBoundary, positionAt, steadySequence, transitionSequence, type NativeCtx, type Song,
} from "../src/engine/nativeseq";
import { normToUnits, NUM_TRACKS, TRACKS } from "../src/engine/spec";
import { newPattern, type Pattern } from "../src/engine/state";

const ids: GraphIds = {
  trackBus: [1, 2, 3, 4, 5, 6, 7, 8], busB: [11, 12, 13, 14, 15, 16, 17, 18], busC: [21, 22, 23, 24, 25, 26, 27, 28],
  delayBus: [31, 32, 33, 34, 35, 36, 37, 38], reverbBus: [41, 42, 43, 44, 45, 46, 47, 48],
  delayFx: Array.from({ length: 8 }, (_, i) => ({ dub: 100 + i, free: 200 + i })), reverbFx: [300, 301, 302, 303, 304, 305, 306, 307], distFx: 350,
  inst: [51, 52, 53, 54, 55, 56, 57, 58], manglerBus: 60,
  fx: { filter: 1, sat: 2, crush: 3, phaser: 4, flange: 5, dub: 6, verb: 7 },
};
const ctx: NativeCtx = { ids, clamp: (_p, v) => v };

const blank = (): Pattern => newPattern();
const song = (patterns: Pattern[], over: Partial<Song> = {}): Song => ({
  patterns, mutes: new Array(NUM_TRACKS).fill(false), solos: new Array(NUM_TRACKS).fill(false), swing: 0.5,
  arp: Array.from({ length: NUM_TRACKS }, defaultArp), fxPlay: true, lanes: true, ...over,
});
const notes = (events: SequenceEvent[]) => events.filter((e) => e.kind === "instrument");
const params = (events: SequenceEvent[]) => events.filter((e) => e.kind === "param");
const BASS = TRACKS.findIndex((t) => t.role === "bass");

describe("notes", () => {
  it("places steps on the beat grid: 16 steps are 4 beats, a step is a quarter beat", () => {
    const p = blank();
    p.tracks[0].steps[0].on = true;
    p.tracks[0].steps[4].on = true;
    p.tracks[1].steps[8].on = true;
    const seq = steadySequence(song([p]), baseLayout({ chainOn: false, chain: [], pattern: 0 }), ctx)!;
    expect(seq.lengthBeats).toBe(4);
    expect(notes(seq.events).map((e) => [e.kind === "instrument" && e.instrument, e.beat])).toEqual([[51, 0], [51, 1], [52, 2]]);
  });

  it("accent is a harder hit and a drum carries its choke group, never a duration", () => {
    const p = blank();
    const hat = TRACKS.findIndex((t) => t.chokeGroup !== undefined);
    expect(hat).toBeGreaterThanOrEqual(0);
    p.tracks[hat].steps[0].on = true;
    p.tracks[hat].steps[2].on = true;
    p.tracks[hat].steps[2].acc = true;
    const [a, b] = notes(steadySequence(song([p]), { patterns: [0], origin: 0 }, ctx)!.events);
    expect(a).toMatchObject({ velocity: 0.7 });
    expect(b).toMatchObject({ velocity: 1 });
    expect(a).not.toHaveProperty("durationBeats");
    expect(a).toHaveProperty("chokeGroup", TRACKS[hat].chokeGroup);
  });

  it("swing delays odd steps by the live scheduler's amount", () => {
    const p = blank();
    p.tracks[0].steps[1].on = true;
    const e = notes(steadySequence(song([p], { swing: 0.75 }), { patterns: [0], origin: 0 }, ctx)!.events)[0];
    expect(e.beat).toBeCloseTo(0.25 + 0.25 * 0.5, 6); // step 1 + half a step
  });

  it("a slid step ties into the held note and the previous note holds into it", () => {
    const p = blank();
    const t = p.tracks[BASS];
    t.steps[0].on = true;
    t.steps[1].on = true;
    t.steps[1].slide = true;
    const [first, second] = notes(steadySequence(song([p]), { patterns: [0], origin: 0 }, ctx)!.events);
    expect(first).not.toHaveProperty("tie");
    expect(second).toHaveProperty("tie", true);
    expect((first as { durationBeats: number }).durationBeats).toBeGreaterThan(0.25); // reaches past the next step
  });

  it("renders the arp from the sequencer's notes, and a RND arp repeats exactly", () => {
    const p = blank();
    p.tracks[BASS].steps[0].on = true;
    p.tracks[BASS].steps[0].gate = 2; // a bar: the arp walks it
    const arp = Array.from({ length: NUM_TRACKS }, defaultArp);
    arp[BASS] = { ...defaultArp(), on: true, dir: "random", octaves: 3, rate: 3 };
    const a = steadySequence(song([p], { arp }), { patterns: [0], origin: 0 }, ctx)!;
    const b = steadySequence(song([p], { arp }), { patterns: [0], origin: 0 }, ctx)!;
    expect(notes(a.events).length).toBeGreaterThan(8);
    expect(a).toEqual(b);
  });

  it("repeats nothing when no note is placed", () => {
    expect(steadySequence(song([blank()]), { patterns: [0], origin: 0 }, ctx)).toBeNull();
  });
});

describe("layouts", () => {
  const a = blank();
  const b = blank();
  b.length = 32;
  it("the base layout is the chain when it is on, else the selected pattern", () => {
    expect(baseLayout({ chainOn: true, chain: [1, 0], pattern: 3 })).toEqual({ patterns: [1, 0], origin: 0 });
    expect(baseLayout({ chainOn: true, chain: [], pattern: 3 })).toEqual({ patterns: [3], origin: 0 });
    expect(baseLayout({ chainOn: false, chain: [1], pattern: 3 })).toEqual({ patterns: [3], origin: 0 });
  });
  it("finds the pattern, step and chain position at a DAW beat", () => {
    const ps = [a, b];
    const layout = { patterns: [0, 1], origin: 0 };
    expect(cycleBeats(ps, layout)).toBe(12);
    expect(positionAt(ps, layout, 0)).toMatchObject({ entry: 0, pattern: 0, step: 0 });
    expect(positionAt(ps, layout, 3.75)).toMatchObject({ entry: 0, step: 15 });
    expect(positionAt(ps, layout, 4)).toMatchObject({ entry: 1, pattern: 1, step: 0 });
    expect(positionAt(ps, layout, 11.5)).toMatchObject({ entry: 1, step: 30 });
    expect(positionAt(ps, layout, 12)).toMatchObject({ entry: 0, step: 0 }); // the cycle repeats
    expect(positionAt(ps, { patterns: [0, 1], origin: 2 }, 2).entry).toBe(0); // origin moves where the song starts
    expect(positionAt(ps, { patterns: [0, 1], origin: 2 }, 1.5)).toMatchObject({ entry: 1, step: 30 });
  });
  it("finds the next pattern boundary, and the layout a cue makes of it", () => {
    const ps = [a, b];
    const layout = { patterns: [0, 1], origin: 0 };
    expect(nextBoundary(ps, layout, 1)).toBe(4);
    expect(nextBoundary(ps, layout, 4)).toBe(4);
    expect(nextBoundary(ps, layout, 4.01)).toBe(12);
    expect(nextBoundary(ps, layout, 13)).toBe(16);
    // chain off: the cued pattern simply starts at the boundary
    expect(cueLayout(ps, false, [], 1, 12)).toEqual({ patterns: [1], origin: 12 });
    // chain on: the chain continues from the cued pattern's place in it
    const cued = cueLayout(ps, true, [0, 1], 1, 12);
    expect(cued).toEqual({ patterns: [0, 1], origin: 8 });
    expect(positionAt(ps, cued, 12)).toMatchObject({ entry: 1, step: 0 });
  });
});

describe("per-pattern state", () => {
  it("writes none for one looping pattern, and only what differs between chained patterns", () => {
    const a = blank();
    const b = blank();
    a.tracks[0].steps[0].on = true;
    b.tracks[0].steps[0].on = true;
    expect(params(steadySequence(song([a, b]), { patterns: [0], origin: 0 }, ctx)!.events)).toEqual([]);
    expect(params(steadySequence(song([a, b]), { patterns: [0, 1], origin: 0 }, ctx)!.events)).toEqual([]); // identical patterns
    b.tracks[2].level = 0.2;
    b.tracks[2].dly.send = 0.5;
    const seq = steadySequence(song([a, b]), { patterns: [0, 1], origin: 0 }, ctx)!;
    const ps = params(seq.events);
    // only track 2's fader and delay send differ; each is written at both patterns' starts (a bar each, so 2 patterns x 1 bar)
    expect(new Set(ps.map((e) => e.kind === "param" && JSON.stringify(e.target)))).toEqual(new Set([JSON.stringify({ bus: 3 })]));
    expect(ps.filter((e) => e.beat === 0)).toHaveLength(2);
    expect(ps.filter((e) => e.beat === 4)).toHaveLength(2);
  });

  it("repeats the state at every bar of a long pattern, so a locate into it is repaired within a bar", () => {
    const a = blank();
    const b = blank();
    b.length = 64;
    a.tracks[0].steps[0].on = true;
    b.tracks[2].level = 0.1;
    const seq = steadySequence(song([a, b]), { patterns: [0, 1], origin: 0 }, ctx)!;
    const faders = params(seq.events).filter((e) => e.kind === "param" && "bus" in e.target && e.target.bus === 3 && e.value < 0.1);
    expect(faders.map((e) => e.beat)).toEqual([4, 8, 12, 16]); // b starts at beat 4 and lasts 16: four bars
  });

  it("bakes the live mutes into the fader writes", () => {
    const a = blank();
    const b = blank();
    a.tracks[0].steps[0].on = true;
    b.tracks[1].level = 0.2;
    const mutes = new Array(NUM_TRACKS).fill(false);
    mutes[1] = true;
    const seq = steadySequence(song([a, b], { mutes }), { patterns: [0, 1], origin: 0 }, ctx)!;
    // track 1 is muted in both patterns: its fader is 0 in both, so it does not vary and nothing is written for it
    expect(params(seq.events).filter((e) => e.kind === "param" && "bus" in e.target && e.target.bus === 2 && e.param === 70)).toEqual([]);
  });
});

describe("written FX lanes", () => {
  const withLane = () => {
    const p = blank();
    p.tracks[0].steps[0].on = true;
    // a filter punch (a takeover) held over steps 4..7, level rising
    for (let s = 4; s < 8; s++) {
      p.fxLanes[0].fx[s] = 1;
      p.fxLanes[0].fxLvl[s] = (s - 3) / 4;
    }
    return p;
  };

  it("ramps the chain across a step, takes the mix over, and puts everything back on the first step without the punch", () => {
    const seq = steadySequence(song([withLane()]), { patterns: [0], origin: 0 }, ctx)!;
    const filterEvents = params(seq.events).filter((e) => e.kind === "param" && "effect" in e.target && e.target.effect.bus === 60);
    expect(filterEvents.length).toBeGreaterThan(0);
    // the section's sends: takeover on bus C for every punched track at step 4 (beat 1), back to rest at step 8 (beat 2)
    const sends = params(seq.events).filter((e) => e.kind === "param" && "bus" in e.target && e.target.bus === 21);
    expect(sends.map((e) => e.beat)).toEqual(expect.arrayContaining([1, 1.25, 1.5, 1.75, 2]));
    expect(sends.filter((e) => e.beat === 2).every((e) => e.kind === "param" && (e.value === 0 || e.value === 1))).toBe(true);
    // no event before the lane starts or after its reset
    expect(Math.min(...params(seq.events).map((e) => e.beat))).toBe(1);
    expect(Math.max(...params(seq.events).map((e) => e.beat))).toBe(2);
    // a rising level ramps across its step
    expect(filterEvents.some((e) => e.kind === "param" && e.rampBeats === 0.25)).toBe(true);
  });

  it("leaves the lanes out while a punch is held, or when FX play is off", () => {
    expect(params(steadySequence(song([withLane()], { lanes: false }), { patterns: [0], origin: 0 }, ctx)!.events)).toEqual([]);
    expect(params(steadySequence(song([withLane()], { fxPlay: false }), { patterns: [0], origin: 0 }, ctx)!.events)).toEqual([]);
  });

  it("a track whose punch send is off is neither fed nor cut", () => {
    const p = withLane();
    p.tracks[0].punch = false;
    const seq = steadySequence(song([p]), { patterns: [0], origin: 0 }, ctx)!;
    expect(params(seq.events).filter((e) => e.kind === "param" && "bus" in e.target && e.target.bus === 21)).toEqual([]);
    expect(params(seq.events).some((e) => e.kind === "param" && "bus" in e.target && e.target.bus === 22)).toBe(true);
  });
});

describe("steady sequences keep their phase", () => {
  it("an origin rotates the cycle so the first pattern starts there", () => {
    const p = blank();
    p.tracks[0].steps[0].on = true; // beat 0 of the pattern
    const seq = steadySequence(song([p]), { patterns: [0], origin: 1 }, ctx)!;
    expect(seq.events.map((e) => e.beat)).toEqual([1]); // pattern start lands on DAW beat 1 (mod 4)
    expect(steadySequence(song([p]), { patterns: [0], origin: 9 }, ctx)!.events.map((e) => e.beat)).toEqual([1]); // 9 mod 4
  });
});

describe("the cue transition", () => {
  const a = blank();
  const b = blank();
  a.tracks[0].steps[0].on = true; // a: kick on its first step
  b.tracks[1].steps[0].on = true; // b: snare on its first step
  b.length = 32;
  /** The instrument hits, as [absolute beat, instrument], when the DAW plays [from, to) through a sequence. */
  const play = (seq: { lengthBeats: number; events: SequenceEvent[] }, from: number, to: number) => {
    const hits: Array<[number, number]> = [];
    for (let n = Math.floor(from / seq.lengthBeats); n * seq.lengthBeats < to; n++) {
      for (const e of seq.events) {
        const abs = n * seq.lengthBeats + e.beat;
        if (abs >= from && abs < to && e.kind === "instrument") hits.push([abs, e.instrument]);
      }
    }
    return hits.sort((x, y) => x[0] - y[0]);
  };

  it("plays the new pattern from the boundary, in phase (b's snare at 8, 16, 24; a's kick is gone)", () => {
    const boundary = 8;
    const to = cueLayout([a, b], false, [], 1, boundary); // b from beat 8, 8 beats long
    const seq = transitionSequence(song([a, b]), { patterns: [0], origin: 0 }, to, boundary, 5.5, ctx)!;
    expect(play(seq, 5.5, 26)).toEqual([[8, 52], [16, 52], [24, 52]]);
  });

  it("holds the old pattern's remaining hits before the boundary", () => {
    const boundary = 8;
    const to = cueLayout([a, b], false, [], 1, boundary);
    const seq = transitionSequence(song([a, b]), { patterns: [0], origin: 0 }, to, boundary, 1.5, ctx)!;
    expect(play(seq, 1.5, 9)).toEqual([[4, 51], [8, 52]]); // a's kick at 4, then b's snare on the boundary (a's kick at 8 is not played)
  });

  it("is a whole number of the new layout's cycles long, so the new pattern stays in phase", () => {
    const to = cueLayout([a, b], false, [], 1, 8);
    const seq = transitionSequence(song([a, b]), { patterns: [0], origin: 0 }, to, 8, 5, ctx)!;
    expect(seq.lengthBeats % cycleBeats([a, b], to)).toBe(0);
  });
});

describe("parameter locks", () => {
  const FILTER = TRACKS[BASS].controls[0];
  const lockOn = (p: Pattern, step: number, locks: Record<string, number>) => { p.tracks[BASS].steps[step].parameterLocks = locks; };
  const seqOf = (p: Pattern[], over: Partial<Song> = {}) => steadySequence(song(p, over), { patterns: p.map((_, i) => i), origin: 0 }, ctx)!;

  it("a pattern with no locks bakes none (a looping pattern carries no state at all)", () => {
    expect(steadySequence(song([blank()]), { patterns: [0], origin: 0 }, ctx)).toBeNull();
  });

  it("writes the lock on its step and the base back on the next, to the instrument or the send bus", () => {
    const p = blank();
    p.tracks[BASS].sound[0] = 0.6;
    lockOn(p, 4, { "instrument.cutoff": 0.2, "fx.delaySend": 0.9 });
    const ev = params(seqOf([p]).events);
    const at = (beat: number) => ev.filter((e) => e.beat === beat);
    expect(at(1)).toHaveLength(2);
    expect(at(1).find((e) => "instrument" in (e as any).target)).toMatchObject({ target: { instrument: ids.inst[BASS] }, param: FILTER.param });
    expect(at(1).find((e) => "bus" in (e as any).target)).toMatchObject({ target: { bus: ids.trackBus[BASS] }, value: 0.9 });
    expect(at(1.25)).toHaveLength(2);
    expect(at(1.25).find((e) => "bus" in (e as any).target)).toMatchObject({ value: p.tracks[BASS].dly.send }); // back to base
    expect(ev).toHaveLength(4);
  });

  it("a lock on the last step is undone on the loop's first step", () => {
    const p = blank();
    lockOn(p, 15, { "fx.reverbSend": 1 });
    const ev = params(seqOf([p]).events);
    expect(ev.map((e) => e.beat).sort()).toEqual([0, 3.75]);
    expect(ev.find((e) => e.beat === 0)).toMatchObject({ target: { bus: ids.busB[BASS] }, value: p.tracks[BASS].rev.send });
  });

  it("follows swing, like the live scheduler", () => {
    const p = blank();
    lockOn(p, 1, { "instrument.cutoff": 0.2 });
    expect(params(seqOf([p], { swing: 0.75 }).events)[0].beat).toBeCloseTo(0.25 + 0.125, 6);
  });

  it("wins over a per-bar state write on the same beat", () => {
    const a = blank();
    const b = blank();
    a.tracks[BASS].sound[0] = 0.3;
    b.tracks[BASS].sound[0] = 0.8; // patterns disagree: each bar start writes the sound
    lockOn(b, 0, { "instrument.cutoff": 0.1 });
    const ev = params(seqOf([a, b]).events).filter((e) => e.beat === 4 && "instrument" in (e as any).target && e.param === FILTER.param);
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeCloseTo(normToUnits(FILTER, 0.1), 6);
  });
});
