// The groovebox controller: transport, lookahead step scheduler, pattern switching/chaining and
// the FX punch-in/write logic. It owns the Groovebox (audio) and keeps the store in sync with what
// is *audible* (the scheduler runs ~120 ms ahead of the speakers).
import { Groovebox, type MixInput } from "./audio";
import { manglerTarget } from "./mangler";
import { editPattern, getState, observe, setState } from "./store";
import { NUM_TRACKS, TRACKS } from "./spec";
import type { Pattern } from "./state";
import { setAudible } from "./playhead";
import { startTicker } from "./ticker";

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 10;
const GATE = 0.62; // fraction of a step a melodic note is held (unless it slides into the next)
const VEL_NORMAL = 0.7;
const VEL_ACCENT = 1;

interface StepEvent {
  time: number;
  step: number;
  pattern: number;
  chainPos: number;
}

class Controller {
  private gb: Groovebox | null = null;

  // scheduler cursor
  private gridTime = 0;
  private step = 0;
  private schedPattern = 0;
  private chainPos = 0;
  private events: StepEvent[] = [];
  /** Audio time the audible step began, to judge where in a step a punch landed. */
  private audibleSince = 0;
  /** The step being heard now. Kept out of the store: it changes every step and only the
   * playhead module (direct DOM writes) needs it. */
  private audibleStep = -1;

  // FX
  private punchApplied = 0;
  private punchScheduled = -1;

  constructor() {
    observe((next, prev) => this.onState(next, prev));
  }

  get ready(): boolean {
    return this.gb !== null;
  }

  // --- start-up (needs a user gesture) -------------------------------------------------------

  async start(): Promise<void> {
    if (this.gb || getState().audio === "starting") return;
    setState({ audio: "starting", audioError: "" });
    try {
      this.gb = await Groovebox.create();
      startTicker(() => this.tick(), TICK_MS);
      setState({ audio: "ready" });
      this.syncNow();
    } catch (err) {
      this.gb = null;
      setState({ audio: "error", audioError: err instanceof Error ? err.message : String(err) });
    }
  }

  // --- transport -----------------------------------------------------------------------------

  play(): void {
    const gb = this.gb;
    const st = getState();
    if (!gb || st.playing) return;
    let idx = st.pattern;
    this.chainPos = 0;
    if (st.chainOn && st.chain.length) idx = st.chain[0];
    this.schedPattern = idx;
    this.step = 0;
    this.gridTime = gb.now + 0.06;
    this.events = [];
    this.punchScheduled = -1;
    this.audibleSince = this.gridTime;
    gb.setTempo(st.bpm, this.gridTime);
    this.audibleStep = -1;
    setAudible(-1, -1);
    setState({ playing: true, playPattern: idx, pattern: idx, cue: null, chainPos: 0 });
    this.syncNow();
  }

  stop(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.silence();
    gb.clearPending();
    this.events = [];
    this.punchScheduled = -1;
    this.audibleStep = -1;
    setAudible(-1, -1);
    setState({ playing: false, cue: null });
    this.applyPunch(getState().punch);
  }

  togglePlay(): void {
    if (getState().playing) this.stop();
    else this.play();
  }

  // --- audible hits for editing --------------------------------------------------------------

  audition(track: number, note?: number): void {
    const gb = this.gb;
    if (!gb) return;
    const spec = TRACKS[track];
    const tp = this.soundPattern().tracks[track];
    if (spec.role === "drum") {
      gb.note(track, { velocity: 0.9, chokeGroup: spec.chokeGroup });
    } else {
      const n = note ?? spec.defaultNote ?? spec.rootMidi ?? 0;
      gb.note(track, { velocity: 0.9, pitch: n - (spec.rootMidi ?? 0) + 12 * tp.oct, duration: 0.28 });
    }
  }

  // --- pattern selection / chain -------------------------------------------------------------

  selectPattern(i: number): void {
    const st = getState();
    if (st.chainEdit) {
      if (st.chain.length < 16) setState({ chain: [...st.chain, i] });
      return;
    }
    if (st.copyArm) {
      if (i !== st.pattern) {
        const copy = structuredClone(st.patterns[st.pattern]);
        const patterns = st.patterns.slice();
        patterns[i] = copy;
        setState({ patterns, copyArm: false });
      } else {
        setState({ copyArm: false });
      }
      return;
    }
    if (st.playing) {
      setState({ cue: i === st.playPattern ? null : i });
    } else {
      setState({ pattern: i, selStep: -1 });
    }
  }

  // --- FX punch ------------------------------------------------------------------------------

  /** A punch pad went down. */
  punchDown(id: number): void {
    const st = getState();
    setState({ punch: id });
    this.applyPunch(id);
    if (st.playing && st.write && this.audibleStep >= 0) {
      const gb = this.gb;
      const stepDur = 15 / st.bpm;
      const frac = gb ? (gb.now - this.audibleSince) / stepDur : 0;
      // A press late in a step is aimed at the next one; that step is written as it arrives.
      if (frac < 0.65) editPattern((p) => { p.fx[this.audibleStep] = id; }, st.playPattern);
    }
  }

  punchUp(): void {
    const st = getState();
    setState({ punch: 0 });
    this.punchScheduled = -1;
    const lane = st.playing && st.fxPlay && this.audibleStep >= 0 ? st.patterns[st.playPattern].fx[this.audibleStep] : 0;
    this.applyPunch(lane);
  }

  clearFxStep(step: number): void {
    editPattern((p) => { p.fx[step] = 0; });
  }

  clearFxAll(): void {
    editPattern((p) => { p.fx.fill(0); });
  }

  // --- state observation ---------------------------------------------------------------------

  private onState(next: ReturnType<typeof getState>, prev: ReturnType<typeof getState>): void {
    if (!this.gb) return;
    if (
      next.patterns !== prev.patterns || next.mutes !== prev.mutes || next.solos !== prev.solos ||
      next.pattern !== prev.pattern
    ) {
      this.syncNow();
    }
    if (next.bpm !== prev.bpm && next.playing) this.gb.setTempo(next.bpm, this.gridTime, this.gridTime);
    if (next.fxPlay !== prev.fxPlay && next.punch === 0) {
      this.applyPunch(next.fxPlay && next.playing && this.audibleStep >= 0 ? next.patterns[next.playPattern].fx[this.audibleStep] : 0);
      this.punchScheduled = -1;
    }
  }

  /** The pattern whose sound is (about to be) audible. */
  private soundPattern(): Pattern {
    const st = getState();
    return st.patterns[st.playing ? this.schedPattern : st.pattern];
  }

  private syncNow(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.applySound(this.soundPattern());
    this.applyPunch(this.punchApplied);
  }

  private mixInput(takeover: boolean, boost: number): MixInput {
    const st = getState();
    return { pattern: this.soundPattern(), mutes: st.mutes, solos: st.solos, takeover, boost };
  }

  /** Put the mangler in the state for punch `id` (0 = resting) at `time` (now if omitted). */
  private applyPunch(id: number, time?: number): void {
    const gb = this.gb;
    if (!gb) return;
    gb.when(time, () => {
      this.punchApplied = id;
      const target = manglerTarget(this.soundPattern().mangler, id);
      gb.applyManglerValues(target.values);
      gb.applyMix(this.mixInput(target.takeover, target.boost));
    });
  }

  // --- the clock -----------------------------------------------------------------------------

  private tick(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.tick();
    if (!getState().playing) return;
    while (this.gridTime < gb.now + LOOKAHEAD) this.scheduleStep();
    this.publishAudible(gb.now);
  }

  private scheduleStep(): void {
    const gb = this.gb!;
    const st = getState();
    const pat = st.patterns[this.schedPattern];
    const len = pat.length;
    const step = this.step;
    const stepDur = 15 / st.bpm;
    const swingOff = (st.swing - 0.5) * 2 * stepDur;
    const t = this.gridTime + (step % 2 === 1 ? swingOff : 0);
    const nextStart = this.gridTime + stepDur + ((step + 1) % 2 === 1 ? swingOff : 0);

    this.events.push({ time: t, step, pattern: this.schedPattern, chainPos: this.chainPos });

    for (let track = 0; track < NUM_TRACKS; track++) {
      const spec = TRACKS[track];
      const tp = pat.tracks[track];
      const s = tp.steps[step];
      if (!s.on) continue;
      if (spec.role === "drum") {
        gb.note(track, { time: t, velocity: s.acc ? VEL_ACCENT : VEL_NORMAL, chokeGroup: spec.chokeGroup });
        continue;
      }
      const next = tp.steps[(step + 1) % len];
      const prev = tp.steps[(step + len - 1) % len];
      const holdsIntoNext = next.on && next.slide;
      gb.note(track, {
        time: t,
        velocity: s.acc ? VEL_ACCENT : VEL_NORMAL,
        pitch: s.note - (spec.rootMidi ?? 0) + 12 * tp.oct,
        duration: holdsIntoNext ? nextStart - t + 0.015 : stepDur * GATE,
        tie: s.slide && prev.on,
      });
    }

    // Written FX. A punch the player is holding right now wins over the written lane.
    if (st.punch !== 0) {
      this.punchScheduled = -1;
    } else {
      const want = st.fxPlay ? pat.fx[step] : 0;
      if (want !== this.punchScheduled) {
        this.punchScheduled = want;
        this.applyPunch(want, t);
      }
    }

    this.gridTime += stepDur;
    this.step++;
    if (this.step >= len) {
      this.step = 0;
      this.advancePattern(this.gridTime);
    }
  }

  /** The cursor wrapped: stay, jump to the cued pattern, or step the chain. */
  private advancePattern(time: number): void {
    const gb = this.gb!;
    const st = getState();
    let next = this.schedPattern;
    if (st.cue !== null) {
      next = st.cue;
      if (st.chainOn) {
        const ix = st.chain.indexOf(next);
        if (ix >= 0) this.chainPos = ix;
      }
    } else if (st.chainOn && st.chain.length) {
      this.chainPos = (this.chainPos + 1) % st.chain.length;
      next = st.chain[this.chainPos];
    }
    if (next === this.schedPattern) return;
    this.schedPattern = next;
    gb.applySound(st.patterns[next], time);
    gb.when(time, () => this.applyPunch(this.punchApplied));
  }

  /** Move the store's playhead to what is audible now; record/erase FX as steps pass. */
  private publishAudible(now: number): void {
    let latest: StepEvent | null = null;
    while (this.events.length && this.events[0].time <= now) {
      const ev = this.events.shift()!;
      latest = ev;
      const st = getState();
      if (st.punch !== 0 && st.write) editPattern((p) => { p.fx[ev.step] = st.punch; }, ev.pattern);
      else if (st.erase) editPattern((p) => { p.fx[ev.step] = 0; }, ev.pattern);
    }
    if (!latest) return;
    this.audibleSince = latest.time;
    this.audibleStep = latest.step;
    setAudible(latest.step, latest.pattern);
    // The store only hears about things that change rarely (pattern, cue, chain position, page);
    // the per-step playhead goes straight to the DOM.
    const st = getState();
    const patch: Partial<typeof st> = {};
    if (st.playPattern !== latest.pattern) patch.playPattern = latest.pattern;
    if (st.chainPos !== latest.chainPos) patch.chainPos = latest.chainPos;
    if (st.pattern !== latest.pattern) patch.pattern = latest.pattern;
    if (st.cue !== null && st.cue === latest.pattern) patch.cue = null;
    if (st.follow && st.page !== Math.floor(latest.step / 16)) patch.page = Math.floor(latest.step / 16);
    if (Object.keys(patch).length) setState(patch);
  }
}

export const controller = new Controller();
