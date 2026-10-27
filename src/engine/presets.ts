// Factory presets. Authored in engine units (readable: "kick tune 50 Hz"), converted to the
// normalised control values the rest of the app stores.
import { TRACKS, unitsToNorm, BASS_TRACK, TONE_TRACK } from "./spec";

type Units = Record<string, number>;

const toNorm = (track: number, u: Units): number[] =>
  TRACKS[track].controls.map((c) => (u[c.key] === undefined ? unitsToNorm(c, c.def) : unitsToNorm(c, u[c.key])));

export interface Kit {
  name: string;
  /** Per drum track id (0..5) control values in engine units. */
  drums: Units[];
}

export interface SynthPreset {
  name: string;
  values: Units;
}

export const KITS: readonly Kit[] = [
  {
    name: "909 CLASSIC",
    drums: [
      { tune: 50, sweep: 2.5, decay: 0.45, punch: 0.5, drive: 0.3 },
      { tune: 185, decay: 0.22, snap: 0.5, noise: 0.6 },
      { tune: 0, decay: 0.06, metal: 0.7, tone: 0.55 },
      { tune: 0, decay: 0.45, metal: 0.7, tone: 0.5 },
      { tune: 1300, decay: 0.25, spread: 0.5, snap: 0.5 },
      { tune: 120, drop: 0.6, decay: 0.45, body: 0.5, damp: 0.3 },
    ],
  },
  {
    name: "808 BOOM",
    drums: [
      { tune: 40, sweep: 1.2, decay: 1.0, punch: 0.2, drive: 0.15 },
      { tune: 170, decay: 0.3, snap: 0.4, noise: 0.5 },
      { tune: -1, decay: 0.04, metal: 0.8, tone: 0.4 },
      { tune: -1, decay: 0.6, metal: 0.8, tone: 0.4 },
      { tune: 1000, decay: 0.35, spread: 0.7, snap: 0.35 },
      { tune: 90, drop: 0.8, decay: 0.65, body: 0.4, damp: 0.4 },
    ],
  },
  {
    name: "TECHNO HARD",
    drums: [
      { tune: 56, sweep: 2.2, decay: 0.28, punch: 0.85, drive: 0.7 },
      { tune: 215, decay: 0.15, snap: 0.8, noise: 0.7 },
      { tune: 1, decay: 0.035, metal: 0.9, tone: 0.75 },
      { tune: 1, decay: 0.3, metal: 0.85, tone: 0.75 },
      { tune: 1700, decay: 0.18, spread: 0.3, snap: 0.8 },
      { tune: 210, drop: 0.5, decay: 0.2, body: 0.7, damp: 0.5 },
    ],
  },
  {
    name: "DUB DRY",
    drums: [
      { tune: 45, sweep: 1.6, decay: 0.6, punch: 0.3, drive: 0.1 },
      { tune: 160, decay: 0.35, snap: 0.3, noise: 0.7 },
      { tune: -2, decay: 0.07, metal: 0.5, tone: 0.35 },
      { tune: -2, decay: 0.5, metal: 0.5, tone: 0.35 },
      { tune: 1100, decay: 0.3, spread: 0.6, snap: 0.3 },
      { tune: 100, drop: 0.7, decay: 0.55, body: 0.45, damp: 0.45 },
    ],
  },
];

export const BASS_PRESETS: readonly SynthPreset[] = [
  { name: "ACID 303", values: { cutoff: 600, reso: 0.7, bite: 0.6, decay: 0.25, wave: 1 } },
  { name: "SQUELCH", values: { cutoff: 350, reso: 0.92, bite: 0.8, decay: 0.18, wave: 1 } },
  { name: "RUBBER", values: { cutoff: 900, reso: 0.55, bite: 0.5, decay: 0.35, wave: 0.6 } },
  { name: "SUB PUSH", values: { cutoff: 220, reso: 0.2, bite: 0.3, decay: 0.5, wave: 0.3 } },
];

export const TONE_PRESETS: readonly SynthPreset[] = [
  { name: "FM BASS", values: { color: 1, depth: 0.4, bite: 0.7, tone: 0.7, decay: 0.25 } },
  { name: "HOLLOW LEAD", values: { color: 2, depth: 0.5, bite: 0.3, tone: 0.8, decay: 0.5 } },
  { name: "BELL PLUCK", values: { color: 7, depth: 0.45, bite: 0.8, tone: 0.9, decay: 0.7 } },
  { name: "METAL STAB", values: { color: 6, depth: 0.6, bite: 0.6, tone: 0.85, decay: 0.2 } },
  { name: "SUB GROWL", values: { color: 0, depth: 0.55, bite: 0.5, tone: 0.5, decay: 0.4 } },
];

export function kitSounds(kit: Kit): number[][] {
  return kit.drums.map((u, i) => toNorm(i, u));
}

export function synthSound(track: number, preset: SynthPreset): number[] {
  return toNorm(track, preset.values);
}

export const presetsFor = (track: number): readonly SynthPreset[] =>
  track === BASS_TRACK ? BASS_PRESETS : track === TONE_TRACK ? TONE_PRESETS : [];
