import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStepLocks, setPlockMode, setSound, setSoundControl, tapStep } from "../src/engine/actions";
import { Groovebox } from "../src/engine/audio";
import { effectiveSound, effectiveValue, hasLocks, lockParams, sanitizeLocks } from "../src/engine/plock";
import { BASS_TRACK } from "../src/engine/spec";
import { initialState } from "../src/engine/state";
import { getState, replaceState, setState } from "../src/engine/store";

const T = BASS_TRACK;
const CUT = 0; // FILTER
const RES = 3; // RES
const tp = () => getState().patterns[getState().pattern].tracks[T];
const step = (i: number) => tp().steps[i];
const eff = (i: number, c: number) => effectiveValue(tp(), step(i), lockParams(T)[c]);

beforeEach(() => {
  replaceState(initialState());
  setState({ focus: T, selStep: -1 });
});

describe("parameter locks: data", () => {
  it("steps carry no locks by default and fall back to the base", () => {
    expect(step(4).parameterLocks).toBeUndefined();
    setSound(T, CUT, 0.6);
    expect(eff(4, CUT)).toBe(0.6);
    expect(effectiveSound(tp(), T, step(4))).toBe(tp().sound);
  });

  it("locks one step; base edits move unlocked steps and leave locks alone; clearing returns to the base", () => {
    setSound(T, CUT, 0.6);
    setPlockMode(true);
    setState({ selStep: 4 });
    setSoundControl(T, CUT, 0.2);
    expect(eff(4, CUT)).toBe(0.2);
    expect(eff(5, CUT)).toBe(0.6);
    expect(tp().sound[CUT]).toBe(0.6); // the base was not touched

    setPlockMode(false);
    setSoundControl(T, CUT, 0.8); // normal mode: base
    expect(tp().sound[CUT]).toBe(0.8);
    expect(eff(4, CUT)).toBe(0.2);
    expect(eff(5, CUT)).toBe(0.8);

    clearStepLocks(T, 4);
    expect(eff(4, CUT)).toBe(0.8);
    expect(step(4).parameterLocks).toBeUndefined();
  });

  it("keeps several parameters on a step, and several locked steps, independent", () => {
    setPlockMode(true);
    setState({ selStep: 4 });
    setSoundControl(T, CUT, 0.2);
    setSoundControl(T, RES, 0.8);
    setSoundControl(T, CUT, 0.3); // changing cutoff leaves resonance
    expect(step(4).parameterLocks).toEqual({ "instrument.cutoff": 0.3, "instrument.reso": 0.8 });
    setState({ selStep: 8 });
    setSoundControl(T, CUT, 0.9);
    setState({ selStep: 12 });
    setSoundControl(T, CUT, 0.4);
    expect([4, 8, 12].map((i) => eff(i, CUT))).toEqual([0.3, 0.9, 0.4]);
    clearStepLocks(T, 8);
    expect([4, 8, 12].map((i) => eff(i, CUT))).toEqual([0.3, tp().sound[CUT], 0.4]);
    expect(hasLocks(step(4))).toBe(true);
    expect(hasLocks(step(8))).toBe(false);
  });

  it("ignores knob moves in P-LOCK mode when no step is selected (the base is untouched)", () => {
    const before = tp().sound[CUT];
    setPlockMode(true);
    setSoundControl(T, CUT, 0.01);
    expect(tp().sound[CUT]).toBe(before);
    expect(step(0).parameterLocks).toBeUndefined();
  });
});

describe("P-LOCK mode on the sequencer", () => {
  it("selects empty and populated steps without adding or removing any", () => {
    const on0 = step(0).on; // demo bass line has a note on step 0
    expect(step(1).on).toBe(false);
    setPlockMode(true);
    tapStep(T, 1);
    expect(getState().selStep).toBe(1);
    expect(step(1).on).toBe(false);
    tapStep(T, 0);
    tapStep(T, 0);
    expect(step(0).on).toBe(on0);
    // a lock on an empty step creates no note
    tapStep(T, 1);
    setSoundControl(T, CUT, 0.3);
    expect(step(1).on).toBe(false);
    expect(step(1).parameterLocks).toEqual({ "instrument.cutoff": 0.3 });
  });

  it("returns to normal add/remove editing on exit, locks intact", () => {
    setPlockMode(true);
    tapStep(T, 1);
    setSoundControl(T, CUT, 0.3);
    setPlockMode(false);
    expect(step(1).parameterLocks).toEqual({ "instrument.cutoff": 0.3 });
    setState({ selStep: -1 });
    tapStep(T, 1);
    expect(step(1).on).toBe(true);
    tapStep(T, 1);
    expect(step(1).on).toBe(false);
    expect(step(1).parameterLocks).toEqual({ "instrument.cutoff": 0.3 });
  });
});

describe("persistence", () => {
  it("survives a JSON round trip and drops junk", () => {
    setPlockMode(true);
    setState({ selStep: 2 });
    setSoundControl(T, CUT, 0.25);
    const back = JSON.parse(JSON.stringify(step(2)));
    expect(sanitizeLocks(T, back.parameterLocks)).toEqual({ "instrument.cutoff": 0.25 });
    expect(sanitizeLocks(T, { "instrument.nope": 1, "instrument.cutoff": 7, "instrument.reso": "x" })).toEqual({ "instrument.cutoff": 1 });
    expect(sanitizeLocks(T, {})).toBeUndefined();
    expect(sanitizeLocks(T, undefined)).toBeUndefined();
  });
});

describe("playback scheduling", () => {
  function fake() {
    const scheduled: any[][] = [];
    const gb = Object.create(Groovebox.prototype) as any;
    gb.runtime = { scheduleParams: vi.fn((e) => scheduled.push(e)) };
    gb.inst = Array.from({ length: 8 }, (_, i) => 100 + i);
    gb.soundCache = Array.from({ length: 8 }, () => new Array(8).fill(NaN));
    gb.lockedControls = Array.from({ length: 8 }, () => new Set());
    return { gb: gb as Groovebox, scheduled };
  }
  const pat = () => getState().patterns[getState().pattern];

  it("sends nothing for steps with no locks", () => {
    const { gb, scheduled } = fake();
    gb.scheduleLocks(pat(), 0, 1);
    expect(scheduled).toHaveLength(0);
  });

  it("sends the lock on its step, then the base on the next, then nothing", () => {
    setSound(T, CUT, 0.6);
    setPlockMode(true);
    setState({ selStep: 3 });
    setSoundControl(T, CUT, 0.2);
    const { gb, scheduled } = fake();
    gb.scheduleLocks(pat(), 2, 1.0);
    gb.scheduleLocks(pat(), 3, 1.1);
    gb.scheduleLocks(pat(), 4, 1.2);
    gb.scheduleLocks(pat(), 5, 1.3);
    expect(scheduled).toHaveLength(2);
    const [lock] = scheduled[0];
    const [restore] = scheduled[1];
    expect(lock.time).toBe(1.1);
    expect(restore.time).toBe(1.2);
    expect(restore.value).toBeGreaterThan(lock.value); // base 0.6 is a higher cutoff than the locked 0.2
    expect(lock.target).toEqual({ instrument: 100 + T });
  });

  it("restores from the pattern as it is when the next step is scheduled (a base edit in between is honoured)", () => {
    setPlockMode(true);
    setState({ selStep: 3 });
    setSoundControl(T, CUT, 0.2);
    const { gb, scheduled } = fake();
    gb.scheduleLocks(pat(), 3, 1.1);
    setPlockMode(false);
    setSoundControl(T, CUT, 0.9);
    gb.scheduleLocks(pat(), 4, 1.2);
    const lockV = scheduled[0][0].value;
    const restoreV = scheduled[1][0].value;
    expect(restoreV).toBeGreaterThan(lockV);
  });
});
