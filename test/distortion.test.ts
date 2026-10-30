import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeParam } from "webdsp";
import { setDistortion, setLockable, setPlockMode } from "../src/engine/actions";
import { Groovebox, lockWrites, trackFxWrites, type GraphIds } from "../src/engine/audio";
import { PUNCHES } from "../src/engine/mangler";
import { midiMapping } from "../src/midi/mapping";
import { getParam, paramInfo, setParam } from "../src/engine/params";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import { lockParam, lockParams, sanitizeLocks } from "../src/engine/plock";
import { BASS_TRACK, NUM_TRACKS } from "../src/engine/spec";
import { initialState } from "../src/engine/state";
import { getState, replaceState, setState } from "../src/engine/store";
import { distDriveDb, distMix, distTrimDb, formatDist } from "../src/engine/trackfx";

const T = BASS_TRACK;
const tp = (t = T) => getState().patterns[getState().pattern].tracks[t];
const range = (n: number) => Array.from({ length: NUM_TRACKS }, (_, i) => n + i);
const ids = {
  trackBus: range(200), busB: range(250), busC: range(260), delayBus: range(500), reverbBus: range(600),
  delayFx: range(700).map((dub) => ({ dub, free: dub + 100 })), reverbFx: range(900), distFx: 450,
} as unknown as GraphIds;

beforeEach(() => replaceState(initialState()));

describe("bass distortion: state", () => {
  it("exists on the acid bass only, and starts off", () => {
    expect(tp().dist).toBe(0);
    for (let t = 0; t < NUM_TRACKS; t++) if (t !== T) expect(tp(t).dist).toBeUndefined();
  });

  it("clamps, edits only the pattern on screen, and ignores other tracks", () => {
    setDistortion(T, 5);
    expect(tp().dist).toBe(1);
    setDistortion(T, -1);
    expect(tp().dist).toBe(0);
    setDistortion(T, 0.4);
    expect(getState().patterns[1].tracks[T].dist).toBe(0);
    setDistortion(7, 0.9);
    expect(tp(7).dist).toBeUndefined();
  });

  it("maps one amount to drive, trim and mix; off is mix 0 (webdsp's exact pass-through)", () => {
    expect(distMix(0)).toBe(0);
    expect(distDriveDb(1)).toBe(30);
    expect(distTrimDb(1)).toBe(-9);
    expect(distMix(1)).toBe(1);
    expect(distMix(0.05)).toBeCloseTo(0.5); // fades in over the first tenth
    expect(formatDist(0)).toBe("OFF");
    expect(formatDist(0.5)).toBe("50");
  });
});

describe("bass distortion: graph", () => {
  const writes = () => trackFxWrites(ids, getState().patterns[0], (_, v) => v).filter((w) => w.kind === "fx" && w.effect === ids.distFx);
  const by = (p: number) => writes().find((w) => w.kind === "fx" && w.param === p)!;

  it("writes drive, output trim and mix to the bass bus's saturation, and nothing for other tracks", () => {
    setDistortion(T, 0.5);
    expect(by(NodeParam.SatDrive).value).toBeCloseTo(distDriveDb(0.5));
    expect(by(NodeParam.SatOutputGain).value).toBeCloseTo(distTrimDb(0.5));
    expect(by(NodeParam.SatMix).value).toBe(1);
    expect(writes()).toHaveLength(3);
    expect(writes().every((w) => w.kind === "fx" && w.bus === ids.trackBus[T] && w.key.startsWith(`${T}:`))).toBe(true);
  });

  it("drives and trims exactly like the DRIVE punch at the same amount", () => {
    for (const p of [0.3, 0.6, 1]) {
      const punch = PUNCHES.find((x) => x.label === "DRIVE")!.values(p, 1);
      expect(distDriveDb(p)).toBeCloseTo(punch.sDrive!);
      expect(distTrimDb(p)).toBeCloseTo(punch.sOut!);
      expect(distMix(p)).toBe(punch.sMix);
    }
  });

  it("is a pass-through at 0", () => {
    expect(by(NodeParam.SatMix).value).toBe(0);
  });

  it("a lock writes the same keys the base uses, so the two share caches", () => {
    const base = new Set(writes().map((w) => w.key));
    const lock = lockWrites(ids, T, lockParam(T, "fx.distortion")!, 0.25);
    expect(lock.map((w) => w.key).sort()).toEqual([...base].sort());
    expect(lock.every((w) => w.kind === "fx" && w.effect === ids.distFx && w.bus === ids.trackBus[T])).toBe(true);
    expect(lock.find((w) => w.param === NodeParam.SatDrive)!.value).toBeCloseTo(distDriveDb(0.25));
  });

  it("schedules a lock on its step and puts the base back on the next", () => {
    setPlockMode(true);
    setState({ focus: T, selStep: 3 });
    setLockable(T, "fx.distortion", 0.8);
    const scheduled: any[][] = [];
    const gb = Object.create(Groovebox.prototype) as any;
    gb.runtime = { scheduleParams: vi.fn((e) => scheduled.push(e)), getCurrentTime: () => 0 };
    gb.ids = ids;
    gb.soundCache = Array.from({ length: NUM_TRACKS }, () => new Array(6).fill(NaN));
    gb.busCache = new Map();
    gb.fxCache = new Map([[`${T}:satMix`, 0]]);
    gb.lockedParams = Array.from({ length: NUM_TRACKS }, () => new Map());
    gb.lockedKeys = new Set();
    const pat = getState().patterns[0];
    gb.scheduleLocks(pat, 3, 1.0);
    expect(gb.lockedKeys.has(`${T}:satMix`)).toBe(true); // the immediate base write leaves it alone
    expect(gb.fxCache.has(`${T}:satMix`)).toBe(false); // and the engine value is no longer the base
    gb.scheduleLocks(pat, 4, 1.1);
    const [lock, restore] = scheduled;
    expect(lock).toHaveLength(3);
    expect(lock.find((e: any) => e.param === NodeParam.SatDrive)).toMatchObject({ time: 1.0, target: { effect: { bus: ids.trackBus[T], effect: ids.distFx } } });
    expect(lock.find((e: any) => e.param === NodeParam.SatDrive).value).toBeCloseTo(distDriveDb(0.8));
    expect(restore.find((e: any) => e.param === NodeParam.SatMix)).toMatchObject({ time: 1.1, value: 0 });
    expect(gb.lockedKeys.size).toBe(0);
    expect(gb.fxCache.get(`${T}:satMix`)).toBe(0); // back on the base
  });
});

describe("bass distortion: locks and parameters", () => {
  it("only the bass has the lock; locks from a save are kept for the bass and dropped elsewhere", () => {
    expect(lockParams(T).map((p) => p.id)).toContain("fx.distortion");
    for (let t = 0; t < NUM_TRACKS; t++) if (t !== T) expect(lockParam(t, "fx.distortion")).toBeUndefined();
    expect(sanitizeLocks(T, { "fx.distortion": 0.3 })).toEqual({ "fx.distortion": 0.3 });
    expect(sanitizeLocks(7, { "fx.distortion": 0.3 })).toBeUndefined();
  });

  it("is addressable by id and follows P-LOCK mode like the knobs", () => {
    expect(paramInfo(`track.${T + 1}.distortion`)).toMatchObject({ kind: "norm", def: 0 });
    expect(paramInfo("track.8.distortion")).toBeUndefined();
    setParam(`track.${T + 1}.distortion`, 0.4, "midi");
    expect(tp().dist).toBe(0.4);
    setPlockMode(true);
    setState({ focus: T, selStep: 1 });
    setParam(`track.${T + 1}.distortion`, 0.9, "midi");
    expect(tp().dist).toBe(0.4); // the base is untouched
    expect(tp().steps[1].parameterLocks).toEqual({ "fx.distortion": 0.9 });
    expect(getParam(`track.${T + 1}.distortion`, getState())).toBe(0.9);
  });

  it("has a CC on the bass's channel", () => {
    expect(midiMapping.parameters[`track.${T + 1}.distortion`]).toEqual({ cc: 77, channel: T + 1 });
  });
});

describe("bass distortion: saving", () => {
  it("survives a save and load, and an older save reads as off", () => {
    setDistortion(T, 0.7);
    const snap = toHostSnapshot();
    const restored = fromHostSnapshot(snap)!;
    expect(restored.patterns[0].tracks[T].dist).toBe(0.7);
    const old = JSON.parse(snap.data);
    for (const p of old.project.patterns) if (p) for (const t of p.tracks) delete t.dist;
    expect(fromHostSnapshot({ ...snap, data: JSON.stringify(old) })!.patterns[0].tracks[T].dist).toBe(0);
  });

  it("repairs a bad amount and drops one on a track that has no distortion", () => {
    const bad = JSON.parse(toHostSnapshot().data);
    bad.project.patterns[0].tracks[T].dist = "loud";
    bad.project.patterns[0].tracks[7].dist = 0.5;
    const restored = fromHostSnapshot({ ...toHostSnapshot(), data: JSON.stringify(bad) })!;
    expect(restored.patterns[0].tracks[T].dist).toBe(0);
    expect(restored.patterns[0].tracks[7].dist).toBeUndefined();
  });
});
