// Track sends: a conventional delay send and reverb send per track (mixing, always available).
// Deliberately small: delay is Free (a time in ms) or Beat (a tempo division); reverb is send + size.
// These are separate from the punch FX in mangler.ts, which are performed, not mixed.
import { DUB_DIVISIONS } from "./mangler";
import { TRACKS } from "./spec";

export interface DelaySend {
  send: number;
  /** 0 = Free (time in ms), 1 = Beat (division of the project tempo). */
  mode: 0 | 1;
  /** Free time, normalised 0..1 (see `freeDelaySeconds`). */
  time: number;
  /** Beat division, index into `DUB_DIVISIONS`. */
  div: number;
}

export interface ReverbSend {
  send: number;
  /** Size / decay character, 0..1. */
  size: number;
}

export const DELAY_MODES = ["FREE", "BEAT"] as const;
export const BEAT_DIVISIONS = DUB_DIVISIONS;

/** Fixed delay character: only time/mode/send are exposed. */
export const DELAY_FEEDBACK_FREE = 0.4;
export const DELAY_FEEDBACK_BEAT = 0.45;
export const DELAY_TONE = 3500;

/** Free delay time: 40 ms .. 900 ms on an exponential taper. */
export const freeDelaySeconds = (n: number) => 0.04 * Math.pow(0.9 / 0.04, Math.min(1, Math.max(0, n)));
export const formatFreeDelay = (n: number) => `${Math.round(freeDelaySeconds(n) * 1000)} ms`;
export const formatBeatDelay = (div: number) => BEAT_DIVISIONS[Math.min(BEAT_DIVISIONS.length - 1, Math.max(0, div))].label;

export const reverbDecay = (size: number) => 0.35 + 0.58 * Math.min(1, Math.max(0, size));
export const reverbDamping = (size: number) => 0.45 - 0.25 * Math.min(1, Math.max(0, size));

/** Quarter-note ticks into a readable time for the delay readout. */
export function delayReadout(d: DelaySend): string {
  return d.mode === 1 ? formatBeatDelay(d.div) : formatFreeDelay(d.time);
}

/** The acid bass's distortion insert: webdsp's Saturation (the effect behind the DRIVE punch) on the bass bus, between the synth and the
 * fader, so the delay and reverb sends hear the driven sound. `dist` is one normalised 0..1 amount: pre-gain and output trim follow the
 * DRIVE punch exactly (`mangler.ts`: 10..30 dB, trim 3..9 dB), so 30% here is 30% there; the mix fades in over the first `DIST_FADE`
 * of the travel. At 0 the mix is 0, which webdsp makes an exact pass-through. */
export const DIST_DRIVE_DB = [10, 30] as const;
export const DIST_TRIM_DB = [3, 9] as const;
export const DIST_FADE = 0.1;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const distDriveDb = (dist: number) => DIST_DRIVE_DB[0] + (DIST_DRIVE_DB[1] - DIST_DRIVE_DB[0]) * clamp01(dist);
export const distTrimDb = (dist: number) => -(DIST_TRIM_DB[0] + (DIST_TRIM_DB[1] - DIST_TRIM_DB[0]) * clamp01(dist));
export const distMix = (dist: number) => Math.min(1, clamp01(dist) / DIST_FADE);
export const formatDist = (dist: number) => (dist <= 0 ? "OFF" : `${Math.round(clamp01(dist) * 100)}`);
export const newDist = (): number => 0;

// Per-track starting sends live in `TRACKS[i].mix` (spec.ts).
export const defaultDelaySend = (track: number) => TRACKS[track].mix.delay;
export const defaultReverbSend = (track: number) => TRACKS[track].mix.reverb;

export const newDelay = (track: number): DelaySend => ({ send: defaultDelaySend(track), mode: 1, time: 0.5, div: 1 });
export const newReverb = (track: number): ReverbSend => ({ send: defaultReverbSend(track), size: 0.5 });
