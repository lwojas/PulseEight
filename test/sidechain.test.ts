import { beforeEach, describe, expect, it } from "vitest";
import { NodeParam } from "webdsp";
import { setSidechain } from "../src/engine/actions";
import { trackFxWrites, type GraphIds } from "../src/engine/audio";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import {
  breakLoops, formatScRelease, newSidechain, sanitizeSidechain, SC_RATIO, SC_RELEASE_S, SC_THRESHOLD_DB, scLoops, scReleaseSeconds, scThresholdDb,
} from "../src/engine/sidechain";
import { NUM_TRACKS } from "../src/engine/spec";
import { initialState } from "../src/engine/state";
import { getState, replaceState } from "../src/engine/store";

const range = (n: number) => Array.from({ length: NUM_TRACKS }, (_, i) => n + i);
const ids = {
  trackBus: range(200), busB: range(250), busC: range(260), delayBus: range(500), reverbBus: range(600),
  delayFx: range(700).map((dub) => ({ dub, free: dub + 100 })), reverbFx: range(900), distFx: range(450), filterFx: range(470), scFx: range(480),
} as unknown as GraphIds;
const tp = (t: number) => getState().patterns[getState().pattern].tracks[t];
const writes = (t: number) => trackFxWrites(ids, getState().patterns[getState().pattern], (_, v) => v).filter((w) => w.kind === "fx" && w.effect === ids.scFx![t]);
const by = (t: number, p: NodeParam) => writes(t).find((w) => w.kind === "fx" && w.param === p)!;

beforeEach(() => replaceState(initialState()));

describe("sidechain: state", () => {
  it("is off, and absent, until it is touched", () => {
    for (let t = 0; t < NUM_TRACKS; t++) expect(tp(t).sc).toBeUndefined();
  });

  it("the first edit creates it with the defaults: the first track as the source, the first track itself listening to the second", () => {
    setSidechain(5, { on: true });
    expect(tp(5).sc).toEqual({ on: true, src: 0, amt: 0.5, rel: 0.4 });
    setSidechain(0, { on: true });
    expect(tp(0).sc?.src).toBe(1);
  });

  it("edits only the pattern on screen and only its own track", () => {
    setSidechain(5, { on: true, amt: 0.8 });
    expect(getState().patterns[1].tracks[5].sc).toBeUndefined();
    expect(tp(4).sc).toBeUndefined();
  });

  it("clamps, and a track never listens to itself", () => {
    setSidechain(5, { amt: 7, rel: -1, src: 5 });
    expect(tp(5).sc).toMatchObject({ amt: 1, rel: 0, src: 0 });
    setSidechain(5, { src: 99 });
    expect(tp(5).sc?.src).toBe(0);
  });

  it("refuses a source that would close a loop, and allows it while the other side is off", () => {
    setSidechain(5, { on: true, src: 0 });
    setSidechain(0, { on: true, src: 5 }); // 0 would listen to 5, which listens to 0
    expect(tp(0).sc).toBeUndefined();
    setSidechain(5, { on: false });
    setSidechain(0, { on: true, src: 5 });
    expect(tp(0).sc).toMatchObject({ on: true, src: 5 });
    setSidechain(5, { on: true, src: 0 }); // and now the other way is the loop
    expect(tp(5).sc?.on).toBe(false);
  });

  it("sees a loop through several tracks", () => {
    const tracks = Array.from({ length: 4 }, () => ({} as { sc?: ReturnType<typeof newSidechain> }));
    tracks[1].sc = { ...newSidechain(1), on: true, src: 2 };
    tracks[2].sc = { ...newSidechain(2), on: true, src: 3 };
    expect(scLoops(tracks, 3, 1)).toBe(true); // 3 -> 1 -> 2 -> 3
    expect(scLoops(tracks, 3, 0)).toBe(false);
    expect(scLoops(tracks, 0, 3)).toBe(false);
  });
});

describe("sidechain: mapping and writes", () => {
  it("AMOUNT lowers the threshold, RELEASE is an exponential time", () => {
    expect(scThresholdDb(0)).toBe(SC_THRESHOLD_DB[0]);
    expect(scThresholdDb(1)).toBe(SC_THRESHOLD_DB[1]);
    expect(scThresholdDb(0.5)).toBeCloseTo(-18);
    expect(scReleaseSeconds(0)).toBeCloseTo(SC_RELEASE_S[0]);
    expect(scReleaseSeconds(1)).toBeCloseTo(SC_RELEASE_S[1]);
    expect(formatScRelease(1)).toBe("500 ms");
  });

  it("off is ratio 1 and no key (an exact pass-through, and never the track against itself)", () => {
    expect(by(5, NodeParam.CompRatio).value).toBe(1);
    expect(by(5, NodeParam.CompSidechain).value).toBe(0);
  });

  it("on keys the compressor on the source track's bus A", () => {
    setSidechain(5, { on: true, src: 0, amt: 1, rel: 1 });
    expect(by(5, NodeParam.CompSidechain)).toMatchObject({ value: ids.trackBus[0], bus: ids.trackBus[5], key: "5:scKey" });
    expect(by(5, NodeParam.CompRatio).value).toBe(SC_RATIO);
    expect(by(5, NodeParam.CompThreshold).value).toBe(SC_THRESHOLD_DB[1]);
    expect(by(5, NodeParam.CompRelease).value).toBeCloseTo(SC_RELEASE_S[1]);
    expect(by(4, NodeParam.CompRatio).value).toBe(1); // the others stay out of it
  });

  it("writes switching off come first and those switching on last, so a swap of two sidechains never trips the engine's loop guard", () => {
    setSidechain(5, { on: true, src: 0 });
    const all = trackFxWrites(ids, getState().patterns[0], (_, v) => v);
    const keys = all.map((w, i) => ({ w, i })).filter(({ w }) => w.key.endsWith(":scKey"));
    const firstOn = Math.min(...keys.filter(({ w }) => w.value !== 0).map(({ i }) => i));
    const lastOff = Math.max(...keys.filter(({ w }) => w.value === 0).map(({ i }) => i));
    expect(lastOff).toBeLessThan(firstOn);
    expect(firstOn).toBe(all.length - 1);
  });

  it("without the compressor in the graph (a host that does not have it) there is nothing to write", () => {
    const bare = { ...ids, scFx: undefined } as unknown as GraphIds;
    expect(trackFxWrites(bare, getState().patterns[0], (_, v) => v).some((w) => w.key.includes("sc"))).toBe(false);
  });
});

describe("sidechain: saves", () => {
  it("sanitizes a hand-edited file", () => {
    expect(sanitizeSidechain(undefined, 3)).toBeUndefined();
    expect(sanitizeSidechain({ on: "yes", src: 3, amt: 9, rel: "x" }, 3)).toEqual({ on: false, src: 0, amt: 1, rel: 0.4 });
    expect(sanitizeSidechain({ on: true, src: 2.5, amt: 0.3, rel: 0.2 }, 3)).toMatchObject({ on: true, src: 0 });
  });

  it("switches off a loop that a file holds", () => {
    const tracks = Array.from({ length: 3 }, () => ({} as { sc?: ReturnType<typeof newSidechain> }));
    tracks[0].sc = { ...newSidechain(0), on: true, src: 1 };
    tracks[1].sc = { ...newSidechain(1), on: true, src: 0 };
    breakLoops(tracks);
    expect(tracks.filter((t) => t.sc?.on)).toHaveLength(1);
  });

  it("round-trips through a host snapshot, and a pattern that never had one still has none", () => {
    setSidechain(5, { on: true, src: 0, amt: 0.8, rel: 0.2 });
    const project = fromHostSnapshot(toHostSnapshot())!;
    expect(project.patterns[0].tracks[5].sc).toEqual({ on: true, src: 0, amt: 0.8, rel: 0.2 });
    expect(project.patterns[0].tracks[4].sc).toBeUndefined();
    expect(project.patterns[1].tracks[5].sc).toBeUndefined();
  });
});
