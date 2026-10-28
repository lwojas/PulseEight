// Track layout and the macro control surface. This is the only place that knows which webdsp
// instrument backs each role and which of its parameters are exposed, over what sweet-spot range.
//
// Every control is stored as a normalised 0..1 value (so retuning a range never breaks saved
// patterns) and mapped to engine units here. Ranges are narrower than the engine's on purpose:
// the whole knob travel should be musical.
import {
  BassParam,
  ClapParam,
  FmParam,
  HiHatParam,
  InstrumentKind,
  KickParam,
  SnareParam,
  TomParam,
} from "webdsp";

export type Role = "drum" | "bass" | "tone";
export type Unit = "Hz" | "s" | "%" | "st" | "oct" | "";

export interface ControlSpec {
  key: string;
  label: string;
  /** webdsp parameter id (per-kind enum). */
  param: number;
  /** Sweet-spot range in engine units. */
  lo: number;
  hi: number;
  curve: "lin" | "exp" | "pow";
  /** `pow` only: value = lo + (hi - lo) * n^gamma. gamma > 1 spends more travel on low values. */
  gamma?: number;
  unit: Unit;
  /** Default in engine units. */
  def: number;
  /** Stepped control: detent names, `lo..hi` is `0..names.length-1`. */
  steps?: readonly string[];
}

export interface TrackSpec {
  id: number;
  name: string;
  short: string;
  /** Short description of the machine under the hood, shown in the sound panel. */
  engine: string;
  role: Role;
  kind: InstrumentKind;
  /** CSS custom property holding this track's accent colour. */
  accent: "--drum" | "--bass" | "--tone";
  controls: readonly ControlSpec[];
  /** Engine parameters pinned to fixed values (not exposed). */
  fixed: ReadonlyArray<readonly [param: number, value: number]>;
  /** Source gain trim in dB, for level balance between machines. */
  gainDb: number;
  chokeGroup?: number;
  /** Melodic tracks: MIDI note of the instrument's `tune` (note pitch = note - rootMidi). */
  rootMidi?: number;
  /** Melodic tracks: playable MIDI range. */
  noteLo?: number;
  noteHi?: number;
  /** Melodic tracks: note a new step gets. */
  defaultNote?: number;
}

const lin = (key: string, label: string, param: number, lo: number, hi: number, def: number, unit: Unit = "%"): ControlSpec => ({
  key, label, param, lo, hi, curve: "lin", unit, def,
});
const exp = (key: string, label: string, param: number, lo: number, hi: number, def: number, unit: Unit): ControlSpec => ({
  key, label, param, lo, hi, curve: "exp", unit, def,
});

const pow = (key: string, label: string, param: number, lo: number, hi: number, def: number, gamma: number, unit: Unit = "%"): ControlSpec => ({
  key, label, param, lo, hi, curve: "pow", gamma, unit, def,
});

export const FM_COLORS = ["SUB", "FULL", "HOLLOW", "THIRDS", "THIN", "FIFTHS", "METAL", "BELL"] as const;

export const TRACKS: readonly TrackSpec[] = [
  {
    id: 0, name: "KICK", short: "KCK", engine: "SWEEP KICK", role: "drum", kind: InstrumentKind.Kick, accent: "--drum",
    controls: [
      exp("tune", "TUNE", KickParam.Tune, 35, 80, 50, "Hz"),
      lin("sweep", "SWEEP", KickParam.PitchDrop, 0.4, 3.6, 2.5, "oct"),
      exp("decay", "DECAY", KickParam.Decay, 0.12, 1.1, 0.45, "s"),
      lin("punch", "PUNCH", KickParam.Punch, 0, 1, 0.5),
      lin("drive", "DRIVE", KickParam.Drive, 0, 1, 0.3),
    ],
    fixed: [], gainDb: 0,
  },
  {
    id: 1, name: "SNARE", short: "SNR", engine: "TWO-MODE SNARE", role: "drum", kind: InstrumentKind.Snare, accent: "--drum",
    controls: [
      exp("tune", "TUNE", SnareParam.Tune, 140, 300, 185, "Hz"),
      exp("decay", "DECAY", SnareParam.Decay, 0.08, 0.5, 0.22, "s"),
      lin("snap", "SNAP", SnareParam.Snap, 0, 1, 0.5),
      lin("noise", "RATTLE", SnareParam.Noise, 0.15, 1, 0.6),
    ],
    fixed: [], gainDb: -1,
  },
  {
    id: 2, name: "CL HAT", short: "CH", engine: "METAL HAT · CLOSED", role: "drum", kind: InstrumentKind.HiHat, accent: "--drum",
    controls: [
      lin("tune", "PITCH", HiHatParam.Tune, -6, 6, 0, "st"),
      exp("decay", "DECAY", HiHatParam.Decay, 0.02, 0.18, 0.06, "s"),
      lin("metal", "METAL", HiHatParam.Metal, 0, 1, 0.7),
      lin("tone", "BRIGHT", HiHatParam.Tone, 0, 1, 0.55),
    ],
    fixed: [], gainDb: -5, chokeGroup: 1,
  },
  {
    id: 3, name: "OP HAT", short: "OH", engine: "METAL HAT · OPEN", role: "drum", kind: InstrumentKind.HiHat, accent: "--drum",
    controls: [
      lin("tune", "PITCH", HiHatParam.Tune, -6, 6, 0, "st"),
      exp("decay", "DECAY", HiHatParam.Decay, 0.2, 1.1, 0.45, "s"),
      lin("metal", "METAL", HiHatParam.Metal, 0, 1, 0.7),
      lin("tone", "BRIGHT", HiHatParam.Tone, 0, 1, 0.5),
    ],
    fixed: [], gainDb: -5, chokeGroup: 1,
  },
  {
    id: 4, name: "CLAP", short: "CLP", engine: "BURST CLAP", role: "drum", kind: InstrumentKind.Clap, accent: "--drum",
    controls: [
      exp("tune", "TUNE", ClapParam.Tune, 800, 2400, 1300, "Hz"),
      exp("decay", "DECAY", ClapParam.Decay, 0.1, 0.6, 0.25, "s"),
      lin("spread", "SPREAD", ClapParam.Spread, 0, 1, 0.5),
      lin("snap", "SNAP", ClapParam.Snap, 0, 1, 0.5),
    ],
    fixed: [], gainDb: -2,
  },
  {
    id: 5, name: "PERC", short: "PRC", engine: "TUNED TOM", role: "drum", kind: InstrumentKind.Tom, accent: "--drum",
    controls: [
      exp("tune", "TUNE", TomParam.Tune, 80, 360, 120, "Hz"),
      lin("drop", "SWEEP", TomParam.PitchDrop, 0, 1.6, 0.6, "oct"),
      exp("decay", "DECAY", TomParam.Decay, 0.12, 0.9, 0.45, "s"),
      lin("body", "BODY", TomParam.Body, 0, 1, 0.5),
      lin("damp", "DAMP", TomParam.Damp, 0, 1, 0.3),
    ],
    fixed: [], gainDb: -2,
  },
  {
    id: 6, name: "ACID", short: "ACD", engine: "ACID BASS", role: "bass", kind: InstrumentKind.Bass, accent: "--bass",
    controls: [
      // Ranges set from offline renders of the unchanged webdsp bass (see git log): above ~1 kHz the
      // filter adds nothing at bass pitches, ENV MOD saturates by ~0.5 on low notes, BITE past
      // ~0.75 trades onset brightness and body level for onset loudness, DECAY below 0.1 s is shorter than needed.
      exp("cutoff", "FILTER", BassParam.Cutoff, 90, 1000, 250, "Hz"),
      pow("envmod", "ENV MOD", BassParam.EnvMod, 0, 1, 0.6, 1.7),
      exp("decay", "DECAY", BassParam.Decay, 0.06, 1.1, 0.3, "s"),
      lin("reso", "RES", BassParam.Resonance, 0.1, 0.95, 0.65),
      lin("bite", "BITE", BassParam.Bite, 0, 0.75, 0.5),
      lin("wave", "WAVE", BassParam.Body, 0, 1, 0.55),
    ],
    // The filter envelope shape is fixed inside webdsp (instant attack, exponential fall); the
    // amp envelope is held up so notes stay full and the filter does the plucking.
    fixed: [
      [BassParam.Tune, 55], [BassParam.Attack, 0.001], [BassParam.Sustain, 0.55],
      [BassParam.Release, 0.06], [BassParam.Legato, 0], [BassParam.Slide, 0.08],
    ],
    gainDb: -3, rootMidi: 33, noteLo: 24, noteHi: 59, defaultNote: 24,
  },
  {
    id: 7, name: "FM", short: "FM", engine: "TWO-OP FM", role: "tone", kind: InstrumentKind.Fm, accent: "--tone",
    controls: [
      { key: "color", label: "COLOR", param: FmParam.Ratio, lo: 0, hi: FM_COLORS.length - 1, curve: "lin", unit: "", def: 1, steps: FM_COLORS },
      lin("depth", "DEPTH", FmParam.Timbre, 0.05, 0.9, 0.35),
      lin("bite", "BITE", FmParam.Snap, 0, 1, 0.6),
      lin("tone", "TONE", FmParam.Tone, 0.15, 1, 0.75),
      exp("decay", "DECAY", FmParam.Decay, 0.06, 1.2, 0.3, "s"),
    ],
    fixed: [
      [FmParam.Tune, 110], [FmParam.Attack, 0.004], [FmParam.Sustain, 0.5],
      [FmParam.Release, 0.12], [FmParam.Legato, 0], [FmParam.Slide, 0.06],
    ],
    gainDb: -5, rootMidi: 45, noteLo: 36, noteHi: 71, defaultNote: 48,
  },
];

export const NUM_TRACKS = TRACKS.length;
export const DRUM_TRACKS = TRACKS.filter((t) => t.role === "drum").map((t) => t.id);
export const BASS_TRACK = 6;
export const TONE_TRACK = 7;

// --- normalised <-> engine units -------------------------------------------------------------

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function normToUnits(c: ControlSpec, n: number): number {
  n = clamp01(n);
  if (c.steps) return Math.round(n * (c.steps.length - 1));
  if (c.curve === "exp") return c.lo * Math.pow(c.hi / c.lo, n);
  if (c.curve === "pow") return c.lo + (c.hi - c.lo) * Math.pow(n, c.gamma ?? 1);
  return c.lo + n * (c.hi - c.lo);
}

export function unitsToNorm(c: ControlSpec, v: number): number {
  if (c.steps) return c.steps.length > 1 ? clamp01(v / (c.steps.length - 1)) : 0;
  if (c.curve === "exp") return clamp01(Math.log(v / c.lo) / Math.log(c.hi / c.lo));
  const lin = clamp01((v - c.lo) / (c.hi - c.lo));
  return c.curve === "pow" ? Math.pow(lin, 1 / (c.gamma ?? 1)) : lin;
}

export function defaultSound(track: TrackSpec): number[] {
  return track.controls.map((c) => unitsToNorm(c, c.def));
}

/** Readout for a control at a normalised value, e.g. "52 Hz", "380 ms", "78%". */
export function formatControl(c: ControlSpec, n: number): string {
  const v = normToUnits(c, n);
  if (c.steps) return c.steps[Math.round(v)] ?? "";
  switch (c.unit) {
    case "Hz": return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 2)} kHz` : `${Math.round(v)} Hz`;
    case "s": return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case "st": return `${v >= 0 ? "+" : ""}${v.toFixed(1)} st`;
    case "oct": return `${v.toFixed(1)} oct`;
    case "%": return `${Math.round(clamp01(unitsToNorm(c, v)) * 100)}%`;
    default: return v.toFixed(2);
  }
}

// --- notes -----------------------------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** MIDI 24 is C1 (the convention used in the design mock-up). */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
