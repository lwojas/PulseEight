// What one sequencer step plays: the notes of every track (drums, direct synth notes, notes held into an arpeggiator)
// and the arp notes generated inside the step. Pure: no audio, no clock. Two callers use it with different clocks:
//  - the live scheduler (controller.ts) at the project tempo, handing each note to the engine at its audio time;
//  - the native sequence (nativeseq.ts) at a fixed reference tempo, turning each note's seconds into beats for a host
//    that plays the song itself.
// So what the host plays is by construction what the page would have scheduled.
import type { InstrumentNoteParams } from "webdsp";
import { Arpeggiator, type ArpSettings } from "./arp";
import { NUM_TRACKS, TRACKS } from "./spec";
import { DEFAULT_GATE, GATES, runSteps, trackLast, trackStepAt, type Pattern } from "./state";

export const VEL_NORMAL = 0.7;
export const VEL_ACCENT = 1;
export const MELODIC = TRACKS.filter((t) => t.role !== "drum").map((t) => t.id);

/** A step's gate length in steps (saves from before gates existed have none; so can a stale index). */
export const gateSteps = (gate: number | undefined): number => (GATES[gate ?? DEFAULT_GATE] ?? GATES[DEFAULT_GATE]).len;

/** One note for the engine: `params.time` and `params.duration` are in seconds on the caller's clock. */
export interface StepNote {
  track: number;
  params: InstrumentNoteParams & { time: number };
  /** Arp notes light their piano key for this long (ms) when they sound. Absent for sequencer notes. */
  flashMs?: { note: number; ms: number };
}

export interface StepClock {
  /** Seconds in one 16th step. */
  stepDur: number;
  /** Project swing, 0.5 (straight) .. 0.75. */
  swing: number;
  arp: readonly ArpSettings[];
  /** Random source for the arp's RND direction (the native build seeds it so a loop is repeatable). */
  rnd?: () => number;
}

export class StepCompiler {
  /** Notes the sequencer is holding into each track's arp (its steps feed the arp, held for their gate),
   * as the song step count at which each is released. */
  private seqHolds = new Map<number, Array<{ note: number; end: number }>>();

  constructor(readonly arps: Map<number, Arpeggiator> = new Map(MELODIC.map((t) => [t, new Arpeggiator()]))) {}

  /** The grid restarted (transport start/stop): drop the sequencer's holds and line the arps up again. */
  realign(): void {
    for (const t of this.seqHolds.keys()) this.arps.get(t)?.clear();
    this.seqHolds.clear();
    for (const a of this.arps.values()) a.realign();
  }

  /** An arp was switched off: forget what the sequencer held into it. */
  forget(track: number): void {
    this.arps.get(track)?.clear();
    this.seqHolds.delete(track);
  }

  /**
   * Step `step` of `pat` (`run` steps into the run of this pattern, see `trackStepAt`), which begins on the grid at `gridTime` (seconds; swing moves odd steps later). `stepCount` is the
   * song step count (never wraps), for timing the holds. Calls `emit` for every note, and returns the melodic notes the
   * sequencer starts on this step (to light the piano keys).
   */
  step(pat: Pattern, step: number, run: number, stepCount: number, gridTime: number, clock: StepClock, emit: (n: StepNote) => void): Array<[number, number]> {
    const { stepDur, swing } = clock;
    const swingOff = (swing - 0.5) * 2 * stepDur;
    const t = gridTime + (step % 2 === 1 ? swingOff : 0);
    const nextStart = gridTime + stepDur + ((step + 1) % 2 === 1 ? swingOff : 0);
    const lit: Array<[number, number]> = [];
    const cycle = runSteps(pat);

    for (let track = 0; track < NUM_TRACKS; track++) {
      const spec = TRACKS[track];
      const tp = pat.tracks[track];
      // a track wraps at its own last step; swing and the arp grid stay on the shared pattern step
      const len = trackLast(pat, track);
      const ts = trackStepAt(pat, track, step, run, cycle);
      const s = tp.steps[ts];
      this.releaseHolds(track, stepCount);
      if (!s.on) continue;
      if (spec.role === "drum") {
        emit({ track, params: { time: t, velocity: s.acc ? VEL_ACCENT : VEL_NORMAL, chokeGroup: spec.chokeGroup } });
        continue;
      }
      lit.push([track, s.note]);
      if (clock.arp[track].on) {
        // With the arp on, a step is not played directly: it is held into the arp for its gate, so
        // long gates stack into chords that the arp then walks.
        const holds = this.seqHolds.get(track) ?? [];
        holds.push({ note: s.note, end: stepCount + Math.max(1, Math.ceil(gateSteps(s.gate))) });
        this.seqHolds.set(track, holds);
        this.arps.get(track)?.noteDown(s.note);
        continue;
      }
      const next = tp.steps[(ts + 1) % len];
      const prev = tp.steps[(ts + len - 1) % len];
      const holdsIntoNext = next.on && next.slide;
      emit({
        track,
        params: {
          time: t,
          velocity: s.acc ? VEL_ACCENT : VEL_NORMAL,
          pitch: s.note - (spec.rootMidi ?? 0) + 12 * tp.oct,
          duration: holdsIntoNext ? nextStart - t + 0.015 : stepDur * gateSteps(s.gate),
          tie: s.slide && prev.on,
        },
      });
    }

    this.arpNotes(t, stepDur, step, pat, clock, emit);
    return lit;
  }

  /** The arp notes of every track that has them, for the step window starting at `t`. `gridPos` is the step's position on
   * the grid (the first note lines up with the rate on it). `pat` supplies the octave. */
  arpNotes(t: number, stepDur: number, gridPos: number, pat: Pattern, clock: Pick<StepClock, "arp" | "rnd">, emit: (n: StepNote) => void): void {
    for (const [track, arp] of this.arps) {
      if (!arp.active) continue;
      const cfg = clock.arp[track];
      if (!cfg.on) {
        arp.clear();
        continue;
      }
      const spec = TRACKS[track];
      const oct = pat.tracks[track].oct;
      for (const e of arp.advance(cfg, gridPos, clock.rnd)) {
        const time = t + e.offset * stepDur;
        emit({
          track,
          params: { time, velocity: e.velocity, pitch: e.note - (spec.rootMidi ?? 0) + 12 * oct, duration: e.length * stepDur },
          flashMs: { note: e.note, ms: Math.min(180, e.length * stepDur * 1000) },
        });
      }
    }
  }

  /** Let go of the arp notes whose step gate has run out (those no later step is still holding). */
  private releaseHolds(track: number, stepCount: number): void {
    const holds = this.seqHolds.get(track);
    if (!holds?.length) return;
    const arp = this.arps.get(track);
    const live = holds.filter((h) => h.end > stepCount);
    for (const h of holds) {
      if (h.end <= stepCount && !live.some((l) => l.note === h.note)) arp?.noteUp(h.note);
    }
    this.seqHolds.set(track, live);
  }
}
