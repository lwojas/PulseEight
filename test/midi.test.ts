import { beforeEach, describe, expect, it } from "vitest";
import { setLevel, toggleMute } from "../src/engine/actions";
import { cleanValue, getParam, onParamChange, paramInfo, paramManifest, setParam } from "../src/engine/params";
import { locateSong } from "../src/engine/song";
import { initialState, newPattern } from "../src/engine/state";
import { getState, replaceState, setState } from "../src/engine/store";
import { TRACKS } from "../src/engine/spec";
import { createClockFollower } from "../src/midi/clock";
import {
  compileMapping, createMidiControl, midiToValue, valueToMidi,
  type MidiMapping, type ParamBus, type ParamDescription, type ParamSource,
} from "../src/midi/control";
import { midiMapping } from "../src/midi/mapping";

const bus: ParamBus = {
  describe: (id) => paramInfo(id),
  get: (id) => getParam(id, getState()),
  set: (id, v, source) => setParam(id, cleanValue(paramInfo(id)!, v), source),
  subscribe: onParamChange,
};

function rig(mapping: MidiMapping = midiMapping) {
  const sent: number[][] = [];
  const control = createMidiControl({ mapping, bus, send: (b) => sent.push(b) });
  return { sent, control };
}

beforeEach(() => replaceState(initialState()));

describe("mapping", () => {
  it("compiles against the real parameters with no warnings", () => {
    expect(compileMapping(midiMapping, bus).warnings).toEqual([]);
  });
  it("maps every sound knob of every track (the table in mapping.ts matches the spec)", () => {
    const mapped = compileMapping(midiMapping, bus).byParam;
    for (const t of TRACKS) for (const c of t.controls) expect(mapped.has(`track.${t.id + 1}.sound.${c.key}`)).toBe(true);
  });
  it("reports unknown parameters, bad channels and doubled CCs instead of failing", () => {
    const m: MidiMapping = {
      defaultChannel: 1,
      parameters: {
        "track.1.volume": { cc: 7 }, "track.1.mute": { cc: 7 }, "nope": { cc: 1 }, "track.2.volume": { cc: 7, channel: 17 },
      },
    };
    const c = compileMapping(m, bus);
    expect(c.warnings).toHaveLength(3);
    expect([...c.byParam.keys()]).toEqual(["track.1.volume"]);
  });
});

describe("value conversion", () => {
  const norm: ParamDescription = { kind: "norm", min: 0, max: 1 };
  const int: ParamDescription = { kind: "int", min: 0, max: 7 };
  const bool: ParamDescription = { kind: "bool", min: 0, max: 1 };
  it("scales 0-127 across the range", () => {
    expect(midiToValue(norm, 0)).toBe(0);
    expect(midiToValue(norm, 127)).toBe(1);
    expect(midiToValue(int, 127)).toBe(7);
    expect(midiToValue(int, 64)).toBe(4);
    expect(midiToValue(norm, 127, true)).toBe(0);
  });
  it("uses 0-63 off, 64-127 on for booleans and sends 0 or 127", () => {
    expect(midiToValue(bool, 63)).toBe(0);
    expect(midiToValue(bool, 64)).toBe(1);
    expect(valueToMidi(bool, 1)).toBe(127);
    expect(valueToMidi(bool, 0)).toBe(0);
  });
  it("round-trips every controller value of a continuous and a stepped parameter", () => {
    for (let c = 0; c <= 127; c++) expect(valueToMidi(norm, midiToValue(norm, c))).toBe(c);
    for (let i = 0; i <= 7; i++) expect(midiToValue(int, valueToMidi(int, i))).toBe(i);
  });
});

describe("input", () => {
  it("moves the parameter the mapping names, and the store follows", () => {
    const { control } = rig();
    control.handle([0xb0, 7, 96]); // channel 1, CC7 -> track 1 volume
    expect(getState().patterns[0].tracks[0].level).toBeCloseTo(96 / 127, 6);
    expect(getState().patterns[0].tracks[1].level).not.toBeCloseTo(96 / 127, 3);
  });
  it("respects channels: the same CC on another channel is another track", () => {
    const { control } = rig();
    control.handle([0xb1, 7, 127]); // channel 2
    control.handle([0xb2, 7, 0]); // channel 3
    const t = getState().patterns[0].tracks;
    expect(t[1].level).toBe(1);
    expect(t[2].level).toBe(0);
    expect(t[0].level).toBeCloseTo(0.85, 6); // track 1 untouched
  });
  it("ignores CCs and channels that are not mapped", () => {
    const { control } = rig();
    const before = getState();
    control.handle([0xb0, 99, 64]);
    control.handle([0xb9, 7, 64]); // channel 10: no track
    expect(getState()).toBe(before);
  });
  it("mutes at 64 and above, unmutes below", () => {
    const { control } = rig();
    control.handle([0xb0, 20, 64]);
    expect(getState().mutes[0]).toBe(true);
    control.handle([0xb0, 20, 63]);
    expect(getState().mutes[0]).toBe(false);
  });
  it("sets a stepped control by index (FM colour) and a sound knob by position", () => {
    const { control } = rig();
    control.handle([0xb7, 70, 127]); // channel 8 = FM, first knob is COLOR (8 steps)
    expect(getParam("track.8.sound.color", getState())).toBe(7);
    control.handle([0xb6, 74, 0]); // channel 7 = ACID, CC74 = filter cutoff
    expect(getState().patterns[0].tracks[6].sound[0]).toBe(0);
  });
  it("uses the default channel for a parameter without one, and an override otherwise", () => {
    const m: MidiMapping = { defaultChannel: 5, parameters: { "track.1.volume": { cc: 7 }, "track.2.volume": { cc: 7, channel: 2 } } };
    const { control } = rig(m);
    control.handle([0xb4, 7, 127]); // channel 5
    control.handle([0xb1, 7, 127]); // channel 2
    control.handle([0xb0, 7, 0]); // channel 1: not mapped
    const t = getState().patterns[0].tracks;
    expect(t[0].level).toBe(1);
    expect(t[1].level).toBe(1);
    expect(t[2].level).toBeCloseTo(0.55, 6);
  });
});

describe("output", () => {
  it("sends the mapped CC on the mapped channel when the UI moves a control", () => {
    const { sent } = rig();
    setLevel(1, 1); // track 2 -> channel 2
    toggleMute(0);
    expect(sent).toEqual([[0xb1, 7, 127], [0xb0, 20, 127]]);
  });
  it("sends nothing for an unchanged 7-bit value", () => {
    const { sent } = rig();
    setLevel(0, 0.5);
    setLevel(0, 0.5001);
    expect(sent).toHaveLength(1);
  });
  it("does not echo what MIDI input just set", () => {
    const { sent, control } = rig();
    control.handle([0xb0, 7, 96]);
    control.handle([0xb0, 20, 127]);
    expect(sent).toEqual([]);
    setLevel(0, 0.2); // a real change from the UI still goes out
    expect(sent).toEqual([[0xb0, 7, 25]]);
  });
  it("does not resend a value the controller already shows", () => {
    const { sent, control } = rig();
    control.handle([0xb0, 7, 96]);
    setLevel(0, 96 / 127);
    expect(sent).toEqual([]);
  });
  it("sends changes made by the app itself (a pattern change moves the faders)", () => {
    const { sent } = rig();
    setState((s) => {
      const patterns = s.patterns.slice();
      patterns[1] = newPattern();
      patterns[1].tracks[0].level = 0.1;
      return { patterns };
    });
    setState({ pattern: 1 });
    expect(sent).toContainEqual([0xb0, 7, 13]);
  });
  it("sendAll brings a new controller up to date", () => {
    const { sent, control } = rig();
    control.sendAll();
    expect(sent).toContainEqual([0xb0, 7, Math.round(0.85 * 127)]);
    expect(sent.length).toBeGreaterThan(60);
  });
  it("stops sending after dispose", () => {
    const { sent, control } = rig();
    control.dispose();
    setLevel(0, 0.3);
    expect(sent).toEqual([]);
  });
});

describe("parameter origin", () => {
  it("reports who made each change", () => {
    const seen: Array<[string, ParamSource]> = [];
    const off = onParamChange((id, _v, source) => seen.push([id, source]));
    setLevel(0, 0.3);
    setParam("track.1.volume", 0.6, "host");
    setParam("track.2.mute", 1, "midi");
    off();
    expect(seen).toEqual([["track.1.volume", "ui"], ["track.1.volume", "host"], ["track.2.mute", "midi"]]);
  });
  it("clamps and snaps values to the parameter's domain", () => {
    setParam("track.1.volume", 7, "host");
    setParam("track.1.mute", 0.7, "host");
    expect(getState().patterns[0].tracks[0].level).toBe(1);
    expect(getState().mutes[0]).toBe(true);
  });
  it("describes every parameter for a host", () => {
    const m = paramManifest();
    expect(new Set(m.map((p) => p.id)).size).toBe(m.length);
    for (const p of m) expect(p.def).toBeGreaterThanOrEqual(p.min);
  });
});

describe("pattern banks", () => {
  it("Bank Select then Program Change picks pattern bank*16+program", () => {
    const { control } = rig();
    control.handle([0xb0, 0, 1]); // bank 1
    control.handle([0xc0, 3]); // program 3
    expect(getState().pattern).toBe(19);
    control.handle([0xc0, 0]); // same bank
    expect(getState().pattern).toBe(16);
  });
  it("ignores a program past the last pattern, and other channels", () => {
    const { control } = rig();
    control.handle([0xb0, 0, 9]);
    control.handle([0xc0, 5]);
    control.handle([0xc3, 5]);
    expect(getState().pattern).toBe(0);
  });
  it("cues while playing instead of jumping", () => {
    const { control } = rig();
    setState({ playing: true, playPattern: 0 });
    control.handle([0xc0, 4]);
    expect(getState()).toMatchObject({ cue: 4, pattern: 0 });
  });
  it("sends bank and program when the app changes pattern, but not for MIDI's own", () => {
    const { sent, control } = rig();
    control.handle([0xc0, 2]);
    expect(sent).toEqual([]);
    setState({ pattern: 17 });
    expect(sent).toEqual([[0xb0, 0, 1], [0xc0, 1]]);
  });
});

describe("a second groovebox", () => {
  it("reuses the engine with its own parameters and mapping", () => {
    const values: Record<string, number> = { "a.gain": 0 };
    const listeners = new Set<(id: string, v: number, s: ParamSource) => void>();
    const fake: ParamBus = {
      describe: (id) => (id === "a.gain" ? { kind: "norm", min: 0, max: 1 } : undefined),
      get: (id) => values[id],
      set: (id, v, s) => { values[id] = v; listeners.forEach((l) => l(id, v, s)); },
      subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); },
    };
    const sent: number[][] = [];
    const c = createMidiControl({ mapping: { defaultChannel: 3, parameters: { "a.gain": { cc: 1 } } }, bus: fake, send: (b) => sent.push(b) });
    c.handle([0xb2, 1, 127]);
    expect(values["a.gain"]).toBe(1);
    expect(sent).toEqual([]);
    fake.set("a.gain", 0, "ui");
    expect(sent).toEqual([[0xb2, 1, 0]]);
  });
});

describe("clock follower", () => {
  function run() {
    const log: string[] = [];
    const f = createClockFollower({
      start: (s, t) => log.push(`start ${s} ${t.toFixed(3)}`),
      stop: () => log.push("stop"),
      step: (s) => log.push(`step ${s}`),
      tempo: (b) => log.push(`tempo ${b}`),
    });
    const pulse = (n: number, from: number, bpm: number) => {
      for (let i = 0; i < n; i++) f.handle([0xf8], from + (i * 60) / (bpm * 24));
    };
    return { f, log, pulse };
  }
  it("reads the tempo from the pulses", () => {
    const { log, pulse } = run();
    pulse(60, 10, 133);
    expect(log).toContain("tempo 133");
  });
  it("starts on the first pulse after Start and steps every 6 pulses", () => {
    const { f, log, pulse } = run();
    f.handle([0xfa], 1);
    pulse(13, 1.01, 120);
    expect(log.filter((l) => l !== "tempo 120" && !l.startsWith("tempo"))).toEqual(["start 0 1.010", "step 0", "step 1", "step 2"]);
  });
  it("continues from the song position pointer", () => {
    const { f, log, pulse } = run();
    f.handle([0xf2, 0x10, 0x00], 1); // 16 steps
    f.handle([0xfb], 1);
    pulse(7, 1.01, 120);
    expect(log).toContain("start 16 1.010");
    expect(log).toContain("step 17");
  });
  it("Stop then Continue resumes where it stopped", () => {
    const { f, log, pulse } = run();
    f.handle([0xfa], 0);
    pulse(13, 0.01, 120); // two full steps
    f.handle([0xfc], 1);
    f.handle([0xfb], 2);
    pulse(1, 2.01, 120);
    expect(log).toContain("stop");
    expect(log).toContain("start 2 2.010");
  });
  it("a position move while running restarts at the new position on the next pulse", () => {
    const { f, log, pulse } = run();
    f.handle([0xfa], 0);
    pulse(3, 0.01, 120);
    f.handle([0xf2, 8, 0], 0.2);
    pulse(1, 0.21, 120);
    expect(log.filter((l) => l.startsWith("start") || l === "stop")).toEqual(["start 0 0.010", "stop", "start 8 0.210"]);
  });
  it("ignores pulses before a Start", () => {
    const { log, pulse } = run();
    pulse(10, 0, 120);
    expect(log.some((l) => l.startsWith("start") || l.startsWith("step"))).toBe(false);
  });
});

describe("song position", () => {
  it("loops the current pattern when there is no chain", () => {
    const s = { ...initialState(), pattern: 0 };
    expect(locateSong(s, 5)).toEqual({ pattern: 0, chainPos: 0, step: 5 });
    expect(locateSong(s, 21)).toEqual({ pattern: 0, chainPos: 0, step: 5 });
  });
  it("walks the chain by pattern length", () => {
    const s = initialState();
    s.patterns[2].length = 32;
    const c = { ...s, chainOn: true, chain: [0, 2, 1] };
    expect(locateSong(c, 0)).toEqual({ pattern: 0, chainPos: 0, step: 0 });
    expect(locateSong(c, 20)).toEqual({ pattern: 2, chainPos: 1, step: 4 });
    expect(locateSong(c, 16 + 32 + 3)).toEqual({ pattern: 1, chainPos: 2, step: 3 });
    expect(locateSong(c, 64 + 1)).toEqual({ pattern: 0, chainPos: 0, step: 1 });
  });
});
