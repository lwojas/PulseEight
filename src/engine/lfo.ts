// Per-track LFOs: three low-frequency oscillators a track can point at any of its lockable parameters (slot knobs, sends, the INSERT FX).
//
// An LFO rides on the parameter's base value: the engine is sent `base + lfo * depth / 2` (clamped to 0..1), so a depth of 100 % sweeps
// half the parameter's range either side of where the knob sits. Several LFOs on one parameter add. The settings live in the pattern
// (`TrackPattern.lfos`) like the knobs they move, and are applied from the controller's tick (see `Groovebox.applyLfos`). Pure: no store,
// no audio.
import { LFO_DIVISIONS, lfoValueAt, LfoWaveform } from "webdsp";

export const NUM_LFOS = 3;
export const LFO_WAVES = ["SIN", "TRI", "SQR", "SAW"] as const;
export const LFO_DIVISION_NAMES = LFO_DIVISIONS.map((d) => d.name);
export const LFO_MIN_HZ = 0.05;
export const LFO_MAX_HZ = 20;

export interface Lfo {
  on: boolean;
  /** The lock id (see plock.ts) of the parameter it moves; "" for none. */
  target: string;
  /** Index into `LFO_WAVES` (the webdsp `LfoWaveform` order). */
  wave: number;
  /** false: free-running at `rate`; true: locked to the beat at division `div`. */
  sync: boolean;
  /** Free rate, 0..1 on a log axis from `LFO_MIN_HZ` to `LFO_MAX_HZ`. */
  rate: number;
  /** Sync division: index into `LFO_DIVISIONS`. */
  div: number;
  /** -1..1 (negative inverts). */
  depth: number;
}

export const newLfo = (): Lfo => ({ on: false, target: "", wave: 0, sync: false, rate: 0.4, div: Math.max(0, LFO_DIVISION_NAMES.indexOf("1/4")), depth: 0.5 });
export const newLfos = (): Lfo[] => Array.from({ length: NUM_LFOS }, newLfo);

export const lfoRateHz = (rate: number): number => LFO_MIN_HZ * (LFO_MAX_HZ / LFO_MIN_HZ) ** rate;
export const formatLfoRate = (l: Lfo): string => (l.sync ? LFO_DIVISION_NAMES[l.div] : `${lfoRateHz(l.rate).toFixed(lfoRateHz(l.rate) < 10 ? 2 : 1)} Hz`);

/** How far the LFO moves its parameter right now, in normalised units (-depth/2 .. +depth/2). */
export function lfoOffset(l: Lfo, time: number, anchorTime: number, bpm: number): number {
  const v = lfoValueAt(
    { waveform: l.wave as LfoWaveform, sync: l.sync, rateHz: lfoRateHz(l.rate), division: l.div },
    { time, anchorTime, bpm },
  );
  return (v * l.depth) / 2;
}

const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/** One LFO from a save, cleaned: every field in range, `def` where it is missing. */
export function sanitizeLfo(raw: unknown, def: Lfo = newLfo()): Lfo {
  const l = (raw ?? {}) as Partial<Lfo>;
  return {
    on: l.on === true,
    target: typeof l.target === "string" ? l.target : "",
    wave: Math.round(num(l.wave, 0, LFO_WAVES.length - 1, def.wave)),
    sync: typeof l.sync === "boolean" ? l.sync : def.sync,
    rate: num(l.rate, 0, 1, def.rate),
    div: Math.round(num(l.div, 0, LFO_DIVISIONS.length - 1, def.div)),
    depth: num(l.depth, -1, 1, def.depth),
  };
}

/** LFOs from a save, cleaned: always `NUM_LFOS` of them, every field in range. */
export function sanitizeLfos(raw: unknown): Lfo[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: NUM_LFOS }, (_, i) => sanitizeLfo(list[i]));
}
