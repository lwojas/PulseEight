import { describe, expect, it } from "vitest";
import { ARP_RATES, Arpeggiator, arpIndex, arpPool, normalizeArp, type ArpDirection, type ArpSettings } from "../src/engine/arp";
import { baseValues, layeredTarget, manglerTarget, PUNCHES, sweepLevel } from "../src/engine/mangler";
import { BEAT_DIVISIONS, freeDelaySeconds } from "../src/engine/trackfx";
import { KITS, kitSounds, BASS_PRESETS, synthSound } from "../src/engine/presets";
import { defaultSound, normToUnits, TRACKS, unitsToNorm, noteName } from "../src/engine/spec";
import { isInScale, defaultScale, isChromatic, normalizeScale, notesInRange, rootAtOrAbove, rootAtOrBelow, SCALE_PRESETS, SCALES, withPreset, withRoot } from "../src/engine/scale";
import { demoPattern, FX_LANES, newPattern, pickWriteLane, randomizeTrack } from "../src/engine/state";

describe("control mapping", () => {
  it("round-trips every control across its range", () => {
    for (const t of TRACKS) for (const c of t.controls) for (const n of [0, 0.25, 0.5, 1]) {
      const back = unitsToNorm(c, normToUnits(c, n));
      expect(back).toBeCloseTo(c.steps ? Math.round(n * (c.steps.length - 1)) / (c.steps.length - 1) : n, 5);
    }
  });
  it("keeps every default and preset inside its sweet-spot range", () => {
    for (const t of TRACKS) for (const c of t.controls) {
      expect(c.def).toBeGreaterThanOrEqual(c.lo - 1e-9);
      expect(c.def).toBeLessThanOrEqual(c.hi + 1e-9);
    }
    for (const s of defaultSound(TRACKS[0])) expect(s).toBeGreaterThanOrEqual(0);
    for (const k of KITS) for (const s of kitSounds(k).flat()) expect(s).toBeGreaterThanOrEqual(0);
    for (const p of BASS_PRESETS) expect(synthSound(6, p)).toHaveLength(6);
  });
  it("has the 6 + 1 + 1 track layout with at most 5 controls each", () => {
    expect(TRACKS).toHaveLength(8);
    expect(TRACKS.filter((t) => t.role === "drum")).toHaveLength(6);
    for (const t of TRACKS) expect(t.controls.length).toBeLessThanOrEqual(t.role === "bass" ? 6 : 5);
  });
  it("names notes with C1 = MIDI 24", () => {
    expect(noteName(24)).toBe("C1");
    expect(noteName(33)).toBe("A1");
  });
});

describe("punch FX", () => {
  const base = newPattern().mangler;
  it("rests transparent with the dub return open and the reverb out of the path", () => {
    const v = baseValues();
    expect(v.sMix).toBe(0);
    expect(v.cMix).toBe(0);
    expect(v.pMix).toBe(0);
    expect(v.xMix).toBe(0);
    expect(v.rMix).toBe(0);
    expect(v.dMix).toBe(1);
  });
  it("takeover punches cut the dry path and bypass the wet-only returns", () => {
    for (const p of PUNCHES.filter((x) => x.takeover)) {
      const t = manglerTarget(base, p.id);
      expect(t.takeover).toBe(true);
      expect(t.values.dMix).toBe(0);
      expect(t.values.rMix).toBe(0);
    }
    expect(manglerTarget(base, 5).takeover).toBe(false);
    expect(manglerTarget(base, 0).takeover).toBe(false);
  });
  it("offers the new catalogue with one parameter each", () => {
    expect(PUNCHES.map((p) => p.label)).toEqual(["FILTER", "DRIVE", "CRUSH", "PHASE", "DUB", "ROLL", "SWEEP", "FLANGE", "VERB"]);
    expect(new Set(PUNCHES.map((p) => p.id)).size).toBe(PUNCHES.length);
    expect(base.param).toHaveLength(PUNCHES.length + 1);
  });
  it("sweeps in: level 0 is transparent, level 1 is the full effect", () => {
    for (const p of PUNCHES.filter((x) => x.takeover)) {
      const rest = baseValues();
      const zero = manglerTarget(base, p.id, 0).values;
      const full = manglerTarget(base, p.id, 1).values;
      if (p.label !== "SWEEP") {
        // every wet mix and the filter are at rest at level 0
        expect(zero.sMix).toBe(rest.sMix);
        expect(zero.pMix).toBe(rest.pMix);
        expect(zero.xMix).toBe(rest.xMix);
        expect(zero.fCut).toBeCloseTo(rest.fCut, 3);
        expect(zero.cBits).toBe(rest.cBits);
        expect(zero.cDown).toBe(rest.cDown);
      }
      expect(full).not.toEqual(zero);
    }
    expect(manglerTarget(base, 5, 0).boost).toBe(0);
    expect(manglerTarget(base, 5, 1).boost).toBeGreaterThan(0.8);
    expect(manglerTarget(base, 9, 1).values.rMix).toBe(1);
  });
  it("filter sweep goes open to closed, or closed to open, by shape", () => {
    const close = { ...base, param: base.param.map((v, i) => (i === 7 ? 0 : v)) };
    const open = { ...base, param: base.param.map((v, i) => (i === 7 ? 2 / 3 : v)) };
    expect(manglerTarget(close, 7, 0).values.fCut).toBeGreaterThan(manglerTarget(close, 7, 1).values.fCut);
    expect(manglerTarget(open, 7, 0).values.fCut).toBeLessThan(manglerTarget(open, 7, 1).values.fCut);
    expect(manglerTarget(open, 7, 1).values.fCut).toBeCloseTo(20000, 0);
  });
  it("sweep level rises with held time at the project tempo and holds at full", () => {
    const m = { ...base, sweep: 2 }; // 8 steps = 2 beats
    expect(sweepLevel(m, 120, 0)).toBe(0);
    expect(sweepLevel(m, 120, 0.5)).toBeCloseTo(0.5, 5); // 2 beats at 120 bpm = 1 s
    expect(sweepLevel(m, 120, 5)).toBe(1);
    expect(sweepLevel({ ...base, sweep: 0 }, 120, 0)).toBe(1);
  });
  it("new patterns carry three empty FX lanes with a written-level lane each", () => {
    const p = newPattern();
    expect(p.fxLanes).toHaveLength(FX_LANES);
    for (const l of p.fxLanes) {
      expect(l.fxLvl).toHaveLength(l.fx.length);
      expect(l.fx.every((v) => v === 0) && l.fxLvl.every((v) => v === 0)).toBe(true);
    }
  });
  it("writes take the first empty lane; a fourth wipes all three and restarts at the first", () => {
    const p = newPattern();
    for (let i = 0; i < FX_LANES; i++) {
      const lane = pickWriteLane(p);
      expect(lane).toBe(i);
      p.fxLanes[lane].fx[i] = 1;
    }
    expect(pickWriteLane(p)).toBe(0);
    expect(p.fxLanes.every((l) => l.fx.every((v) => v === 0))).toBe(true);
  });
  it("layered punches stack their overrides; one layer equals the single punch", () => {
    const rest = baseValues();
    const filter = manglerTarget(base, 1, 1);
    expect(layeredTarget(base, [{ id: 1, lvl: 1 }])).toEqual(filter);
    expect(layeredTarget(base, [])).toEqual(manglerTarget(base, 0, 0));
    const both = layeredTarget(base, [{ id: 1, lvl: 1 }, { id: 3, lvl: 1 }]);
    expect(both.values.fCut).toBe(filter.values.fCut);
    expect(both.values.cMix).toBe(1);
    expect(both.values.cBits).not.toBe(rest.cBits);
    expect(both.takeover).toBe(true);
  });
});

describe("track sends", () => {
  it("gives every track its own delay and reverb send", () => {
    const p = newPattern();
    for (const t of p.tracks) {
      expect(t.dly.mode).toBe(1);
      expect(t.dly.send).toBeGreaterThanOrEqual(0);
      expect(t.rev.send).toBeGreaterThanOrEqual(0);
    }
    p.tracks[0].dly.send = 0.9;
    expect(p.tracks[1].dly.send).not.toBe(0.9);
  });
  it("maps free time on an exponential taper inside the engine range", () => {
    expect(freeDelaySeconds(0)).toBeCloseTo(0.04, 5);
    expect(freeDelaySeconds(1)).toBeCloseTo(0.9, 5);
    expect(freeDelaySeconds(0.5)).toBeLessThan((0.04 + 0.9) / 2);
  });
  it("offers musical beat divisions including 1/4, 1/8, 1/8T and 1/16", () => {
    const labels = BEAT_DIVISIONS.map((d) => d.label);
    for (const l of ["1/4", "1/8", "1/8T", "1/16"]) expect(labels).toContain(l);
  });
});

describe("patterns", () => {
  it("randomize stays inside the track's note range and pattern length", () => {
    const p = newPattern();
    p.length = 32;
    randomizeTrack(p, 6, () => 0.3);
    for (const s of p.tracks[6].steps) if (s.on) expect(s.note).toBeGreaterThanOrEqual(24);
    for (const s of p.tracks[6].steps.slice(32)) expect(s.on).toBe(false);
  });
  it("demo groove has a kick and bass line", () => {
    const d = demoPattern();
    expect(d.tracks[0].steps.filter((s) => s.on).length).toBe(4);
    expect(d.tracks[6].steps.some((s) => s.slide)).toBe(true);
  });
});

describe("scales", () => {
  it("lists in-scale notes from the root upward", () => {
    const dMinor = { root: 2, scale: "minor", preset: "" };
    expect(notesInRange(dMinor, 38, 50).map((n) => n % 12)).toEqual([2, 4, 5, 7, 9, 10, 0, 2]);
    expect(rootAtOrAbove(dMinor, 36)).toBe(38);
    expect(rootAtOrBelow(dMinor, 49)).toBe(38);
    expect(rootAtOrAbove(dMinor, 38)).toBe(38);
  });
  it("is chromatic by default, with every note", () => {
    expect(isChromatic(defaultScale())).toBe(true);
    expect(notesInRange(defaultScale(), 24, 35)).toHaveLength(12);
  });
  it("applies genre presets and clears the label on a manual change", () => {
    for (const p of SCALE_PRESETS) expect(SCALES.some((s) => s.id === p.scale)).toBe(true);
    const acid = withPreset(defaultScale(), "acid");
    expect(acid).toEqual({ root: 9, scale: "pentatonicMinor", preset: "acid" });
    expect(withRoot(acid, 2).preset).toBe("");
  });
  it("normalises junk from old or hand-edited saves", () => {
    expect(normalizeScale(undefined)).toEqual(defaultScale());
    expect(normalizeScale({ root: 14, scale: "nope", preset: "x" })).toEqual({ root: 2, scale: "chromatic", preset: "" });
  });
});

describe("randomize follows the project scale", () => {
  it("only writes in-scale notes", () => {
    const key = { root: 2, scale: "minor", preset: "" };
    for (const track of [6, 7]) {
      const p = newPattern();
      randomizeTrack(p, track, Math.random, key);
      const on = p.tracks[track].steps.filter((s) => s.on);
      expect(on.length).toBeGreaterThan(0);
      for (const s of on) expect(isInScale(key, s.note)).toBe(true);
    }
  });
});

describe("arpeggiator", () => {
  const cfg = (patch: Partial<ArpSettings> = {}) => normalizeArp({ on: true, ...patch });
  const run = (arp: Arpeggiator, s: ArpSettings, steps: number, from = 0) =>
    Array.from({ length: steps }, (_, i) => arp.advance(s, from + i).map((e) => e.note)).flat();

  it("orders notes by direction across octaves", () => {
    expect(arpPool([64, 60, 67], 2)).toEqual([60, 64, 67, 72, 76, 79]);
    const idx = (dir: ArpDirection, n: number) => Array.from({ length: n }, (_, c) => arpIndex(dir, 3, c));
    expect(idx("up", 6)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(idx("down", 6)).toEqual([2, 1, 0, 2, 1, 0]);
    expect(idx("updown", 8)).toEqual([0, 1, 2, 1, 0, 1, 2, 1]);
    expect(arpIndex("random", 4, 0, () => 0.99)).toBe(3);
  });
  it("plays held notes on the rate and stops when released", () => {
    const a = new Arpeggiator();
    const s = cfg({ rate: 3 }); // 1/16: one note per step
    expect(run(a, s, 2)).toEqual([]);
    a.noteDown(60); a.noteDown(64);
    expect(run(a, s, 4)).toEqual([60, 64, 60, 64]);
    a.noteUp(60); a.noteUp(64);
    // both were heard, so the arp goes quiet straight away
    expect(run(a, s, 2)).toEqual([]);
  });
  it("lets a tap released before it was scheduled sound once", () => {
    const a = new Arpeggiator();
    a.noteDown(60); a.noteUp(60);
    expect(run(a, cfg(), 3)).toEqual([60]);
  });
  it("fits several notes in a step at fast rates and lines slow rates up with the grid", () => {
    const fast = new Arpeggiator();
    fast.noteDown(60);
    const evs = fast.advance(cfg({ rate: 5 }), 0); // 1/32: two per step
    expect(evs.map((e) => e.offset)).toEqual([0, 0.5]);
    const slow = new Arpeggiator();
    slow.noteDown(60);
    const s = cfg({ rate: 0 }); // 1/4: one note every 4 steps
    const pos: number[] = [];
    for (let i = 5; i < 17; i++) if (slow.advance(s, i).length) pos.push(i);
    expect(pos).toEqual([8, 12, 16]);
  });
  it("keeps triplets on a drift-free grid", () => {
    const a = new Arpeggiator();
    a.noteDown(60);
    const s = cfg({ rate: 2 }); // 1/8T: 3 notes per 4 steps
    expect(run(a, s, 12).length).toBe(9);
  });
  it("sanitises settings", () => {
    expect(normalizeArp(undefined)).toEqual(normalizeArp({}));
    const n = normalizeArp({ on: true, rate: 99, dir: "x", octaves: 9, velocity: 5, gate: -1 });
    expect(n).toMatchObject({ on: true, rate: ARP_RATES.length - 1, dir: "up", octaves: 4, velocity: 1 });
    expect(n.gate).toBeGreaterThan(0);
  });
});
