// Parameter locks ("p-locks"): a step may override parameters of its track for that step only.
//
// The track's pattern owns the base value of every parameter (the knobs); a step stores just the
// deviations, in `Step.parameterLocks`, keyed by parameter id. The effective value on a step is
//
//     step.parameterLocks?.[id] ?? base
//
// so changing the base moves every step without a lock, and clearing a lock puts the step back on
// the base. Pure: no store, no audio.
//
// A lockable parameter is a `LockParam`; today the track's sound controls are the only ones
// (`instrument.<control key>`, normalised 0..1). Others (track level, sends, ...) opt in by being
// returned from `lockParams`, which the sequencer, the UI and playback all go through.
import { BASS_TRACK, TRACKS } from "./spec";
import type { AppState, Step, TrackPattern } from "./state";

/** What a lock drives: one of the track's sound controls, one of its FX sends, or the acid bass's distortion insert. */
export type LockTarget = { kind: "sound"; control: number } | { kind: "send"; send: "dly" | "rev" } | { kind: "dist" };

export interface LockParam {
  /** Stable id: the key in `Step.parameterLocks` (saved with the project, so never renamed). */
  id: string;
  label: string;
  target: LockTarget;
  /** The base value, normalised 0..1. */
  base(tp: TrackPattern): number;
}

const cache = new Map<number, readonly LockParam[]>();

/** Every parameter of `track` a step can lock: its sound controls (first, in control order), then its delay and reverb sends, then (acid bass only) its distortion. */
export function lockParams(track: number): readonly LockParam[] {
  let list = cache.get(track);
  if (!list) {
    list = [
      ...TRACKS[track].controls.map((c, i): LockParam => ({ id: `instrument.${c.key}`, label: c.label, target: { kind: "sound", control: i }, base: (tp) => tp.sound[i] })),
      { id: "fx.delaySend", label: "DLY", target: { kind: "send", send: "dly" }, base: (tp) => tp.dly.send },
      { id: "fx.reverbSend", label: "REV", target: { kind: "send", send: "rev" }, base: (tp) => tp.rev.send },
      ...(track === BASS_TRACK ? [{ id: "fx.distortion", label: "DIST", target: { kind: "dist" }, base: (tp: TrackPattern) => tp.dist ?? 0 } satisfies LockParam] : []),
    ];
    cache.set(track, list);
  }
  return list;
}

/** The lock parameter behind sound control `control` of `track`. */
export const soundParam = (track: number, control: number): LockParam => lockParams(track)[control];

/** The lock parameter with this id, if the track has it. */
export const lockParam = (track: number, id: string): LockParam | undefined => lockParams(track).find((p) => p.id === id);

/** The step P-LOCK mode is editing on `track`, if any: the selected step of the focused track while the mode is on. */
export function lockStep(s: Pick<AppState, "plock" | "focus" | "selStep" | "patterns" | "pattern">, track: number): Step | undefined {
  return s.plock && s.focus === track && s.selStep >= 0 ? s.patterns[s.pattern].tracks[track].steps[s.selStep] : undefined;
}

/** The value of `param` on `step`: its lock when it has one, else the base. */
export const effectiveValue = (tp: TrackPattern, step: Step | undefined, param: LockParam): number => step?.parameterLocks?.[param.id] ?? param.base(tp);

/** The track's sound as it is on `step` (a new array; the base `tp.sound` when the step has no locks). */
export function effectiveSound(tp: TrackPattern, track: number, step: Step | undefined): number[] {
  if (!hasLocks(step)) return tp.sound;
  return tp.sound.map((_, i) => effectiveValue(tp, step, soundParam(track, i)));
}

export const hasLocks = (step: Step | undefined): boolean => !!step?.parameterLocks && Object.keys(step.parameterLocks).length > 0;

/** Set one lock, leaving the step's other locks alone. Mutates `step`. */
export function setLock(step: Step, id: string, value: number): void {
  (step.parameterLocks ??= {})[id] = Math.min(1, Math.max(0, value));
}

/** Drop all of a step's locks (the step stays). Mutates `step`. */
export function clearLocks(step: Step): void {
  delete step.parameterLocks;
}

/** Locks from a save, cleaned: known parameters of the track only, finite values clamped to 0..1. */
export function sanitizeLocks(track: number, locks: unknown): Record<string, number> | undefined {
  if (!locks || typeof locks !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const p of lockParams(track)) {
    const v = (locks as Record<string, unknown>)[p.id];
    if (typeof v === "number" && Number.isFinite(v)) out[p.id] = Math.min(1, Math.max(0, v));
  }
  return Object.keys(out).length ? out : undefined;
}
