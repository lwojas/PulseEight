// The audio layer: the only module that talks to webdsp's AudioRuntime.
//
// Topology (all webdsp primitives, nothing custom). A bus has one main route and one send, so each
// track is a short chain of buses, each adding one tap:
//
//   instrument ─▶ [Saturation: the synths] ─▶ A (fader/mute) ─main─▶ B ─main─▶ C ─main─▶ master ─▶ limiter
//                    └─send─▶ DELAY_t     └─send─▶ REVERB_t   └─send─▶ PUNCH bus ─▶ master
//
//   The two synths (acid bass, FM) have one more effect on bus A, ahead of the fader and both sends: a distortion insert (webdsp Saturation).
//   DELAY_t  (per track, wet-only): Dub Delay (Beat) ▶ Delay (Free), one of them active
//   REVERB_t (per track, wet-only): Reverb. Idle while its send is 0 (webdsp sleeps unfed buses).
//   PUNCH bus chain: Filter ▶ Saturation ▶ Bitcrusher ▶ Phaser ▶ Flanger ▶ Dub Delay ▶ Reverb
//   The punch bus is only fed while a punch is held (C's send); C's main is cut during a takeover.
import {
  AudioRuntime,
  EffectKind,
  FilterMode,
  InstrumentCommonParam,
  NodeParam,
  type BusId,
  type EffectId,
  type InstrumentId,
  type InstrumentNoteParams,
  type ScheduledParam,
} from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";
import { baseValues, MANGLER_KEYS, MANGLER_PARAMS, type FxSlot, type ManglerValues } from "./mangler";
import { lockParams, type LockParam } from "./plock";
import { DIST_TRACKS, hasDistortion, normToUnits, NUM_TRACKS, TRACKS } from "./spec";
import { trackStepAt, type Pattern } from "./state";
import {
  BEAT_DIVISIONS, DELAY_FEEDBACK_BEAT, DELAY_FEEDBACK_FREE, DELAY_TONE, distDriveDb, distMix, distTrimDb, freeDelaySeconds, reverbDamping, reverbDecay,
} from "./trackfx";

/** Work that has to land at a point on the audio clock but is not a sample-accurate event
 * (bus levels and sends are not schedulable in webdsp). Fired from the shared ticker. */
class TimedQueue {
  private items: Array<{ time: number; fn: () => void }> = [];
  at(time: number, fn: () => void) {
    this.items.push({ time, fn });
    this.items.sort((a, b) => a.time - b.time);
  }
  flush(now: number) {
    while (this.items.length && this.items[0].time <= now + 0.004) this.items.shift()!.fn();
  }
  clear() {
    this.items = [];
  }
}

/** Level fader taper: 0..1 → linear bus gain, about unity at 0.95. */
export const levelToGain = (level: number) => level * level * 1.1;

export interface MixInput {
  pattern: Pattern;
  mutes: readonly boolean[];
  solos: readonly boolean[];
  takeover: boolean;
  boost: number;
}

/** The ids of everything the graph is made of: what the pure functions below address. */
export interface GraphIds {
  /** Per track: A (fader, delay send), B (reverb send), C (punch send, takeover cut). */
  trackBus: readonly BusId[];
  busB: readonly BusId[];
  busC: readonly BusId[];
  delayBus: readonly BusId[];
  reverbBus: readonly BusId[];
  delayFx: ReadonlyArray<{ dub: EffectId; free: EffectId }>;
  reverbFx: readonly EffectId[];
  /** Per track: the distortion insert (Saturation) on bus A, ahead of the fader and both sends. Only the synths have one. */
  distFx: ReadonlyArray<EffectId | undefined>;
  inst: readonly InstrumentId[];
  manglerBus: BusId;
  fx: Readonly<Record<FxSlot, EffectId>>;
}

/** One parameter write the graph needs. `key` names the parameter (the live engine skips a write that repeats its last). */
export type Write =
  | { kind: "bus"; key: string; bus: BusId; param: NodeParam; value: number }
  | { kind: "fx"; key: string; bus: BusId; effect: EffectId; param: NodeParam; value: number }
  | { kind: "inst"; key: string; instrument: InstrumentId; param: number; value: number };

/** The mixer's bus writes for a pattern's levels and sends, the mutes and solos, and the punch section's state
 * (`takeover`, `boost`). "pattern" is what travels with the pattern (fader/mute, delay and reverb sends); "punch" is the
 * punch send and takeover cut on bus C, which the written FX lanes drive; "all" is both. */
export function mixWrites(ids: GraphIds, mix: MixInput, group: "pattern" | "punch" | "all" = "all"): Write[] {
  const out: Write[] = [];
  const anySolo = mix.solos.some(Boolean);
  const bus = (b: BusId, key: string, param: NodeParam, value: number) => out.push({ kind: "bus", key, bus: b, param, value });
  for (let t = 0; t < NUM_TRACKS; t++) {
    const audible = anySolo ? mix.solos[t] : !mix.mutes[t];
    const tp = mix.pattern.tracks[t];
    if (group !== "punch") {
      // the fader/mute sits before every tap, so a muted track's delay and reverb go quiet too
      bus(ids.trackBus[t], `${t}:g`, NodeParam.BusGain, audible ? levelToGain(tp.level) : 0);
      bus(ids.trackBus[t], `${t}:d`, NodeParam.BusSendAmount, tp.dly.send);
      bus(ids.busB[t], `${t}:r`, NodeParam.BusSendAmount, tp.rev.send);
    }
    if (group !== "pattern") {
      // a track with its punch send off is neither fed to the punch section nor cut by a takeover
      const punched = tp.punch !== false;
      bus(ids.busC[t], `${t}:s`, NodeParam.BusSendAmount, punched ? (mix.takeover ? 1 : mix.boost) : 0);
      bus(ids.busC[t], `${t}:m`, NodeParam.BusMainGain, punched && mix.takeover ? 0 : 1);
    }
  }
  return out;
}

/** Every track's delay mode/time and reverb size for a pattern (the sends themselves are bus levels). `clamp` keeps a value inside
 * its effect parameter's range. */
export function trackFxWrites(ids: GraphIds, pattern: Pattern, clamp: (param: number, value: number) => number): Write[] {
  const out: Write[] = [];
  for (let t = 0; t < NUM_TRACKS; t++) {
    const { dly, rev } = pattern.tracks[t];
    const bus = ids.delayBus[t];
    const { dub, free } = ids.delayFx[t];
    const beat = dly.mode === 1;
    const fx = (b: BusId, effect: EffectId, key: string, param: NodeParam, value: number) =>
      out.push({ kind: "fx", key: `${t}:${key}`, bus: b, effect, param, value: clamp(param, value) });
    fx(bus, dub, "dubMix", NodeParam.DubDelayMix, beat ? 1 : 0);
    fx(bus, free, "freeMix", NodeParam.DelayMix, beat ? 0 : 1);
    if (beat) {
      const div = BEAT_DIVISIONS[Math.min(BEAT_DIVISIONS.length - 1, Math.max(0, dly.div))].value;
      fx(bus, dub, "dubDiv", NodeParam.DubDelayDivision, div);
      fx(bus, dub, "dubFb", NodeParam.DubDelayFeedback, DELAY_FEEDBACK_BEAT);
    } else {
      fx(bus, free, "freeTime", NodeParam.DelayTime, freeDelaySeconds(dly.time));
      fx(bus, free, "freeFb", NodeParam.DelayFeedback, DELAY_FEEDBACK_FREE);
    }
    fx(ids.reverbBus[t], ids.reverbFx[t], "decay", NodeParam.ReverbDecay, reverbDecay(rev.size));
    fx(ids.reverbBus[t], ids.reverbFx[t], "damp", NodeParam.ReverbDamping, reverbDamping(rev.size));
    if (hasDistortion(t)) for (const w of distWrites(ids, t, pattern.tracks[t].dist ?? 0)) out.push(w);
  }
  return out;
}

/** A synth's distortion insert at amount `dist` (0..1): Saturation drive, output trim and mix, which move together. */
function distWrites(ids: GraphIds, track: number, dist: number): Write[] {
  const bus = ids.trackBus[track];
  const fx = (key: string, param: NodeParam, value: number): Write => ({ kind: "fx", key: `${track}:${key}`, bus, effect: ids.distFx[track]!, param, value });
  return [
    fx("satDrive", NodeParam.SatDrive, distDriveDb(dist)),
    fx("satOut", NodeParam.SatOutputGain, distTrimDb(dist)),
    fx("satMix", NodeParam.SatMix, distMix(dist)),
  ];
}

/** The engine writes that put parameter `p` of `track` at normalised `value` (one for most parameters; the distortion moves three
 * effect parameters). Their keys are the ones the mixer and sound writes use for the same parameter, so a lock and the base share caches. */
export function lockWrites(ids: GraphIds, track: number, p: LockParam, value: number): Write[] {
  const t = p.target;
  if (t.kind === "sound") {
    const c = TRACKS[track].controls[t.control];
    return [{ kind: "inst", key: `${track}:${t.control}`, instrument: ids.inst[track], param: c.param, value: normToUnits(c, value) }];
  }
  if (t.kind === "dist") return distWrites(ids, track, value);
  const delay = t.send === "dly";
  return [{ kind: "bus", key: `${track}:${delay ? "d" : "r"}`, bus: delay ? ids.trackBus[track] : ids.busB[track], param: NodeParam.BusSendAmount, value }];
}

/** A pattern's instrument settings, in engine units. */
export function soundWrites(ids: GraphIds, pattern: Pattern): Write[] {
  const out: Write[] = [];
  for (const spec of TRACKS) {
    const sound = pattern.tracks[spec.id].sound;
    spec.controls.forEach((c, i) => out.push({ kind: "inst", key: `${spec.id}:${i}`, instrument: ids.inst[spec.id], param: c.param, value: normToUnits(c, sound[i]) }));
  }
  return out;
}

/** The mangler chain's values as effect writes (clamped to each parameter's range). */
export function manglerWrites(ids: GraphIds, values: ManglerValues, clamp: (param: number, value: number) => number): Write[] {
  return MANGLER_KEYS.map((key) => {
    const { fx, param } = MANGLER_PARAMS[key];
    return { kind: "fx", key, bus: ids.manglerBus, effect: ids.fx[fx], param, value: clamp(param, values[key]) };
  });
}

export class Groovebox {
  private readonly queue = new TimedQueue();
  /** Per track: A (fader, delay send), B (reverb send), C (punch send, takeover cut). */
  private readonly trackBus: BusId[] = [];
  private readonly busB: BusId[] = [];
  private readonly busC: BusId[] = [];
  private readonly delayBus: BusId[] = [];
  private readonly reverbBus: BusId[] = [];
  private readonly delayFx: Array<{ dub: EffectId; free: EffectId }> = [];
  private readonly reverbFx: EffectId[] = [];
  private readonly distFx: Array<EffectId | undefined> = [];
  private readonly inst: InstrumentId[] = [];
  private readonly manglerBus: BusId;
  private readonly fx = {} as Record<FxSlot, EffectId>;
  private readonly effectRange = new Map<number, { min: number; max: number }>();
  /** Last value of each mangler key as it will be once the scheduled segments have run. */
  private scheduled: Partial<ManglerValues> = {};
  private fxCache = new Map<string, number>();

  private soundCache: number[][] = TRACKS.map((t) => new Array(t.controls.length).fill(NaN));
  /** Per track: the write keys of each parameter a scheduled lock has put away from the base value (until a later step restores it), by lock id. */
  private lockedParams: Array<Map<string, string[]>> = TRACKS.map(() => new Map());
  /** Every key in `lockedParams`: what the immediate base writes leave alone. */
  private lockedKeys = new Set<string>();
  private busCache = new Map<string, number>();
  private manglerCache: Partial<ManglerValues> = {};

  /** The graph's ids, for the pure write functions (and the native sequence, which writes the same parameters). */
  readonly ids: GraphIds;

  private constructor(readonly runtime: AudioRuntime) {
    this.manglerBus = runtime.createBus();
    for (const [slot, kind] of [
      ["filter", EffectKind.Filter],
      ["sat", EffectKind.Saturation],
      ["crush", EffectKind.Bitcrusher],
      ["phaser", EffectKind.Phaser],
      ["flange", EffectKind.ChorusFlanger],
      ["dub", EffectKind.DubDelay],
      ["verb", EffectKind.Reverb],
    ] as const) {
      this.fx[slot] = runtime.addEffect(this.manglerBus, kind);
      for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
    }
    runtime.setEffectParameter(this.manglerBus, this.fx.filter, NodeParam.FilterMode, FilterMode.LowPass);
    runtime.setEffectParameter(this.manglerBus, this.fx.phaser, NodeParam.PhaserStages, 6);

    for (const kind of [EffectKind.Delay, EffectKind.DubDelay, EffectKind.Reverb]) {
      for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
    }
    for (const spec of TRACKS) {
      const bus = runtime.createBus();
      const b = runtime.createBus();
      const c = runtime.createBus();
      const dly = runtime.createBus();
      const rev = runtime.createBus();
      this.trackBus.push(bus);
      this.busB.push(b);
      this.busC.push(c);
      this.delayBus.push(dly);
      this.reverbBus.push(rev);
      runtime.setNodeParameter(bus, NodeParam.BusOutput, b);
      runtime.setNodeParameter(b, NodeParam.BusOutput, c);
      runtime.setNodeParameter(bus, NodeParam.BusSendTarget, dly);
      runtime.setNodeParameter(bus, NodeParam.BusSendAmount, 0);
      runtime.setNodeParameter(b, NodeParam.BusSendTarget, rev);
      runtime.setNodeParameter(b, NodeParam.BusSendAmount, 0);
      runtime.setNodeParameter(c, NodeParam.BusSendTarget, this.manglerBus);
      runtime.setNodeParameter(c, NodeParam.BusSendAmount, 0);
      // wet-only returns; the inactive delay of the pair stays a pass-through (mix 0)
      const dub = runtime.addEffect(dly, EffectKind.DubDelay);
      const free = runtime.addEffect(dly, EffectKind.Delay);
      runtime.setEffectParameter(dly, dub, NodeParam.DubDelayTone, DELAY_TONE);
      runtime.setEffectParameter(dly, dub, NodeParam.DubDelayMix, 1);
      runtime.setEffectParameter(dly, free, NodeParam.DelayMix, 0);
      this.delayFx.push({ dub, free });
      const verb = runtime.addEffect(rev, EffectKind.Reverb);
      runtime.setEffectParameter(rev, verb, NodeParam.ReverbMix, 1);
      this.reverbFx.push(verb);
      // a synth's distortion sits on its bus A, so it follows the synth and comes before the fader and both sends; Saturation starts at mix 0, a pass-through
      this.distFx.push(hasDistortion(spec.id) ? runtime.addEffect(bus, EffectKind.Saturation) : undefined);
      const inst = runtime.createInstrument(spec.kind, { bus });
      this.inst.push(inst);
      runtime.setInstrumentParameter(inst, InstrumentCommonParam.Gain, spec.gainDb);
      for (const [param, value] of spec.fixed) runtime.setInstrumentParameter(inst, param, value);
    }
    this.ids = {
      trackBus: this.trackBus, busB: this.busB, busC: this.busC, delayBus: this.delayBus, reverbBus: this.reverbBus,
      delayFx: this.delayFx, reverbFx: this.reverbFx, distFx: this.distFx, inst: this.inst, manglerBus: this.manglerBus, fx: this.fx,
    };
    this.applyManglerValues(baseValues());
  }

  /** `value` kept inside the effect parameter's range. */
  clampFx = (param: number, value: number): number => {
    const range = this.effectRange.get(param);
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
  };

  static async create(): Promise<Groovebox> {
    const runtime = await AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl, maxVoices: 32 });
    await runtime.resume();
    return new Groovebox(runtime);
  }

  get now(): number {
    return this.runtime.getCurrentTime();
  }

  /** Called by the shared ticker. */
  tick(): void {
    this.queue.flush(this.now);
  }

  /** Run `fn` at audio time `time`: now if it is due, otherwise from the ticker. */
  when(time: number | undefined, fn: () => void): void {
    if (time === undefined || time <= this.now + 0.004) fn();
    else this.queue.at(time, fn);
  }

  clearPending(): void {
    this.queue.clear();
  }

  // --- notes ---------------------------------------------------------------------------------

  note(track: number, params: InstrumentNoteParams): void {
    this.runtime.instrumentNoteOn(this.inst[track], params);
  }

  /** Release held notes and drop scheduled ones (transport stop). */
  silence(): void {
    this.runtime.cancelScheduled();
    // the restores that were scheduled are gone with the rest: the engine may hold locked values, so forget what it holds
    this.forgetLocks();
    for (const spec of TRACKS) if (spec.role !== "drum") this.runtime.instrumentNoteOff(this.inst[spec.id]);
  }

  /** Forget what the engine holds of every lockable parameter (a lock may have left it away from the base), so the next apply sends it. */
  forgetLocks(): void {
    this.lockedParams.forEach((m) => m.clear());
    this.lockedKeys.clear();
    for (const spec of TRACKS) {
      this.soundCache[spec.id].fill(NaN);
      this.busCache.delete(`${spec.id}:d`);
      this.busCache.delete(`${spec.id}:r`);
    }
    for (const t of DIST_TRACKS) for (const key of ["satDrive", "satOut", "satMix"]) this.fxCache.delete(`${t}:${key}`);
  }

  setTempo(bpm: number, anchorTime: number, time?: number): void {
    this.runtime.setTempo(bpm, { anchorTime, time });
  }

  // --- sound ---------------------------------------------------------------------------------

  /** Push a pattern's instrument settings to the engine; only changed values are sent. With a
   * future `time` they are applied sample-accurately at that instant (pattern changes). */
  applySound(pattern: Pattern, time?: number): void {
    const future = time !== undefined && time > this.now + 0.004;
    const events: ScheduledParam[] = [];
    for (const w of soundWrites(this.ids, pattern)) {
      if (w.kind !== "inst") continue;
      const [track, i] = w.key.split(":").map(Number);
      if (this.soundCache[track][i] === w.value) continue;
      // a lock is sounding or scheduled on this control: the base comes back with the step that ends it (see scheduleLocks)
      if (!future && this.lockedKeys.has(w.key)) continue;
      this.soundCache[track][i] = w.value;
      if (future) events.push({ time: time!, target: { instrument: w.instrument }, param: w.param, value: w.value });
      else this.runtime.setInstrumentParameter(w.instrument, w.param, w.value);
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  /** Parameter locks for step `step` of `pattern`, which sounds at audio time `time`: the step's locked parameters go to the engine at
   * that time (sound controls as scheduled parameter writes, applied before that block's notes; sends from the ticker, as the mixer's
   * are), and a parameter the previous step locked that this one does not goes back to its base value. Nothing is sent for the common
   * step with no locks and none to undo. */
  scheduleLocks(pattern: Pattern, step: number, time: number, run: number = step): void {
    const events: ScheduledParam[] = [];
    for (const spec of TRACKS) {
      const t = spec.id;
      const tp = pattern.tracks[t];
      const locks = tp.steps[trackStepAt(pattern, t, step, run)].parameterLocks;
      const before = this.lockedParams[t];
      if (!locks && before.size === 0) continue;
      const now = new Map<string, string[]>();
      for (const p of lockParams(t)) {
        const locked = locks?.[p.id];
        if (locked === undefined && !before.has(p.id)) continue;
        const writes = lockWrites(this.ids, t, p, locked ?? p.base(tp));
        if (locked !== undefined) now.set(p.id, writes.map((w) => w.key));
        for (const w of writes) {
          if (w.kind === "inst") {
            events.push({ time, target: { instrument: w.instrument }, param: w.param, value: w.value });
            this.soundCache[t][(p.target as { control: number }).control] = locked !== undefined ? NaN : w.value;
          } else if (w.kind === "bus") {
            this.when(time, () => this.setBus(w.bus, w.key, w.param, w.value));
          } else {
            events.push({ time, target: { effect: { bus: w.bus, effect: w.effect } }, param: w.param, value: w.value });
            // as for a sound control: while locked the engine's value is not the base, so the next base write must send
            if (locked !== undefined) this.fxCache.delete(w.key);
            else this.fxCache.set(w.key, w.value);
          }
        }
      }
      for (const keys of before.values()) for (const key of keys) this.lockedKeys.delete(key);
      for (const keys of now.values()) for (const key of keys) this.lockedKeys.add(key);
      this.lockedParams[t] = now;
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  // --- mixer + routing -----------------------------------------------------------------------

  /** `group` limits the bus writes: "pattern" leaves the punch section (bus C) alone. */
  applyMix(mix: MixInput, time?: number, group: "pattern" | "punch" | "all" = "all"): void {
    this.when(time, () => {
      for (const w of mixWrites(this.ids, mix, group)) if (w.kind === "bus" && !this.lockedKeys.has(w.key)) this.setBus(w.bus, w.key, w.param, w.value);
      for (const w of trackFxWrites(this.ids, mix.pattern, this.clampFx)) if (w.kind === "fx" && !this.lockedKeys.has(w.key)) this.setFx(w.bus, w.effect, w.key, w.param, w.value);
    });
  }

  private setFx(bus: BusId, effect: EffectId, key: string, param: NodeParam, value: number): void {
    if (this.fxCache.get(key) === value) return;
    this.fxCache.set(key, value);
    const range = this.effectRange.get(param);
    this.runtime.setEffectParameter(bus, effect, param, range ? Math.min(range.max, Math.max(range.min, value)) : value);
  }

  private setBus(bus: BusId, key: string, param: NodeParam, value: number): void {
    if (this.busCache.get(key) === value) return;
    this.busCache.set(key, value);
    this.runtime.setNodeParameter(bus, param, value);
  }

  // --- mangler -------------------------------------------------------------------------------

  /** Write mangler values (only the ones that changed) to the shared effect chain. */
  applyManglerValues(values: ManglerValues): void {
    for (const key of MANGLER_KEYS) {
      if (this.manglerCache[key] === values[key]) continue;
      this.manglerCache[key] = values[key];
      // An immediate write says nothing about where the already-queued events will leave the chain, so
      // forget the scheduled value: the next scheduled step must send this key rather than assume it.
      delete this.scheduled[key];
      const { fx, param } = MANGLER_PARAMS[key];
      const range = this.effectRange.get(param);
      const v = range ? Math.min(range.max, Math.max(range.min, values[key])) : values[key];
      this.runtime.setEffectParameter(this.manglerBus, this.fx[fx], param, v);
    }
  }

  /** Written FX: from `time`, move the chain from `from` to `to` over `dur` seconds on the audio
   * clock (webdsp scheduled param ramps; the same events a sequencer automation lane would send).
   * Only keys that differ from where the previous segment left them are sent. */
  scheduleManglerSegment(from: ManglerValues, to: ManglerValues, time: number, dur: number): void {
    const events: ScheduledParam[] = [];
    for (const key of MANGLER_KEYS) {
      const { fx, param } = MANGLER_PARAMS[key];
      const range = this.effectRange.get(param);
      const clamp = (v: number) => (range ? Math.min(range.max, Math.max(range.min, v)) : v);
      const target = { effect: { bus: this.manglerBus, effect: this.fx[fx] } };
      const ramp = dur > 0 && from[key] !== to[key];
      if (!ramp && this.scheduled[key] === from[key]) continue;
      events.push(
        ramp
          ? { time, target, param, from: clamp(from[key]), value: clamp(to[key]), ramp: dur }
          : { time, target, param, value: clamp(from[key]) },
      );
      this.scheduled[key] = ramp ? to[key] : from[key];
      // the engine value is no longer the one the immediate path last wrote
      delete this.manglerCache[key];
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  /** Forget scheduled mangler state (transport start/stop): the next write sends everything. */
  resetManglerSchedule(): void {
    this.scheduled = {};
    this.manglerCache = {};
  }
}
