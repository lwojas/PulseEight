// The groovebox controller: transport, lookahead step scheduler, pattern switching/chaining and
// the FX punch-in/write logic. It owns the Groovebox (audio) and keeps the store in sync with what
// is *audible* (the scheduler runs ~120 ms ahead of the speakers).
import { hasEmbeddedHost } from "webdsp";
import { Groovebox, type MixInput } from "./audio";
import type { AudibleStep, HostPlayback } from "./hostplay";
import { laneLayers, layeredTarget, sweepLevel, VERB_ID, VERB_TAIL, type PunchLayer } from "./mangler";
import { editPattern, getState, observe, setState } from "./store";
import { TRACKS } from "./spec";
import { MAX_CHAIN, pickWriteLane, type Pattern } from "./state";
import { MELODIC, StepCompiler, type StepNote } from "./stepcompile";
import { clearLit, flashKey, setLit } from "./keyhl";
import { setAudible } from "./playhead";
import { locateSong } from "./song";
import { withSource } from "./source";
import { startTicker } from "./ticker";

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 10;

const heldLayers = (id: number, lvl: number): PunchLayer[] => (id ? [{ id, lvl }] : []);

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
  /** The punches the chain was last put in the state of (held, or the written lanes layered). */
  private layersApplied: PunchLayer[] = [];
  /** How many written layers the last scheduled step had, so runs of idle steps send nothing (-1 = unknown). */
  private punchScheduled = -1;
  /** The lane each pattern's held punch is being written to; chosen on the first write of a hold. */
  private writeLanes = new Map<number, number>();
  /** Audio time the held punch went down: the sweep level grows from here. */
  private punchSince = 0;
  /** Keep the reverb return open until this audio time so a released VERB rings out. */
  private verbUntil = 0;

  // arpeggiators: one per melodic track, all fed by the same transport grid (the step compiler owns them: held keys go
  // in here, sequencer steps go in through it)
  private compiler = new StepCompiler();
  private arps = this.compiler.arps;
  /** While the transport is stopped the arps walk a free grid of the same step length (tempo-driven),
   * started by the first held key. -1 = not running. */
  private arpFreeTime = -1;
  private arpFreeStep = 0;

  /** The plugin host's transport and native playback, when this host can play Pulse.8 itself (see hostplay.ts). */
  private host: HostPlayback | null = null;

  constructor() {
    observe((next, prev) => this.onState(next, prev));
  }

  get ready(): boolean {
    return this.gb !== null;
  }

  /** The octave shift of a melodic track in the pattern whose sound is audible now. */
  soundOct(track: number): number {
    return this.soundPattern().tracks[track].oct;
  }

  /** The graph's ids and a runtime, for what talks to the engine directly (the MIDI route). Null before the engine is up. */
  get engine(): Groovebox | null {
    return this.gb;
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
      // A plugin that can play the song itself follows the DAW's transport and is handed the song; otherwise (a browser, an older
      // plugin) the page sequences as always.
      // (loaded only here: a browser never needs the native sequence compiler, so it does not download it)
      if (hasEmbeddedHost()) {
        const { HostPlayback, hostPlayback } = await import("./hostplay");
        if (hostPlayback(this.gb)) {
          this.host = new HostPlayback(this.gb, { begin: () => this.hostBegin(), end: () => this.hostEnd(), steps: (steps) => this.audibleSteps(steps) });
          this.host.start();
        }
      }
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
    if (!gb || st.playing) return; // (while a plugin host plays, `playing` is true: the DAW owns the transport)
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
    if (!gb || this.host?.playing) return; // the DAW's transport is not ours to stop
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
    this.applyLayers(heldLayers(held, held ? this.heldLevel(gb.now) : 0));
  }

  togglePlay(): void {
    if (getState().playing) this.stop();
    else this.play();
  }

  // --- plugin host playback (the DAW plays the song; see hostplay.ts) ----------------------------

  /** The DAW started (or jumped). A transport the page was running on its own gives way: the host's sequence plays from here. */
  private hostBegin(): void {
    const gb = this.gb!;
    if (getState().playing) {
      gb.silence();
      gb.clearPending();
      this.events = [];
    }
    this.realignArps();
    this.punchScheduled = -1;
    gb.resetManglerSchedule();
    this.audibleStep = -1;
    this.schedPattern = this.soundPatternIndex();
    setState({ playing: true, cue: null });
  }

  /** The DAW stopped. It releases the sounding voices itself; the page puts the display and the punch chain back to rest. */
  private hostEnd(): void {
    const gb = this.gb!;
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
    this.applyLayers(heldLayers(held, held ? this.heldLevel(gb.now) : 0));
  }

  /** The tempo steps are counted at: the DAW's while it plays. */
  private bpmNow(): number {
    return this.host?.bpm ?? getState().bpm;
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
    this.compiler.realign();
    this.arpFreeTime = -1;
  }

  /** Hand a compiled note to the engine at its audio time, lighting its key when it is an arp note. */
  private playNote = (n: StepNote): void => {
    const gb = this.gb!;
    gb.note(n.track, n.params);
    const flash = n.flashMs;
    if (flash) gb.when(n.params.time, () => flashKey(n.track, flash.note, flash.ms));
  };

  /** Generate the arp notes of every track that has them for the step window starting at `t`. */
  private scheduleArps(t: number, stepDur: number, gridPos: number): void {
    this.compiler.arpNotes(t, stepDur, gridPos, this.soundPattern(), getState(), this.playNote);
  }

  /** Stopped transport: keep the held arps going on their own grid. */
  private runFreeArps(now: number): void {
    const st = getState();
    const live = [...this.arps.values()].some((a) => a.active);
    if (!live) {
      this.arpFreeTime = -1;
      return;
    }
    const host = this.host?.playing ? this.host : null;
    if (host) {
      // while the DAW plays, held keys arpeggiate on its 16th grid, so they line up with the song
      if (this.arpFreeTime < 0) {
        this.arpFreeStep = Math.ceil(host.beatAt(now + 0.005)! * 4);
        this.arpFreeTime = host.timeAt(this.arpFreeStep / 4)!;
      }
      while (this.arpFreeTime < now + LOOKAHEAD) {
        this.scheduleArps(this.arpFreeTime, 15 / host.bpm, this.arpFreeStep);
        this.arpFreeStep++;
        this.arpFreeTime = host.timeAt(this.arpFreeStep / 4)!;
      }
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
    return sweepLevel(st.patterns[pattern].mangler, this.bpmNow(), t - this.punchSince, st.punch);
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
    this.writeLanes.clear();
    const lvl = this.heldLevel(this.punchSince);
    this.applyLayers(heldLayers(id, lvl));
    if (st.playing && st.write && this.audibleStep >= 0) {
      const stepDur = 15 / this.bpmNow();
      const frac = gb ? (gb.now - this.audibleSince) / stepDur : 0;
      // A press late in a step is aimed at the next one; that step is written as it arrives.
      // The press step starts the recorded sweep from its beginning.
      if (frac < 0.65) {
        this.writeFx(st.playPattern, this.audibleStep, id, lvl);
      }
    }
  }

  /** Record a held punch into its lane. The first write of a hold takes the first empty lane; with
   * all three taken, they are wiped and the first is used. */
  private writeFx(pattern: number, step: number, id: number, lvl: number): void {
    editPattern((p) => {
      let lane = this.writeLanes.get(pattern);
      if (lane === undefined) {
        lane = pickWriteLane(p);
        this.writeLanes.set(pattern, lane);
      }
      p.fxLanes[lane].fx[step] = id;
      p.fxLanes[lane].fxLvl[step] = lvl;
    }, pattern);
  }

  punchUp(): void {
    const st = getState();
    const held = st.punch;
    setState({ punch: 0 });
    this.punchScheduled = -1;
    this.writeLanes.clear();
    if (held === VERB_ID && this.gb) this.verbUntil = this.gb.now + VERB_TAIL;
    this.applyLayers(this.writtenLayersNow());
  }

  /** What the written lanes are doing at the step being heard (nothing when stopped or FX are off). */
  private writtenLayersNow(): PunchLayer[] {
    const st = getState();
    if (!st.playing || !st.fxPlay || this.audibleStep < 0) return [];
    return laneLayers(st.patterns[st.playPattern], this.audibleStep);
  }

  clearFxStep(lane: number, step: number): void {
    editPattern((p) => { p.fxLanes[lane].fx[step] = 0; p.fxLanes[lane].fxLvl[step] = 0; });
  }

  clearFxLane(lane: number): void {
    editPattern((p) => { p.fxLanes[lane].fx.fill(0); p.fxLanes[lane].fxLvl.fill(0); });
  }

  clearFxAll(): void {
    editPattern((p) => { for (const l of p.fxLanes) { l.fx.fill(0); l.fxLvl.fill(0); } });
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
      next.arp.forEach((a, t) => { if (!a.on && prev.arp[t].on) this.compiler.forget(t); });
    }
    if (next.bpm !== prev.bpm && next.playing && !this.host?.playing) this.gb.setTempo(next.bpm, this.gridTime, this.gridTime);
    if (next.fxPlay !== prev.fxPlay && next.punch === 0) {
      this.applyLayers(this.writtenLayersNow());
      this.punchScheduled = -1;
    }
    this.host?.onState(next, prev);
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
    // While the DAW plays, the written FX are the host's (they ride the sequence): re-applying the page's idea of the punch chain
    // would cut a ramp that is running. Only a punch the player holds is the page's to apply.
    if (this.host?.playing && getState().punch === 0) gb.applyMix(this.mixInput(false, 0), undefined, "pattern");
    else this.applyLayers(this.layersApplied);
  }

  private mixInput(takeover: boolean, boost: number): MixInput {
    const st = getState();
    return { pattern: this.soundPattern(), mutes: st.mutes, solos: st.solos, takeover, boost };
  }

  /** Put the punch bus in the state for these punches (none = resting). */
  private applyLayers(layers: PunchLayer[], time?: number): void {
    const gb = this.gb;
    if (!gb) return;
    gb.when(time, () => {
      this.layersApplied = layers;
      const keepVerb = layers.length === 0 && gb.now < this.verbUntil;
      const target = layeredTarget(this.soundPattern().mangler, layers, keepVerb);
      gb.applyManglerValues(target.values);
      gb.applyMix(this.mixInput(target.takeover, target.boost));
    });
  }

  /** Written lanes: step `step` of `pat` starts at audio time `t`. The layered chain values go out as
   * scheduled webdsp ramps (each lane's level at this step to its level at the next), the routing at `t`. */
  private scheduleLaneStep(pat: Pattern, step: number, t: number, stepDur: number): void {
    const gb = this.gb!;
    const layers = this.fxOn() ? laneLayers(pat, step) : [];
    const next = this.fxOn() ? laneLayers(pat, (step + 1) % pat.length) : [];
    // A lane keeps ramping into the next step while it holds the same punch there.
    const ahead = layers.map((l) => ({ id: l.id, lvl: next.find((n) => n.id === l.id)?.lvl ?? l.lvl }));
    const hasRamp = ahead.some((l, i) => l.lvl !== layers[i].lvl);
    const a = layeredTarget(pat.mangler, layers);
    const b = hasRamp ? layeredTarget(pat.mangler, ahead) : a;
    gb.scheduleManglerSegment(a.values, b.values, t, hasRamp ? stepDur : 0);
    gb.when(t, () => {
      this.layersApplied = layers;
      gb.applyMix(this.mixInput(a.takeover, a.boost));
    });
  }

  private fxOn(): boolean {
    return getState().fxPlay;
  }

  // --- the clock -----------------------------------------------------------------------------

  private tick(): void {
    const gb = this.gb;
    if (!gb) return;
    gb.tick();
    this.sweepHeldPunch(gb.now);
    if (this.host?.playing) {
      this.host.tick(gb.now);
      this.runFreeArps(gb.now);
      return;
    }
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
      const [on] = this.layersApplied;
      if (this.layersApplied.length !== 1 || on.lvl !== lvl || on.id !== st.punch) this.applyLayers(heldLayers(st.punch, lvl));
    } else if (this.verbUntil && now >= this.verbUntil) {
      this.verbUntil = 0;
      if (this.layersApplied.length === 0) this.applyLayers([]);
    }
  }

  private scheduleStep(): void {
    const st = getState();
    const pat = st.patterns[this.schedPattern];
    const len = pat.length;
    const step = this.step;
    const stepDur = 15 / st.bpm;
    const swingOff = (st.swing - 0.5) * 2 * stepDur;
    const t = this.gridTime + (step % 2 === 1 ? swingOff : 0);

    const notes = this.compiler.step(pat, step, this.stepCount, this.gridTime, { stepDur, swing: st.swing, arp: st.arp }, this.playNote);
    this.events.push({ time: t, step, pattern: this.schedPattern, chainPos: this.chainPos, notes });

    // Written FX. A punch the player is holding right now wins over the written lane.
    if (st.punch !== 0) {
      this.punchScheduled = -1;
    } else {
      const active = st.fxPlay ? laneLayers(pat, step).length : 0;
      if (active !== 0 || this.punchScheduled !== 0) {
        this.punchScheduled = active;
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
    gb.when(time, () => this.applyLayers(this.layersApplied));
  }

  /** Light the keys of the notes now sounding; melodic tracks with no note on this step go dark. */
  private lightKeys(ev: StepEvent): void {
    for (const track of MELODIC) setLit(track, ev.notes.filter(([t]) => t === track).map(([, n]) => n));
  }

  /** Move the store's playhead to what is audible now; record/erase FX as steps pass. */
  private publishAudible(now: number): void {
    const passed: StepEvent[] = [];
    while (this.events.length && this.events[0].time <= now) passed.push(this.events.shift()!);
    this.audibleSteps(passed);
  }

  /** Steps that have been heard (from the lookahead scheduler, or from the host's position), oldest first. */
  private audibleSteps(steps: readonly AudibleStep[]): void {
    let latest: AudibleStep | null = null;
    for (const ev of steps) {
      latest = ev;
      const st = getState();
      if (st.punch !== 0 && st.write) {
        const lvl = this.levelAt(ev.time, ev.pattern);
        this.writeFx(ev.pattern, ev.step, st.punch, lvl);
      } else if (st.erase) {
        editPattern((p) => { for (const l of p.fxLanes) { l.fx[ev.step] = 0; l.fxLvl[ev.step] = 0; } }, ev.pattern);
      }
    }
    if (!latest) return;
    // The host plays the song itself, so the audible pattern is the one to describe (the lookahead scheduler's own cursor runs ahead).
    const moved = this.host?.playing && this.schedPattern !== latest.pattern;
    if (this.host?.playing) this.schedPattern = latest.pattern;
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
    // After a locate the page's own settings may be another pattern's: the sequence repairs them within a bar, this at once.
    if (moved) this.syncNow();
  }
}

export const controller = new Controller();
