// The audio layer: the only module that talks to webdsp's AudioRuntime.
//
// Topology (all webdsp primitives, nothing custom). A bus has one main route and one send, so each
// track is a short chain of buses, each adding one tap:
//
//   instrument ─▶ A (fader/mute) ─main─▶ B ─main─▶ C ─main─▶ master ─▶ limiter
//                    └─send─▶ DELAY_t     └─send─▶ REVERB_t   └─send─▶ PUNCH bus ─▶ master
//
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
import { normToUnits, NUM_TRACKS, TRACKS } from "./spec";
import type { Pattern } from "./state";
import {
  BEAT_DIVISIONS, DELAY_FEEDBACK_BEAT, DELAY_FEEDBACK_FREE, DELAY_TONE, freeDelaySeconds, reverbDamping, reverbDecay,
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
  private readonly inst: InstrumentId[] = [];
  private readonly manglerBus: BusId;
  private readonly fx = {} as Record<FxSlot, EffectId>;
  private readonly effectRange = new Map<number, { min: number; max: number }>();
  /** Last value of each mangler key as it will be once the scheduled segments have run. */
  private scheduled: Partial<ManglerValues> = {};
  private fxCache = new Map<string, number>();

  private soundCache: number[][] = TRACKS.map((t) => new Array(t.controls.length).fill(NaN));
  private busCache = new Map<string, number>();
  private manglerCache: Partial<ManglerValues> = {};

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
      for (const kind of [EffectKind.Delay, EffectKind.DubDelay, EffectKind.Reverb]) {
        for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
      }
      const inst = runtime.createInstrument(spec.kind, { bus });
      this.inst.push(inst);
      runtime.setInstrumentParameter(inst, InstrumentCommonParam.Gain, spec.gainDb);
      for (const [param, value] of spec.fixed) runtime.setInstrumentParameter(inst, param, value);
    }
    this.applyManglerValues(baseValues());
  }

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
    for (const spec of TRACKS) if (spec.role !== "drum") this.runtime.instrumentNoteOff(this.inst[spec.id]);
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
    for (const spec of TRACKS) {
      const sound = pattern.tracks[spec.id].sound;
      spec.controls.forEach((c, i) => {
        const value = normToUnits(c, sound[i]);
        if (this.soundCache[spec.id][i] === value) return;
        this.soundCache[spec.id][i] = value;
        if (future) events.push({ time: time!, target: { instrument: this.inst[spec.id] }, param: c.param, value });
        else this.runtime.setInstrumentParameter(this.inst[spec.id], c.param, value);
      });
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  // --- mixer + routing -----------------------------------------------------------------------

  applyMix(mix: MixInput, time?: number): void {
    this.when(time, () => {
      const anySolo = mix.solos.some(Boolean);
      for (let t = 0; t < NUM_TRACKS; t++) {
        const audible = anySolo ? mix.solos[t] : !mix.mutes[t];
        const tp = mix.pattern.tracks[t];
        // the fader/mute sits before every tap, so a muted track's delay and reverb go quiet too
        this.setBus(this.trackBus[t], `${t}:g`, NodeParam.BusGain, audible ? levelToGain(tp.level) : 0);
        this.setBus(this.trackBus[t], `${t}:d`, NodeParam.BusSendAmount, tp.dly.send);
        this.setBus(this.busB[t], `${t}:r`, NodeParam.BusSendAmount, tp.rev.send);
        // a track with its punch send off is neither fed to the punch section nor cut by a takeover
        const punched = tp.punch !== false;
        this.setBus(this.busC[t], `${t}:s`, NodeParam.BusSendAmount, punched ? (mix.takeover ? 1 : mix.boost) : 0);
        this.setBus(this.busC[t], `${t}:m`, NodeParam.BusMainGain, punched && mix.takeover ? 0 : 1);
        this.applyTrackFx(t, tp.dly, tp.rev);
      }
    });
  }

  /** Delay mode/time and reverb size of one track (the sends themselves are bus levels). */
  private applyTrackFx(t: number, dly: Pattern["tracks"][number]["dly"], rev: Pattern["tracks"][number]["rev"]): void {
    const bus = this.delayBus[t];
    const { dub, free } = this.delayFx[t];
    const beat = dly.mode === 1;
    this.setFx(bus, dub, `${t}:dubMix`, NodeParam.DubDelayMix, beat ? 1 : 0);
    this.setFx(bus, free, `${t}:freeMix`, NodeParam.DelayMix, beat ? 0 : 1);
    if (beat) {
      const div = BEAT_DIVISIONS[Math.min(BEAT_DIVISIONS.length - 1, Math.max(0, dly.div))].value;
      this.setFx(bus, dub, `${t}:dubDiv`, NodeParam.DubDelayDivision, div);
      this.setFx(bus, dub, `${t}:dubFb`, NodeParam.DubDelayFeedback, DELAY_FEEDBACK_BEAT);
    } else {
      this.setFx(bus, free, `${t}:freeTime`, NodeParam.DelayTime, freeDelaySeconds(dly.time));
      this.setFx(bus, free, `${t}:freeFb`, NodeParam.DelayFeedback, DELAY_FEEDBACK_FREE);
    }
    this.setFx(this.reverbBus[t], this.reverbFx[t], `${t}:decay`, NodeParam.ReverbDecay, reverbDecay(rev.size));
    this.setFx(this.reverbBus[t], this.reverbFx[t], `${t}:damp`, NodeParam.ReverbDamping, reverbDamping(rev.size));
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
