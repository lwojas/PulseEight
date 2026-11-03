// Per-track sidechain: a track's volume ducks to another track's signal (the bass under the kick). One webdsp Compressor sits on the
// track's bus A after the INSERT FX and listens to the source track's bus A instead of its own input (webdsp's CompSidechain). Pure: no
// store, no audio.
//
// The compressor's settings are fixed to what ducking wants, so the modal has two knobs: AMOUNT moves the threshold (the lower it
// sits under the kick's level, the deeper the dip) and RELEASE is how long the track takes to come back. The key is the source bus after
// its fader and mute, so a muted or pulled-down source ducks nothing, and a hotter one ducks harder.
import { NUM_TRACKS } from "./spec";

export interface Sidechain {
  on: boolean;
  /** The track whose signal ducks this one. */
  src: number;
  /** Depth, 0..1. */
  amt: number;
  /** Recovery time, 0..1 on an exponential axis from `SC_RELEASE_S[0]` to `SC_RELEASE_S[1]`. */
  rel: number;
}

/** Compressor threshold at AMOUNT 0 and 1 (dB). A kick on its bus peaks around -6 dB, so the top of the travel is a dip of a few dB and the bottom is ~20. */
export const SC_THRESHOLD_DB = [-6, -30] as const;
export const SC_RATIO = 12;
export const SC_ATTACK_S = 0.002;
export const SC_KNEE_DB = 3;
export const SC_RELEASE_S = [0.04, 0.5] as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The track a fresh sidechain listens to: the first track (the kick row), or the second for the first track itself. */
export const defaultSource = (track: number): number => (track === 0 ? 1 : 0);
export const newSidechain = (track: number): Sidechain => ({ on: false, src: defaultSource(track), amt: 0.5, rel: 0.4 });

export const scThresholdDb = (amt: number): number => SC_THRESHOLD_DB[0] + (SC_THRESHOLD_DB[1] - SC_THRESHOLD_DB[0]) * clamp01(amt);
export const scReleaseSeconds = (rel: number): number => SC_RELEASE_S[0] * (SC_RELEASE_S[1] / SC_RELEASE_S[0]) ** clamp01(rel);
export const formatScRelease = (rel: number): string => `${Math.round(scReleaseSeconds(rel) * 1000)} ms`;
export const formatScAmount = (amt: number): string => `${Math.round(clamp01(amt) * 100)}%`;

/** The track's sidechain in the pattern (older saves and untouched tracks have none: off). */
export const sidechainOf = (tp: { sc?: Sidechain }, track: number): Sidechain => tp.sc ?? newSidechain(track);

/** Whether `track` ducks at all in this pattern. */
export const scActive = (tp: { sc?: Sidechain }): boolean => !!tp.sc?.on;

/** True when making `track` listen to `src` would close a loop: `src` is, through the ducking that is on, already listening to `track`. */
export function scLoops(tracks: ReadonlyArray<{ sc?: Sidechain }>, track: number, src: number): boolean {
  let at = src;
  for (let hops = 0; hops <= tracks.length; hops++) {
    if (at === track) return true;
    const sc = tracks[at]?.sc;
    if (!sc?.on) return false;
    at = sc.src;
  }
  return true;
}

/** A saved sidechain, tidied: every field in range, the source another track. */
export function sanitizeSidechain(raw: unknown, track: number): Sidechain | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Sidechain>;
  const d = newSidechain(track);
  const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? clamp01(v) : def);
  const src = typeof r.src === "number" && Number.isInteger(r.src) && r.src >= 0 && r.src < NUM_TRACKS && r.src !== track ? r.src : d.src;
  return { on: r.on === true, src, amt: num(r.amt, d.amt), rel: num(r.rel, d.rel) };
}

/** Switches off, in place, every sidechain that would be part of a loop (a hand-edited file): the engine refuses a loop, so the page must not hold one. */
export function breakLoops(tracks: Array<{ sc?: Sidechain }>): void {
  tracks.forEach((t, i) => {
    if (t.sc?.on && scLoops(tracks, i, t.sc.src)) t.sc.on = false;
  });
}
