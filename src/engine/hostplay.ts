// Playing inside a plugin host: the DAW owns the transport and the plugin plays the song itself (webdsp native sequence), so the page
// is the editor and the display, not the clock. This module follows the host's transport, keeps the host handed the current song
// (nativeseq.ts), tracks where in the song the host is so the playhead and the FX recorder work, and turns a cued pattern change
// into a swap exactly on a pattern boundary.
//
// It is only created when the host can do all of that (`hostPlayback` below); in a browser, or against an older plugin, the page
// sequences as it always did (controller.ts).
import { hostBeatAt, hostTimeAt, type HostTransport, type Sequence } from "webdsp";
import type { Groovebox } from "./audio";
import { baseLayout, cueLayout, nextBoundary, positionAt, steadySequence, transitionSequence, type Layout, type Song } from "./nativeseq";
import { MELODIC } from "./stepcompile";
import { getState, setState } from "./store";
import { trackStepAt, type AppState } from "./state";

/** A step the host has played, for the playhead, the key lights and the FX recorder. */
export interface AudibleStep {
  /** Runtime time the step began sounding. */
  time: number;
  step: number;
  pattern: number;
  chainPos: number;
  /** Steps into the run of this pattern (see `trackStepAt`). */
  run: number;
  /** Notes the melodic tracks start on it: [track, note]. */
  notes: Array<[number, number]>;
}

export interface HostPlayHooks {
  /** The host started (or jumped): the page's own transport, if it was running, has to give way. */
  begin(): void;
  /** The host stopped. */
  end(): void;
  /** Steps that passed since the last tick, oldest first. */
  steps(steps: AudibleStep[]): void;
}

/** Whether this host can play Pulse.8 itself: it plays a Sequence and takes mixer writes in one (protocol 4). */
export function hostPlayback(gb: Groovebox): boolean {
  const caps = gb.runtime.getCapabilities();
  return caps.nativeSequence === true && (caps.hostProtocolVersion ?? 0) >= 4;
}

/** A cued change is made this far ahead of its boundary at the earliest, so the new sequence has time to reach the host. */
const CUE_LEAD_SECONDS = 0.35;
/** After the boundary, the steady new sequence replaces the transition one. */
const COMMIT_AFTER_BEATS = 0.25;
const PUSH_MS = 60;
/** While a punch is held (and perhaps written) the song is not what changes: send less often. */
const PUSH_HELD_MS = 300;

export class HostPlayback {
  private t: HostTransport | null = null;
  private _playing = false;
  private layout: Layout | null = null;
  private pending: { layout: Layout; boundary: number } | null = null;
  private lastStep = -1;
  private timer: number | undefined;
  private sent = "";
  private off: (() => void) | null = null;

  constructor(private readonly gb: Groovebox, private readonly hooks: HostPlayHooks) {}

  /** The DAW's transport is running. */
  get playing(): boolean {
    return this._playing;
  }

  /** The tempo in effect: the DAW's while it plays, else the project's. */
  get bpm(): number {
    return this._playing && this.t ? this.t.bpm : getState().bpm;
  }

  /** The host's position in quarter notes at runtime time `time`, while it plays. */
  beatAt(time: number): number | null {
    return this._playing && this.t ? hostBeatAt(this.t, time) : null;
  }

  /** The runtime time at which host beat `beat` is heard, while it plays. */
  timeAt(beat: number): number | null {
    return this._playing && this.t ? hostTimeAt(this.t, beat) : null;
  }

  start(): void {
    const rt = this.gb.runtime;
    this.off = rt.onHostTransport((t) => this.onTransport(t));
    const current = rt.getHostTransport();
    if (current) this.onTransport(current);
    this.pushNow();
  }

  dispose(): void {
    this.off?.();
    window.clearTimeout(this.timer);
  }

  private onTransport(t: HostTransport): void {
    const last = this.t;
    this.t = t;
    if (t.playing) {
      if (!this._playing || (last && last.epoch !== t.epoch)) this.begin(t);
      else if (getState().hostBpm !== t.bpm) setState({ hostBpm: t.bpm });
    } else if (this._playing) {
      this._playing = false;
      this.layout = null;
      this.pending = null;
      setState({ hostBpm: null });
      this.hooks.end();
      this.pushNow();
    }
  }

  /** The host started, or jumped (a locate, a loop wrap): the song plays from the host's position, from the layout the project
   * says, so any earlier cue is forgotten. */
  private begin(t: HostTransport): void {
    this._playing = true;
    this.layout = baseLayout(getState());
    this.pending = null;
    this.lastStep = -1;
    setState({ hostBpm: t.bpm });
    this.hooks.begin();
    this.pushNow();
  }

  // ---- following the song ---------------------------------------------------------------------

  /** Called from the page's ticker: reports the steps that have passed since the last call. */
  tick(now: number): void {
    const t = this.t;
    if (!this._playing || !t) return;
    const beat = hostBeatAt(t, now);
    if (this.commitIfPassed(beat)) this.pushNow();
    const patterns = getState().patterns;
    const n = Math.floor(beat * 4 + 1e-6);
    if (this.lastStep < 0 || n < this.lastStep || n - this.lastStep > 32) this.lastStep = n - 1; // first tick, or a jump: just the current step
    const out: AudibleStep[] = [];
    for (let k = this.lastStep + 1; k <= n; k++) {
      const at = k / 4;
      const pos = positionAt(patterns, this.layoutAt(at), at);
      const pat = patterns[pos.pattern];
      const notes: Array<[number, number]> = [];
      for (const track of MELODIC) {
        const s = pat.tracks[track].steps[trackStepAt(pat, track, pos.step, pos.run)];
        if (s.on) notes.push([track, s.note]);
      }
      out.push({ time: hostTimeAt(t, at), step: pos.step, pattern: pos.pattern, chainPos: pos.entry, run: pos.run, notes });
    }
    this.lastStep = n;
    if (out.length) this.hooks.steps(out);
  }

  private layoutAt(beat: number): Layout {
    return this.pending && beat >= this.pending.boundary - 1e-9 ? this.pending.layout : this.layout!;
  }

  /** The cued layout takes over for good once its boundary is behind us. True if it just did (the caller sends the steady sequence). */
  private commitIfPassed(beat: number): boolean {
    if (!this.pending || beat < this.pending.boundary + COMMIT_AFTER_BEATS) return false;
    this.layout = this.pending.layout;
    this.pending = null;
    return true;
  }

  // ---- state changes --------------------------------------------------------------------------

  onState(next: AppState, prev: AppState): void {
    const song =
      next.patterns !== prev.patterns || next.mutes !== prev.mutes || next.solos !== prev.solos || next.arp !== prev.arp ||
      next.swing !== prev.swing || next.fxPlay !== prev.fxPlay || next.punch !== prev.punch;
    // Stopped, the project's own pattern or chain is what a start would play. Playing, the audible pattern moves `pattern`: not a change.
    const where = !this._playing && (next.pattern !== prev.pattern || next.chain !== prev.chain || next.chainOn !== prev.chainOn);
    if (this._playing && (next.chain !== prev.chain || next.chainOn !== prev.chainOn)) {
      this.layout = { ...baseLayout(next), origin: this.layout!.origin };
      this.push(0);
    } else if (song || where) {
      this.push(next.punch !== 0 ? PUSH_HELD_MS : PUSH_MS);
    }
    if (this._playing && next.cue !== prev.cue) this.cued(next.cue);
  }

  /** The player cued a pattern (or took the cue back): swap to it exactly at the next pattern boundary. */
  private cued(cue: number | null): void {
    const t = this.t!;
    const beat = hostBeatAt(t, this.gb.now);
    this.commitIfPassed(beat);
    if (cue === null) {
      // The page clears the cue when the cued pattern is heard: that is the swap happening, not a cancellation.
      if (this.pending) {
        if (beat >= this.pending.boundary - 1e-9) this.layout = this.pending.layout;
        this.pending = null;
        this.push(0);
      }
      return;
    }
    const st = getState();
    const boundary = nextBoundary(st.patterns, this.layout!, beat + (CUE_LEAD_SECONDS * t.bpm) / 60);
    this.pending = { layout: cueLayout(st.patterns, st.chainOn, st.chain, cue, boundary), boundary };
    this.push(0);
  }

  // ---- sending the song -----------------------------------------------------------------------

  private push(delayMs: number): void {
    window.clearTimeout(this.timer);
    if (delayMs <= 0) this.pushNow();
    else this.timer = window.setTimeout(() => this.pushNow(), delayMs);
  }

  /** Sends the sequence for the song as it is now, if it differs from what the host holds. */
  pushNow(): void {
    window.clearTimeout(this.timer);
    const sequence = this.build();
    const json = JSON.stringify(sequence);
    if (json === this.sent) return;
    this.sent = json;
    this.gb.runtime.setSequence(sequence);
  }

  private build(): Sequence | null {
    const st = getState();
    const song: Song = { patterns: st.patterns, mutes: st.mutes, solos: st.solos, swing: st.swing, arp: st.arp, fxPlay: st.fxPlay, lanes: st.punch === 0 };
    const ctx = { ids: this.gb.ids, clamp: this.gb.clampFx };
    if (!this._playing || !this.t) return steadySequence(song, baseLayout(st), ctx);
    const beat = hostBeatAt(this.t, this.gb.now);
    this.commitIfPassed(beat);
    if (this.pending) return transitionSequence(song, this.layout!, this.pending.layout, this.pending.boundary, beat - 0.25, ctx);
    return steadySequence(song, this.layout!, ctx);
  }
}
