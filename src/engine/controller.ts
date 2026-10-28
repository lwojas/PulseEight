// The groovebox controller: transport, lookahead step scheduler, pattern switching/chaining and
// the FX punch-in/write logic. It owns the Groovebox (audio) and keeps the store in sync with what
// is *audible* (the scheduler runs ~120 ms ahead of the speakers).
import { Arpeggiator } from "./arp";
import { Groovebox, type MixInput } from "./audio";
import { manglerTarget, sweepLevel, VERB_ID, VERB_TAIL } from "./mangler";
import { editPattern, getState, observe, setState } from "./store";
import { NUM_TRACKS, TRACKS } from "./spec";
import { MAX_CHAIN, type Pattern } from "./state";
import { clearLit, flashKey, setLit } from "./keyhl";
import { setAudible } from "./playhead";
import { locateSong } from "./song";
import { withSource } from "./source";
import { startTicker } from "./ticker";

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 10;
const GATE = 0.62; // fraction of a step a melodic note is held (unless it slides into the next)
const VEL_NORMAL = 0.7;
const VEL_ACCENT = 1;
const MELODIC = TRACKS.filter((t) => t.role !== "drum").map((t) => t.id);

interface StepEvent {
  time: number;
  step: number;
  pattern: number;
  chainPos: number;
  /** Notes the melodic tracks start on this step: [track, note] */
  notes: Array<[number, number]>;
}

class Controller {
  private gb: Groovebox | null = null;

  // scheduler cursor
  private gridTime = 0;
  private step = 0;
  /** Steps scheduled since the transport started (plus the song step it started at): never wraps. */
  private stepCount = 0;
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
  private lvlApplied = 1;
  /** Written-lane state last scheduled (id, level) so unchanged steps send nothing. */
  private punchScheduled = -1;
  private lvlScheduled = -1;
  /** Audio time the held punch went down: the sweep level grows from here. */
  private punchSince = 0;
  /** Keep the reverb return open until this audio time so a released VERB rings out. */
  private verbUntil = 0;

  // arpeggiators: one per melodic track, all fed by the same transport grid
  private arps = new Map<number, Arpeggiator>(MELODIC.map((t) => [t, new Arpeggiator()]));
  /** While the transport is stopped the arps walk a free grid of the same step length (tempo-driven),
   * started by the first held key. -1 = not running. */
  private arpFreeTime = -1;
  private arpFreeStep = 0;

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

  /** Start the transport. `from` (an external clock) starts at a song step with step 0 of that position
   * sounding at audio time `time`; without it, from the top, a moment from now. */
  play(from?: { songStep: number; time: number }): void {
    const gb = this.gb;
    const st = getState();
    if (!gb || st.playing) return;
    const at = from ? locateSong(st, from.songStep) : { pattern: st.pattern, chainPos: 0, step: 0 };
    let idx = at.pattern;
    if (!from && st.chainOn && st.chain.length) idx = st.chain[0];
    this.chainPos = at.chainPos;
    this.schedPattern = idx;
    this.step = at.step;
    this.stepCount = from?.songStep ?? 0;
    this.gridTime = from ? Math.max(from.time, gb.now + 0.03) : gb.now + 0.06;
    this.events = [];
    this.punchScheduled = -1;
    this.realignArps();
    gb.resetManglerSchedule();
    this.audibleSince = this.gridTime;
    gb.setTempo(st.bpm, this.gridTime);
    this.audibleStep = -1;
    setAudible(-1, -1);
    setState({ playing: true, playPattern: idx, pattern: idx, cue: null, chainPos: this.chainPos });
    this.syncNow();
  }

  /** Audio time now, or null before the engine is up. */
  get audioNow(): number | null {
    return this.gb ? this.gb.now : null;
  }

  /** External clock: nudge the step grid towards where the clock says song step `songStep` begins
   * (`time`). Only the next steps to be scheduled move; a fraction per call, so clock jitter averages out. */
  followPhase(songStep: number, time: number): void {
    const st = getState();
    if (!st.playing) return;
    const ideal = time + (this.stepCount - songStep) * (15 / st.bpm);
    const err = ideal - this.gridTime;
    const limit = (15 / st.bpm) * 0.5;
    this.gridTime += Math.max(-limit, Math.min(limit, err)) * 0.25;
  }

  stop(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.silence();
    gb.clearPending();
    this.realignArps();
    this.events = [];
    this.punchScheduled = -1;
    gb.resetManglerSchedule();
    this.audibleStep = -1;
    setAudible(-1, -1);
    clearLit();
    setState({ playing: false, cue: null });
    const held = getState().punch;
    this.applyPunch(held, held ? this.heldLevel(gb.now) : 0);
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

  // --- arpeggiator ---------------------------------------------------------------------------
  // The arp is a shared processor between the keyboard and the instrument: held keys go in
  // (`arpDown` / `arpUp`), timed notes come out through the same `gb.note` the sequencer uses.
  // Playing, its notes are generated inside each scheduled transport step; stopped, on a free grid
  // with the same step length. Both read the project tempo as they go, so there is one clock.

  arpDown(track: number, note: number): void {
    this.arps.get(track)?.noteDown(note);
  }

  arpUp(track: number, note: number): void {
    this.arps.get(track)?.noteUp(note);
  }

  private realignArps(): void {
    for (const a of this.arps.values()) a.realign();
    this.arpFreeTime = -1;
  }

  /** Generate the arp notes of every track that has them for the step window starting at `t`. */
  private scheduleArps(t: number, stepDur: number, gridPos: number): void {
    const gb = this.gb!;
    const st = getState();
    for (const [track, arp] of this.arps) {
      if (!arp.active) continue;
      const cfg = st.arp[track];
      if (!cfg.on) { arp.clear(); continue; }
      const spec = TRACKS[track];
      const oct = this.soundPattern().tracks[track].oct;
      for (const e of arp.advance(cfg, gridPos)) {
        const time = t + e.offset * stepDur;
        gb.note(track, {
          time,
          velocity: e.velocity,
          pitch: e.note - (spec.rootMidi ?? 0) + 12 * oct,
          duration: e.length * stepDur,
        });
        gb.when(time, () => flashKey(track, e.note, Math.min(180, e.length * stepDur * 1000)));
      }
    }
  }

  /** Stopped transport: keep the held arps going on their own grid. */
  private runFreeArps(now: number): void {
    const st = getState();
    const live = [...this.arps.values()].some((a) => a.active);
    if (!live) {
      this.arpFreeTime = -1;
      return;
    }
    if (this.arpFreeTime < 0) {
      this.arpFreeTime = now + 0.005;
      this.arpFreeStep = 0;
    }
    while (this.arpFreeTime < now + LOOKAHEAD) {
      const stepDur = 15 / st.bpm;
      this.scheduleArps(this.arpFreeTime, stepDur, this.arpFreeStep);
      this.arpFreeTime += stepDur;
      this.arpFreeStep++;
    }
  }

  // --- pattern selection / chain -------------------------------------------------------------

  selectPattern(i: number): void {
    const st = getState();
    if (st.chainEdit) {
      if (st.chain.length < MAX_CHAIN) setState({ chain: [...st.chain, i] });
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
    this.cuePattern(i);
  }

  /** Go to pattern `i`: cued for the next loop while playing, at once when stopped. */
  cuePattern(i: number): void {
    const st = getState();
    if (st.playing) {
      setState({ cue: i === st.playPattern ? null : i });
    } else {
      setState({ pattern: i, selStep: -1 });
    }
  }

  // --- FX punch ------------------------------------------------------------------------------

  /** Sweep level of the held punch at audio time `t`. */
  private levelAt(t: number, pattern = getState().playing ? this.schedPattern : getState().pattern): number {
    const st = getState();
    return sweepLevel(st.patterns[pattern].mangler, st.bpm, t - this.punchSince, st.punch);
  }

  private heldLevel(now: number): number {
    return this.levelAt(now, this.soundPatternIndex());
  }

  /** A punch pad went down. */
  punchDown(id: number): void {
    const st = getState();
    const gb = this.gb;
    this.punchSince = gb ? gb.now : 0;
    setState({ punch: id, punchSel: id });
    const lvl = this.heldLevel(this.punchSince);
    this.applyPunch(id, lvl);
    if (st.playing && st.write && this.audibleStep >= 0) {
      const stepDur = 15 / st.bpm;
      const frac = gb ? (gb.now - this.audibleSince) / stepDur : 0;
      // A press late in a step is aimed at the next one; that step is written as it arrives.
      // The press step starts the recorded sweep from its beginning.
      if (frac < 0.65) {
        editPattern((p) => { p.fx[this.audibleStep] = id; p.fxLvl[this.audibleStep] = lvl; }, st.playPattern);
      }
    }
  }

  punchUp(): void {
    const st = getState();
    const held = st.punch;
    setState({ punch: 0 });
    this.punchScheduled = -1;
    if (held === VERB_ID && this.gb) this.verbUntil = this.gb.now + VERB_TAIL;
    const lane = st.playing && st.fxPlay && this.audibleStep >= 0 ? st.patterns[st.playPattern].fx[this.audibleStep] : 0;
    const lvl = lane ? st.patterns[st.playPattern].fxLvl[this.audibleStep] : 0;
    this.applyPunch(lane, lvl);
  }

  clearFxStep(step: number): void {
    editPattern((p) => { p.fx[step] = 0; p.fxLvl[step] = 0; });
  }

  clearFxAll(): void {
    editPattern((p) => { p.fx.fill(0); p.fxLvl.fill(0); });
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
    if (next.arp !== prev.arp) {
      next.arp.forEach((a, t) => { if (!a.on && prev.arp[t].on) this.arps.get(t)?.clear(); });
    }
    if (next.bpm !== prev.bpm && next.playing) this.gb.setTempo(next.bpm, this.gridTime, this.gridTime);
    if (next.fxPlay !== prev.fxPlay && next.punch === 0) {
      const on = next.fxPlay && next.playing && this.audibleStep >= 0;
      const lane = on ? next.patterns[next.playPattern] : null;
      this.applyPunch(lane ? lane.fx[this.audibleStep] : 0, lane ? lane.fxLvl[this.audibleStep] : 0);
      this.punchScheduled = -1;
    }
  }

  /** The pattern whose sound is (about to be) audible. */
  private soundPattern(): Pattern {
    return getState().patterns[this.soundPatternIndex()];
  }

  private soundPatternIndex(): number {
    const st = getState();
    return st.playing ? this.schedPattern : st.pattern;
  }

  private syncNow(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.applySound(this.soundPattern());
    this.applyPunch(this.punchApplied, this.lvlApplied);
  }

  private mixInput(takeover: boolean, boost: number): MixInput {
    const st = getState();
    return { pattern: this.soundPattern(), mutes: st.mutes, solos: st.solos, takeover, boost };
  }

  /** Put the punch bus in the state for punch `id` (0 = resting) at sweep level `lvl`. */
  private applyPunch(id: number, lvl = 1, time?: number): void {
    const gb = this.gb;
    if (!gb) return;
    gb.when(time, () => {
      this.punchApplied = id;
      this.lvlApplied = lvl;
      const keepVerb = id === 0 && gb.now < this.verbUntil;
      const target = manglerTarget(this.soundPattern().mangler, id, lvl, keepVerb);
      gb.applyManglerValues(target.values);
      gb.applyMix(this.mixInput(target.takeover, target.boost));
    });
  }

  /** Written lane: step `step` of `pat` starts at audio time `t`. Its chain values go out as
   * scheduled webdsp ramps (the level at this step to the level at the next), the routing at `t`. */
  private scheduleLaneStep(pat: Pattern, step: number, t: number, stepDur: number): void {
    const gb = this.gb!;
    const id = this.punchGate(pat, step);
    const lvl = id ? pat.fxLvl[step] : 0;
    const nextStep = (step + 1) % pat.length;
    const nextId = this.punchGate(pat, nextStep);
    const hasRamp = id !== 0 && nextId === id && pat.fxLvl[nextStep] !== lvl;
    const a = manglerTarget(pat.mangler, id, lvl);
    const b = hasRamp ? manglerTarget(pat.mangler, id, pat.fxLvl[nextStep]) : a;
    gb.scheduleManglerSegment(a.values, b.values, t, hasRamp ? stepDur : 0);
    gb.when(t, () => {
      this.punchApplied = id;
      this.lvlApplied = lvl;
      gb.applyMix(this.mixInput(a.takeover, a.boost));
    });
  }

  private punchGate(pat: Pattern, step: number): number {
    return getState().fxPlay ? pat.fx[step] : 0;
  }

  // --- the clock -----------------------------------------------------------------------------

  private tick(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.tick();
    this.sweepHeldPunch(gb.now);
    if (!getState().playing) {
      this.runFreeArps(gb.now);
      return;
    }
    while (this.gridTime < gb.now + LOOKAHEAD) this.scheduleStep();
    this.publishAudible(gb.now);
  }

  /** While a punch is held its level climbs; push it to the chain every tick until it is full. */
  private sweepHeldPunch(now: number): void {
    const st = getState();
    if (st.punch !== 0) {
      const lvl = this.heldLevel(now);
      if (lvl !== this.lvlApplied || st.punch !== this.punchApplied) this.applyPunch(st.punch, lvl);
    } else if (this.verbUntil && now >= this.verbUntil) {
      this.verbUntil = 0;
      if (this.punchApplied === 0) this.applyPunch(0, 0);
    }
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

    const notes: Array<[number, number]> = [];
    this.events.push({ time: t, step, pattern: this.schedPattern, chainPos: this.chainPos, notes });

    for (let track = 0; track < NUM_TRACKS; track++) {
      const spec = TRACKS[track];
      const tp = pat.tracks[track];
      const s = tp.steps[step];
      if (!s.on) continue;
      if (spec.role === "drum") {
        gb.note(track, { time: t, velocity: s.acc ? VEL_ACCENT : VEL_NORMAL, chokeGroup: spec.chokeGroup });
        continue;
      }
      notes.push([track, s.note]);
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

    this.scheduleArps(t, stepDur, step);

    // Written FX. A punch the player is holding right now wins over the written lane.
    if (st.punch !== 0) {
      this.punchScheduled = -1;
    } else {
      const want = st.fxPlay ? pat.fx[step] : 0;
      const lvl = want ? pat.fxLvl[step] : 0;
      if (want !== this.punchScheduled || lvl !== this.lvlScheduled || want !== 0) {
        this.punchScheduled = want;
        this.lvlScheduled = lvl;
        this.scheduleLaneStep(pat, step, t, stepDur);
      }
    }

    this.gridTime += stepDur;
    this.step++;
    this.stepCount++;
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
    gb.when(time, () => this.applyPunch(this.punchApplied, this.lvlApplied));
  }

  /** Light the keys of the notes now sounding; melodic tracks with no note on this step go dark. */
  private lightKeys(ev: StepEvent): void {
    for (const track of MELODIC) setLit(track, ev.notes.filter(([t]) => t === track).map(([, n]) => n));
  }

  /** Move the store's playhead to what is audible now; record/erase FX as steps pass. */
  private publishAudible(now: number): void {
    let latest: StepEvent | null = null;
    while (this.events.length && this.events[0].time <= now) {
      const ev = this.events.shift()!;
      latest = ev;
      const st = getState();
      if (st.punch !== 0 && st.write) {
        const lvl = this.levelAt(ev.time, ev.pattern);
        editPattern((p) => { p.fx[ev.step] = st.punch; p.fxLvl[ev.step] = lvl; }, ev.pattern);
      } else if (st.erase) editPattern((p) => { p.fx[ev.step] = 0; p.fxLvl[ev.step] = 0; }, ev.pattern);
    }
    if (!latest) return;
    this.audibleSince = latest.time;
    this.audibleStep = latest.step;
    setAudible(latest.step, latest.pattern);
    this.lightKeys(latest);
    // The store only hears about things that change rarely (pattern, cue, chain position, page);
    // the per-step playhead goes straight to the DOM.
    const st = getState();
    const patch: Partial<typeof st> = {};
    if (st.playPattern !== latest.pattern) patch.playPattern = latest.pattern;
    if (st.chainPos !== latest.chainPos) patch.chainPos = latest.chainPos;
    if (st.pattern !== latest.pattern) patch.pattern = latest.pattern;
    if (st.cue !== null && st.cue === latest.pattern) patch.cue = null;
    if (st.follow && st.page !== Math.floor(latest.step / 16)) patch.page = Math.floor(latest.step / 16);
    // the scheduler, not a person, moved these: say so, so MIDI output can follow the pattern change
    if (Object.keys(patch).length) withSource("internal", () => setState(patch));
  }
}

export const controller = new Controller();
