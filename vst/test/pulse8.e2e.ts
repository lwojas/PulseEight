// Pulse.8 as the plugin plays it, end to end and headless: the page's own code (Groovebox, controller, MIDI) over webvst's shim, the
// real plugin engine behind it, a DAW simulated in real time. Run with `npm run vst:e2e` (builds the harness first).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harnessBinary, onsets, rmsBetween, SR, startRig, type Rig } from "./rig";

const LATENCY = 4800; // the plugin declares 100 ms of delay compensation: DAW beat b sounds at its frame + this
const TOL = 200; // frames (4 ms): a block is 128, the detector's window 64
const BEAT = (SR * 60) / 120; // frames in a beat at 120 bpm

const available = harnessBinary() !== null;
describe.skipIf(!available)("Pulse.8 in the plugin (headless end to end)", () => {
  let rig: Rig;
  // the page, imported once the shim is installed
  let controller: typeof import("../../src/engine/controller").controller;
  let store: typeof import("../../src/engine/store");
  let state: typeof import("../../src/engine/state");
  let midi: typeof import("../../src/midi/setup");

  beforeAll(async () => {
    rig = await startRig();
    ({ controller } = await import("../../src/engine/controller"));
    store = await import("../../src/engine/store");
    state = await import("../../src/engine/state");
    midi = await import("../../src/midi/setup");
    await controller.start();
    expect(store.getState().audio).toBe("ready");
    await rig.wait(0.5);
  });
  afterAll(async () => {
    await rig?.stop();
  });

  /** A pattern with only the given steps of one track on. */
  const pattern = (track: number, steps: number[], length = 16) => {
    const p = state.newPattern();
    p.length = length;
    for (const s of steps) p.tracks[track].steps[s].on = true;
    return p;
  };
  const load = (patterns: Record<number, ReturnType<typeof pattern>>, extra: Partial<ReturnType<typeof store.getState>> = {}) => {
    const all = store.getState().patterns.map((_, i) => patterns[i] ?? state.newPattern());
    store.setState({ patterns: all, mutes: new Array(8).fill(false), solos: new Array(8).fill(false), chain: [], chainOn: false, pattern: 0, cue: null, ...extra });
  };
  const play = async (from = 0) => {
    rig.daw.ppq = from;
    rig.daw.playing = true;
    await rig.wait(0.15);
  };
  const stopDaw = async () => {
    rig.daw.playing = false;
    await rig.wait(0.4);
  };
  /** The beats (DAW position) at which a sound began, for DAW positions in [from, to). Detected over the whole recording, so a hit at the
   * edge of the range is judged against the silence before it, not against where the analysis happened to start. */
  const hitBeats = async (ppq0: number, from: number, to: number) => {
    const audio = await rig.audio();
    const beatOf = (frame: number) => (frame - rig.daw.startFrame - LATENCY) / BEAT + ppq0;
    return onsets(audio).map(beatOf).filter((b) => b > from - TOL / BEAT && b < to - TOL / BEAT);
  };

  it("brings the engine up without a gesture and is handed the song and the DAW's transport", async () => {
    expect(rig.sent.some((m) => m.type === "set-sequence")).toBe(true);
    const caps = (controller.engine!.runtime.getCapabilities());
    expect(caps.nativeSequence).toBe(true);
    expect(caps.hostProtocolVersion).toBeGreaterThanOrEqual(4);
  });

  it("plays the sequence on the DAW's timeline, sample-accurately", async () => {
    load({ 0: pattern(0, [0, 4, 8, 12]) });
    await rig.wait(0.3);
    await play(0);
    await rig.until(8.2);
    const beats = await hitBeats(0, 0, 8);
    expect(beats.length).toBe(8);
    beats.forEach((b, i) => expect(Math.abs(b - i) * BEAT).toBeLessThan(TOL));
    expect(store.getState().playing).toBe(true);
    expect(store.getState().hostBpm).toBe(120);
    await stopDaw();
    expect(store.getState().playing).toBe(false);
  });

  const strict = (got: number[], want: number[]) => {
    expect(got.length, `hits at beats ${got.map((b) => b.toFixed(2)).join(", ")}`).toBe(want.length);
    got.forEach((b, i) => expect(Math.abs(b - want[i]) * BEAT, `hit ${i} at beat ${b.toFixed(3)}, wanted ${want[i]}`).toBeLessThan(TOL));
  };

  it("follows a locate in phase: the next bar line is where the song's next bar starts", async () => {
    await stopDaw();
    load({ 0: pattern(0, [0]) }); // one kick, on the first beat of each bar
    await rig.wait(0.3);
    await play(0);
    await rig.until(2.2);
    const at = await rig.locate(10); // the DAW jumps to bar 3, beat 3
    await rig.until(17.2);
    const audio = await rig.audio();
    const beats = onsets(audio)
      .filter((f) => f > at)
      .map((f) => 10 + (f - at - LATENCY) / BEAT);
    // not at 10 or 11 (mid-bar), then 12 and 16: a kick on every bar line of the DAW's timeline
    expect(beats.length).toBe(2);
    beats.forEach((b, i) => expect(Math.abs(b - [12, 16][i]) * BEAT).toBeLessThan(TOL));
    await stopDaw();
  });

  it("plays a chain, with each pattern's own mix, and a cue lands exactly on the boundary", async () => {
    await stopDaw();
    const a = pattern(0, [0, 4, 8, 12]);
    const b = pattern(0, [0, 8]);
    b.tracks[0].level = 0.4; // quieter: its fader is written at its start
    load({ 0: a, 1: b }, { chainOn: true, chain: [0, 1] });
    await rig.wait(0.3);
    await play(0);
    await rig.until(8.2);
    strict(await hitBeats(0, 0, 8), [0, 1, 2, 3, 4, 6]);
    const audio = await rig.audio();
    const at = (beat: number) => rig.daw.startFrame + LATENCY + beat * BEAT;
    const loud = rmsBetween(audio, at(1) + 400, at(1) + 4000);
    const quiet = rmsBetween(audio, at(6) + 400, at(6) + 4000);
    expect(quiet).toBeLessThan(loud * 0.5); // pattern 2's level arrived with it, from the bus event in the sequence
    await rig.until(12.2);
    strict(await hitBeats(0, 8, 12), [8, 9, 10, 11]); // the chain wrapped to pattern 1
    await stopDaw();
  });

  it("swaps a cued pattern in exactly at the next pattern boundary", async () => {
    await stopDaw();
    load({ 0: pattern(0, [0, 4, 8, 12]), 1: pattern(0, [0, 8]) });
    await rig.wait(0.3);
    await play(0);
    await rig.until(5.4);
    controller.selectPattern(1); // cue pattern 2 while pattern 1 plays
    expect(store.getState().cue).toBe(1);
    await rig.until(16.2);
    // pattern 1 up to beat 8, then pattern 2: a hit every two beats, none at 9 or 11
    strict(await hitBeats(0, 4, 16), [4, 5, 6, 7, 8, 10, 12, 14]);
    expect(store.getState().cue).toBeNull();
    expect(store.getState().pattern).toBe(1);
    await stopDaw();
  });

  it("applies a live mute at once, and keeps it", async () => {
    await stopDaw();
    load({ 0: pattern(0, [0, 4, 8, 12]) });
    await rig.wait(0.3);
    await play(0);
    await rig.until(2.5);
    const mutes = new Array(8).fill(false);
    mutes[0] = true;
    store.setState({ mutes });
    await rig.until(6.2);
    strict(await hitBeats(0, 0, 6).then((h) => h.filter((b) => b < 3.2 || b > 3.8)), [0, 1, 2]); // 3 may or may not beat the mute: it was sent at 2.5
    store.setState({ mutes: new Array(8).fill(false) });
    await stopDaw();
  });

  it("renders a written FX lane on the timeline and puts the chain back after it", async () => {
    await stopDaw();
    const hat = 4; // closed hat: bright, so a closing filter is obvious
    const p = pattern(hat, Array.from({ length: 16 }, (_, i) => i));
    for (let s = 4; s < 8; s++) {
      p.fxLanes[0].fx[s] = 1; // FILTER (a takeover)
      p.fxLanes[0].fxLvl[s] = 1;
    }
    load({ 0: p });
    await rig.wait(0.3);
    await play(0);
    await rig.until(4.2);
    const audio = await rig.audio();
    const at = (beat: number) => rig.daw.startFrame + LATENCY + beat * BEAT;
    const before = rmsBetween(audio, at(0.5), at(0.95));
    const during = rmsBetween(audio, at(1.5), at(1.95));
    const after = rmsBetween(audio, at(2.5), at(2.95));
    expect(before).toBeGreaterThan(0.01);
    expect(during).toBeLessThan(before * 0.8); // the filter closed on the hats (their body is low enough to survive about half)
    expect(during).toBeLessThan(after * 0.65);
    expect(after).toBeGreaterThan(before * 0.9); // and opened again: the rest values were written
    await stopDaw();
  });

  it("is told what a key plays, and plays DAW MIDI itself, sample-accurately, without the page", async () => {
    await stopDaw();
    load({ 0: state.newPattern() });
    store.setState({ focus: 0 }); // the kick drum
    midi.midi.boot();
    await rig.wait(0.3);
    const route = rig.sent.filter((m) => m.type === "set-midi-route").at(-1) as { route: { kind: string; fixedPitch?: boolean } };
    expect(route.route).toMatchObject({ kind: "instrument", fixedPitch: true });
    const at = await rig.midi([0x90, 40, 110]);
    await rig.wait(0.8);
    const audio = await rig.audio();
    const hits = onsets(audio.subarray(at - 2400, at + 20000));
    expect(hits.length).toBe(1); // once: the page did not play it as well
    expect(Math.abs(hits[0] - 2400)).toBeLessThan(80); // on its own frame
    // a different key plays the same drum at the same pitch (a drum pad)
    const at2 = await rig.midi([0x90, 72, 110]);
    await rig.wait(0.8);
    const audio2 = await rig.audio();
    const a = audio.subarray(at, at + 4000);
    const b = audio2.subarray(at2, at2 + 4000);
    let diff = 0;
    for (let i = 0; i < 4000; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    expect(diff).toBeLessThan(0.02);
  });

  it("routes a synth track's keys as pitched notes held until key-up, and hands the arp and step entry back to the page", async () => {
    await stopDaw();
    const bass = 6;
    store.setState({ focus: bass, selStep: -1 });
    await rig.wait(0.2);
    const last = () => rig.sent.filter((m) => m.type === "set-midi-route").at(-1) as { route: { kind: string; unityNote: number; holdUntilKeyUp?: boolean } | null };
    expect(last().route).toMatchObject({ kind: "instrument", holdUntilKeyUp: true });
    const down = await rig.midi([0x90, 40, 100]);
    await rig.wait(0.5);
    const up = await rig.midi([0x80, 40, 0]);
    await rig.wait(1.0);
    const audio = await rig.audio();
    const held = rmsBetween(audio, down + 4000, up);
    const released = rmsBetween(audio, up + 24000, up + 36000);
    expect(held).toBeGreaterThan(0.01);
    expect(released).toBeLessThan(held * 0.1);
    // the arp is the page's: no route
    const arp = store.getState().arp.map((a, i) => (i === bass ? { ...a, on: true } : a));
    store.setState({ arp });
    await rig.wait(0.2);
    expect(last().route).toBeNull();
    store.setState({ arp: arp.map((a) => ({ ...a, on: false })) });
    await rig.wait(0.2);
    expect(last().route).not.toBeNull();
    store.setState({ selStep: 3 }); // entering a step's note
    await rig.wait(0.2);
    expect(last().route).toBeNull();
    store.setState({ selStep: -1 });
  });

  it("keeps playing, in time, with the window closed", async () => {
    load({ 0: pattern(0, [0, 4, 8, 12]) });
    await rig.wait(0.3);
    await play(0);
    await rig.until(3.2);
    rig.closeWindow();
    await rig.until(11.2);
    const beats = await hitBeats(0, 4, 11);
    strict(beats, [4, 5, 6, 7, 8, 9, 10]);
  });
});
