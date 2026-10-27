import { describe, expect, it } from "vitest";
import { baseValues, manglerTarget, PUNCHES } from "../src/engine/mangler";
import { KITS, kitSounds, BASS_PRESETS, synthSound } from "../src/engine/presets";
import { defaultSound, normToUnits, TRACKS, unitsToNorm, noteName } from "../src/engine/spec";
import { demoPattern, newPattern, randomizeTrack } from "../src/engine/state";

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

describe("mangler", () => {
  const base = newPattern().mangler;
  it("rests transparent with the dub return open", () => {
    const v = baseValues(base);
    expect(v.sMix).toBe(0);
    expect(v.cMix).toBe(0);
    expect(v.pMix).toBe(0);
    expect(v.dMix).toBe(1);
  });
  it("takeover punches cut the dry path and bypass the echo", () => {
    for (const p of PUNCHES.filter((x) => x.takeover)) {
      const t = manglerTarget(base, p.id);
      expect(t.takeover).toBe(true);
      expect(t.values.dMix).toBe(0);
    }
    expect(manglerTarget(base, 5).takeover).toBe(false);
    expect(manglerTarget(base, 0).takeover).toBe(false);
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
