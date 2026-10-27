// The audio layer: the only module that talks to webdsp's AudioRuntime.
//
// Topology (all webdsp primitives, nothing custom):
//
//   instrument ─▶ track bus ──(main, BusOutput)──▶ master ─▶ limiter
//                      └────(send, BusSendTarget)─▶ MANGLER bus ─▶ master
//   MANGLER bus chain: Filter ▶ Saturation ▶ Bitcrusher ▶ Phaser ▶ Dub Delay (wet-only return)
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
  private readonly trackBus: BusId[] = [];
  private readonly inst: InstrumentId[] = [];
  private readonly manglerBus: BusId;
  private readonly fx = {} as Record<FxSlot, EffectId>;
  private readonly effectRange = new Map<number, { min: number; max: number }>();

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
      ["dub", EffectKind.DubDelay],
    ] as const) {
      this.fx[slot] = runtime.addEffect(this.manglerBus, kind);
      for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
    }
    runtime.setEffectParameter(this.manglerBus, this.fx.filter, NodeParam.FilterMode, FilterMode.LowPass);
    runtime.setEffectParameter(this.manglerBus, this.fx.phaser, NodeParam.PhaserStages, 6);

    for (const spec of TRACKS) {
      const bus = runtime.createBus();
      this.trackBus.push(bus);
      runtime.setNodeParameter(bus, NodeParam.BusSendTarget, this.manglerBus);
      runtime.setNodeParameter(bus, NodeParam.BusSendAmount, 0);
      const inst = runtime.createInstrument(spec.kind, { bus });
      this.inst.push(inst);
      runtime.setInstrumentParameter(inst, InstrumentCommonParam.Gain, spec.gainDb);
      for (const [param, value] of spec.fixed) runtime.setInstrumentParameter(inst, param, value);
    }
    this.applyManglerValues(baseValues({ div: 2, fb: 0.5, tone: 0.55, amt: 0.6 }));
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
        const gain = audible ? levelToGain(tp.level) : 0;
        const send = mix.takeover ? 1 : Math.max(tp.send, mix.boost);
        const main = mix.takeover ? 0 : 1;
        this.setBus(t, "g", NodeParam.BusGain, gain);
        this.setBus(t, "s", NodeParam.BusSendAmount, send);
        this.setBus(t, "m", NodeParam.BusMainGain, main);
      }
    });
  }

  private setBus(track: number, slot: string, param: NodeParam, value: number): void {
    const key = `${track}:${slot}`;
    if (this.busCache.get(key) === value) return;
    this.busCache.set(key, value);
    this.runtime.setNodeParameter(this.trackBus[track], param, value);
  }

  // --- mangler -------------------------------------------------------------------------------

  /** Write mangler values (only the ones that changed) to the shared effect chain. */
  applyManglerValues(values: ManglerValues): void {
    for (const key of MANGLER_KEYS) {
      if (this.manglerCache[key] === values[key]) continue;
      this.manglerCache[key] = values[key];
      const { fx, param } = MANGLER_PARAMS[key];
      const range = this.effectRange.get(param);
      const v = range ? Math.min(range.max, Math.max(range.min, values[key])) : values[key];
      this.runtime.setEffectParameter(this.manglerBus, this.fx[fx], param, v);
    }
  }
}
