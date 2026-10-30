// The song as a webdsp Sequence, for a plugin host that plays it itself (runtime.setSequence; webdsp docs/native-sequence.md).
// The host repeats one cycle against the DAW's transport on its audio thread, so Pulse.8 keeps playing with the plugin window
// closed, follows locates, loops and tempo, and renders in an offline bounce. The page stays the editor: any change sends the
// whole sequence again, and the host swaps it in at a block boundary.
//
// This is not a second compiler. Every step goes through the StepCompiler the live scheduler uses (stepcompile.ts), at a fixed 120 bpm
// so a second is exactly two quarter notes, and the result is converted to beats; the mixer, sound and FX writes come from the same
// pure functions the live engine applies (audio.ts). What differs is only where tempo comes from: the DAW's, per block.
//
// Time. Beats are quarter notes (the host's PPQ); a 16th step is a quarter of a beat. A `Layout` says what plays: a list of patterns
// (the chain, or the one pattern looping) and an `origin`, the absolute beat at which the layout's first pattern starts. Pulse.8's song
// position at DAW beat P is `(P - origin) mod cycle`, so a DAW that starts at bar 1 plays the song from its start and a locate lands
// where the song is, as a MIDI Song Position Pointer does. A cued pattern change is a new layout whose origin puts the cued pattern's
// first step on the next pattern boundary; the host swaps sequences at an arbitrary block, so the swap itself goes through
// `transitionSequence`, which holds the old pattern's remaining steps and the new layout in one cycle.
//
// What is baked into the sequence, and what is not:
//  - notes (drums, bass, FM, arps rendered from the sequencer's own notes; the RND arp direction uses a fixed seed so a loop repeats);
//  - the per-pattern state that differs between the layout's patterns (sound, levels, mutes, sends, track FX), written at each pattern's
//    start and at every bar so a locate into the middle of a pattern is repaired within a bar. State that is the same everywhere is
//    left to the page's immediate writes, so a single looping pattern carries none at all;
//  - the written FX lanes: per step, the punch chain's values (ramping across the step as the live scheduler does) and the punch
//    section's sends, each reset to rest on the first step without it.
// Not baked: a punch held by the player (it is performed live through the page, and the lanes are left out while it is held, as the
// live scheduler lets a held punch win), and live keyboard arpeggios.
import type { Sequence, SequenceEvent } from "webdsp";
import { Arpeggiator } from "./arp";
import { lockWrites, manglerWrites, mixWrites, soundWrites, trackFxWrites, type GraphIds, type Write } from "./audio";
import { baseValues, laneLayers, layeredTarget, MANGLER_KEYS, type ManglerKey } from "./mangler";
import { lockParams } from "./plock";
import { NUM_TRACKS } from "./spec";
import { StepCompiler, MELODIC, type StepNote } from "./stepcompile";
import type { ArpSettings } from "./arp";
import { trackLast, trackStepAt, type Pattern } from "./state";

/** The tempo the compile runs at: 120 bpm makes a second exactly two quarter notes. */
const REF_STEP_SECONDS = 15 / 120;
const BEATS_PER_SECOND = 2;
const STEP_BEATS = 0.25;
const BAR_BEATS = 4;

export interface Layout {
  /** Pattern indices, played one after another and repeated (the chain, or one pattern looping). */
  patterns: readonly number[];
  /** The absolute beat (DAW position) at which the first pattern starts. */
  origin: number;
}

/** What a sequence is built from: the project, the live mixer, and which parts of the FX to include. */
export interface Song {
  patterns: readonly Pattern[];
  mutes: readonly boolean[];
  solos: readonly boolean[];
  swing: number;
  arp: readonly ArpSettings[];
  /** Written FX lanes play (the FX PLAY switch). */
  fxPlay: boolean;
  /** Include the lanes at all: false while the player holds a punch, which then owns the chain. */
  lanes: boolean;
}

export interface NativeCtx {
  ids: GraphIds;
  /** Keeps an effect value inside its parameter's range. */
  clamp: (param: number, value: number) => number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const round = (b: number) => Math.round(b * 1e6) / 1e6;
const beatsOf = (p: Pattern) => p.length * STEP_BEATS;

interface Entry {
  pattern: number;
  /** Beats from the layout's start. */
  start: number;
  beats: number;
}

function entriesOf(song: Pick<Song, "patterns">, layout: Layout): { entries: Entry[]; cycle: number } {
  const entries: Entry[] = [];
  let at = 0;
  for (const pattern of layout.patterns) {
    const beats = beatsOf(song.patterns[pattern]);
    entries.push({ pattern, start: at, beats });
    at += beats;
  }
  return { entries, cycle: at };
}

/** The pattern a layout repeats for good (a looping pattern, or a chain of one pattern), if it is just one. Its run never restarts, so a track
 * shorter than the pattern loops on its own through the repeats; any other layout starts each pattern's tracks afresh (`trackStepAt`). */
function repeated(layout: Layout): number | null {
  const first = layout.patterns[0];
  return first !== undefined && layout.patterns.every((p) => p === first) ? first : null;
}

/** Beats in one cycle of the layout. */
export const cycleBeats = (patterns: readonly Pattern[], layout: Layout): number => entriesOf({ patterns }, layout).cycle;

/** The layout a stopped transport would start from: the chain when it is on, otherwise the selected pattern looping. */
export function baseLayout(s: { chainOn: boolean; chain: readonly number[]; pattern: number }): Layout {
  return { patterns: s.chainOn && s.chain.length ? [...s.chain] : [s.pattern], origin: 0 };
}

export interface SongPos {
  /** Index into the layout's patterns (the chain position). */
  entry: number;
  pattern: number;
  /** Step within the pattern, and how far into it (0..1 of a step). */
  step: number;
  frac: number;
  /** Steps into this pattern's run: counted from the layout's start when it is one pattern repeated, else the step itself (see `trackStepAt`). */
  run: number;
}

/** Where the song is at absolute beat `beat`. */
export function positionAt(patterns: readonly Pattern[], layout: Layout, beat: number): SongPos {
  const { entries, cycle } = entriesOf({ patterns }, layout);
  const x = mod(beat - layout.origin, cycle);
  let entry = entries.findIndex((e) => x < e.start + e.beats - 1e-9);
  if (entry < 0) entry = entries.length - 1;
  const e = entries[entry];
  const inPattern = Math.max(0, x - e.start) / STEP_BEATS;
  const step = Math.min(Math.floor(inPattern + 1e-9), patterns[e.pattern].length - 1);
  const run = repeated(layout) === null ? step : Math.floor((beat - layout.origin) / STEP_BEATS + 1e-9);
  return { entry, pattern: e.pattern, step, frac: Math.max(0, inPattern - step), run };
}

/** The first pattern boundary at or after absolute beat `min`: where a cued change can take effect. */
export function nextBoundary(patterns: readonly Pattern[], layout: Layout, min: number): number {
  const { entries, cycle } = entriesOf({ patterns }, layout);
  const base = layout.origin + Math.floor((min - layout.origin) / cycle) * cycle;
  for (let n = 0; n < 3; n++) {
    for (const e of entries) {
      const end = base + n * cycle + e.start + e.beats;
      if (end >= min - 1e-9) return end;
    }
  }
  return min;
}

/** The layout after cueing `cued` at `boundary`: the chain from the cued pattern's place in it, or the pattern alone. */
export function cueLayout(patterns: readonly Pattern[], chainOn: boolean, chain: readonly number[], cued: number, boundary: number): Layout {
  if (chainOn && chain.length) {
    const ix = chain.indexOf(cued);
    if (ix >= 0) {
      const offset = chain.slice(0, ix).reduce((sum, p) => sum + beatsOf(patterns[p]), 0);
      return { patterns: [...chain], origin: boundary - offset };
    }
  }
  return { patterns: [cued], origin: boundary };
}

// ---- events ------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noteEvent(n: StepNote, ids: GraphIds): SequenceEvent {
  const p = n.params;
  return {
    beat: p.time * BEATS_PER_SECOND,
    kind: "instrument",
    instrument: ids.inst[n.track],
    ...(p.velocity !== undefined ? { velocity: p.velocity } : {}),
    ...(p.pitch ? { pitch: p.pitch } : {}),
    ...(p.duration !== undefined ? { durationBeats: p.duration * BEATS_PER_SECOND } : {}),
    ...(p.chokeGroup !== undefined ? { chokeGroup: p.chokeGroup } : {}),
    ...(p.tie ? { tie: true } : {}),
  };
}

function writeEvent(w: Write, beat: number, ramp?: { from: number; beats: number }): SequenceEvent {
  const target = w.kind === "bus" ? { bus: w.bus } : w.kind === "fx" ? { effect: { bus: w.bus, effect: w.effect } } : { instrument: w.instrument };
  return { beat, kind: "param", target, param: w.param, value: w.value, ...(ramp ? { from: ramp.from, rampBeats: ramp.beats } : {}) };
}

/** The per-pattern state that travels with a pattern: sound, track FX, and the mixer's faders and sends (mutes folded in). */
function patternState(song: Song, pattern: number, ctx: NativeCtx): Write[] {
  const p = song.patterns[pattern];
  const mix = { pattern: p, mutes: song.mutes, solos: song.solos, takeover: false, boost: 0 };
  return [
    ...soundWrites(ctx.ids, p).map((w) => ({ ...w, key: `i${w.key}` })),
    ...trackFxWrites(ctx.ids, p, ctx.clamp).map((w) => ({ ...w, key: `f${w.key}` })),
    ...mixWrites(ctx.ids, mix, "pattern").map((w) => ({ ...w, key: `b${w.key}` })),
  ];
}

const sameWrites = (a: Write[], b: Write[]) => a.length === b.length && a.every((w, i) => w.key === b[i].key && w.value === b[i].value);

/** One cycle of the layout, with beats counted from the layout's start (not yet shifted by its origin, and not wrapped: a note
 * or ramp near the end may carry past it). */
function cycleEvents(song: Song, layout: Layout, ctx: NativeCtx): Loop & { loops: Loop[] } {
  const { entries, cycle } = entriesOf(song, layout);
  const events: SequenceEvent[] = [];

  // notes: the same step compile the live scheduler uses, one pattern after another
  const compiler = new StepCompiler(new Map(MELODIC.map((t) => [t, new Arpeggiator()])));
  const clock = { stepDur: REF_STEP_SECONDS, swing: song.swing, arp: song.arp, rnd: mulberry32(0x9e3779b9) };
  // A pattern that repeats for good lets its shorter tracks loop on their own: each becomes a loop of its own length (below) and is left
  // out of the cycle. In any other layout a pattern is played once per cycle, so a shorter track just wraps inside it.
  const looped = repeated(layout);
  const apart = new Set<number>(looped === null ? [] : polymetric(song.patterns[looped]));
  let stepCount = 0;
  for (const e of entries) {
    const pat = song.patterns[e.pattern];
    for (let s = 0; s < pat.length; s++) {
      compiler.step(pat, s, s, stepCount++, (e.start / STEP_BEATS + s) * REF_STEP_SECONDS, clock, (n) => events.push(noteEvent(n, ctx.ids)), (t) => !apart.has(t));
    }
  }

  // per-pattern state, only where the patterns disagree
  const stateFrom = events.length;
  if (entries.length > 1) {
    const states = entries.map((e) => patternState(song, e.pattern, ctx));
    const varying = new Set<string>();
    for (const st of states) {
      for (const w of st) {
        const first = states[0].find((x) => x.key === w.key);
        if (!first || first.value !== w.value) varying.add(w.key);
      }
    }
    if (varying.size && !states.every((st) => sameWrites(st, states[0]))) {
      entries.forEach((e, k) => {
        const bars = Math.ceil(e.beats / BAR_BEATS - 1e-9);
        for (let j = 0; j < bars; j++) for (const w of states[k]) if (varying.has(w.key)) events.push(writeEvent(w, e.start + j * BAR_BEATS));
      });
    }
  }

  // parameter locks; where one lands on a beat a per-bar state write also covers, the lock is what plays
  const locks = lockEvents(song, entries, ctx, apart);
  if (locks.length) {
    const at = (e: SequenceEvent) => (e.kind === "param" ? `${e.beat}|${JSON.stringify(e.target)}|${e.param}` : "");
    const taken = new Set(locks.map(at));
    const kept = events.slice(stateFrom).filter((e) => !taken.has(at(e)));
    events.length = stateFrom;
    events.push(...kept, ...locks);
  }

  // written FX lanes
  if (song.lanes && song.fxPlay) laneEvents(song, entries, ctx, events);

  const loops = [...apart].map((t) => trackLoop(song, looped!, t, ctx));
  return { events, beats: cycle, loops };
}

/** The tracks shorter than their pattern. */
const polymetric = (pat: Pattern): number[] => pat.tracks.map((_, t) => t).filter((t) => trackLast(pat, t) < pat.length);

/**
 * One polymetric track as a cycle of its own: its last step's worth of steps, repeating on the DAW timeline beside the pattern, so it drifts
 * against the other tracks for as long as it should. Position in the cycle is the step count since the layout's start (the caller shifts it
 * by the origin), which is what the live scheduler's `run` is. The grid has to line up too, and swing moves odd steps of the *grid*, so a
 * track of odd length plays two laps before the cycle repeats.
 */
function trackLoop(song: Song, pattern: number, track: number, ctx: NativeCtx): Loop {
  const pat = song.patterns[pattern];
  const last = trackLast(pat, track);
  const steps = last % 2 === 0 ? last : last * 2;
  const compiler = new StepCompiler(new Map(MELODIC.map((t) => [t, new Arpeggiator()])));
  const clock = { stepDur: REF_STEP_SECONDS, swing: song.swing, arp: song.arp, rnd: mulberry32(0x9e3779b9) };
  const events: SequenceEvent[] = [];
  const slots: LockSlot[] = [];
  for (let g = 0; g < steps; g++) {
    compiler.step(pat, g, g, g, g * REF_STEP_SECONDS, clock, (n) => events.push(noteEvent(n, ctx.ids)), (t) => t === track);
    slots.push({ pat, step: g % last, beat: g * STEP_BEATS + (g % 2 === 1 ? swingBeatsOf(song) : 0) });
  }
  events.push(...trackLockEvents(track, slots, ctx));
  return { events, beats: steps * STEP_BEATS };
}

const swingBeatsOf = (song: Pick<Song, "swing">) => (song.swing - 0.5) * 2 * STEP_BEATS;

/** A step of one track, for its parameter locks: the step that plays (`step`) and the beat it plays at. */
interface LockSlot {
  pat: Pattern;
  step: number;
  beat: number;
}

/** A cycle that repeats on its own length. */
interface Loop {
  events: SequenceEvent[];
  beats: number;
}

/** Parameter locks: on a step, each locked parameter is written at the step's (swung) beat; on the step after, a parameter the
 * step before had locked is written back to its base. The step before a cycle's first is its last, so a lock on the last step is undone
 * on the loop. The same rule as the live scheduler (`Groovebox.scheduleLocks`). Tracks in `skip` are looped apart and handle their own. */
function lockEvents(song: Song, entries: Entry[], ctx: NativeCtx, skip: ReadonlySet<number>): SequenceEvent[] {
  const out: SequenceEvent[] = [];
  const swingBeats = swingBeatsOf(song);
  for (let t = 0; t < NUM_TRACKS; t++) {
    if (skip.has(t)) continue;
    const slots: LockSlot[] = [];
    for (const e of entries) {
      const pat = song.patterns[e.pattern];
      for (let s = 0; s < pat.length; s++) {
        slots.push({ pat, step: trackStepAt(pat, t, s, s), beat: e.start + s * STEP_BEATS + (s % 2 === 1 ? swingBeats : 0) });
      }
    }
    out.push(...trackLockEvents(t, slots, ctx));
  }
  return out;
}

/** One track's lock events over a cycle of its steps in order (the one before the first is the last). */
function trackLockEvents(t: number, slots: readonly LockSlot[], ctx: NativeCtx): SequenceEvent[] {
  const out: SequenceEvent[] = [];
  slots.forEach(({ pat, step, beat }, g) => {
    const prev = slots[(g + slots.length - 1) % slots.length];
    const locks = pat.tracks[t].steps[step].parameterLocks;
    const before = prev.pat.tracks[t].steps[prev.step].parameterLocks;
    if (!locks && !before) return;
    for (const p of lockParams(t)) {
      const locked = locks?.[p.id];
      if (locked !== undefined) for (const w of lockWrites(ctx.ids, t, p, locked)) out.push(writeEvent(w, beat));
      else if (before?.[p.id] !== undefined) for (const w of lockWrites(ctx.ids, t, p, p.base(pat.tracks[t]))) out.push(writeEvent(w, beat));
    }
  });
  return out;
}

/** The written lanes: per step, the layered punch chain (a ramp across the step where a lane's level moves) and the punch section's
 * sends. A value is written while it is off rest, and once more (back to rest) on the first step it is not. */
function laneEvents(song: Song, entries: Entry[], ctx: NativeCtx, events: SequenceEvent[]): void {
  const flat: Array<{ e: Entry; s: number }> = [];
  for (const e of entries) for (let s = 0; s < song.patterns[e.pattern].length; s++) flat.push({ e, s });
  if (!flat.some(({ e, s }) => laneLayers(song.patterns[e.pattern], s).length)) return;

  const rest = baseValues();
  const restMix = new Map(mixWrites(ctx.ids, { pattern: song.patterns[0], mutes: [], solos: [], takeover: false, boost: 0 }, "punch").map((w) => [w.key, w.value]));

  /** What step `s` of `pat` does: the chain at its start and where it ramps to by the next step, and the punch section's state. */
  const segment = (pat: Pattern, s: number) => {
    const layers = laneLayers(pat, s);
    const next = laneLayers(pat, (s + 1) % pat.length);
    // A lane keeps ramping into the next step while it holds the same punch there.
    const ahead = layers.map((l) => ({ id: l.id, lvl: next.find((n) => n.id === l.id)?.lvl ?? l.lvl }));
    const ramps = ahead.some((l, i) => l.lvl !== layers[i].lvl);
    const a = layeredTarget(pat.mangler, layers);
    const b = ramps ? layeredTarget(pat.mangler, ahead) : a;
    const off = new Set<ManglerKey>(MANGLER_KEYS.filter((k) => a.values[k] !== rest[k] || b.values[k] !== rest[k]));
    return { a, b, ramps, off, active: layers.length > 0 };
  };

  const swingBeats = (song.swing - 0.5) * 2 * STEP_BEATS;
  flat.forEach(({ e, s }, g) => {
    const pat = song.patterns[e.pattern];
    const prev = flat[(g + flat.length - 1) % flat.length];
    const cur = segment(pat, s);
    const before = segment(song.patterns[prev.e.pattern], prev.s);
    if (!cur.active && !before.active) return;
    const beat = e.start + s * STEP_BEATS + (s % 2 === 1 ? swingBeats : 0);

    const write = (values: typeof cur.a.values) => manglerWrites(ctx.ids, values, ctx.clamp);
    const wa = write(cur.a.values);
    const wb = cur.ramps ? write(cur.b.values) : wa;
    wa.forEach((w, i) => {
      const key = MANGLER_KEYS[i];
      if (!cur.off.has(key) && !before.off.has(key)) return;
      events.push(cur.ramps && w.value !== wb[i].value ? writeEvent(wb[i], beat, { from: w.value, beats: STEP_BEATS }) : writeEvent(w, beat));
    });

    // the punch section's sends: takeover cuts each punched track's dry signal and feeds it all to the chain, else the sends lift
    const mix = (t: { takeover: boolean; boost: number }) => mixWrites(ctx.ids, { pattern: pat, mutes: [], solos: [], takeover: t.takeover, boost: t.boost }, "punch");
    const sends = mix(cur.a);
    const was = new Map(mixWrites(ctx.ids, { pattern: song.patterns[prev.e.pattern], mutes: [], solos: [], takeover: before.a.takeover, boost: before.a.boost }, "punch").map((w) => [w.key, w.value]));
    for (const w of sends) {
      if (w.value !== restMix.get(w.key) || was.get(w.key) !== restMix.get(w.key)) events.push(writeEvent(w, beat));
    }
  });
}

const shifted = (events: SequenceEvent[], by: number, length: number): SequenceEvent[] =>
  events.map((e) => ({ ...e, beat: round(mod(e.beat + by, length)) }));

/** One cycle of the layout as a Sequence for a host that repeats it against its own timeline, or null when it has nothing to play. */
export function steadySequence(song: Song, layout: Layout, ctx: NativeCtx): Sequence | null {
  const { events, beats, loops } = cycleEvents(song, layout, ctx);
  if ((!events.length && !loops.length) || beats <= 0) return null;
  return {
    lengthBeats: beats,
    events: shifted(events, layout.origin, beats),
    ...(loops.length ? { loops: loops.map((l) => ({ lengthBeats: l.beats, events: shifted(l.events, layout.origin, l.beats) })) } : {}),
  };
}

/** The moment a cued change takes effect, as one sequence (no loops: the window is laid out event by event). The host swaps at an arbitrary block, so a sequence that simply
 * becomes the new layout would play the new pattern's tail up to the boundary. This one holds the old layout's events from
 * `from` (absolute beat, a little before now) to `boundary` and the new layout's from there, in a cycle long enough that the two do
 * not meet; the page sends the steady new sequence once the boundary has passed. Each event's place in the cycle is its absolute
 * beat modulo the cycle length, which is a multiple of the new layout's, so the new pattern stays in phase if the page is
 * gone before it can send the cleanup. */
export function transitionSequence(song: Song, from: Layout, to: Layout, boundary: number, fromBeat: number, ctx: NativeCtx): Sequence | null {
  const a = cycleEvents(song, from, ctx);
  const b = cycleEvents(song, to, ctx);
  if (a.beats <= 0 || b.beats <= 0) return null;
  const window = boundary - fromBeat;
  const length = b.beats * Math.max(2, Math.ceil((window + 2 * b.beats) / b.beats));
  const out: SequenceEvent[] = [];
  const place = (list: SequenceEvent[], layout: Layout, cycle: number, lo: number, hi: number) => {
    for (const e of list) {
      const first = Math.ceil((lo - e.beat - layout.origin) / cycle - 1e-9);
      for (let n = first; ; n++) {
        const abs = e.beat + layout.origin + n * cycle;
        if (abs >= hi - 1e-9) break;
        out.push({ ...e, beat: round(mod(abs, length)) });
      }
    }
  };
  // the loops of polymetric tracks are laid out in the window too, so the old ones stop at the boundary and the new ones start on it
  for (const c of [a, ...a.loops]) place(c.events, from, c.beats, fromBeat, boundary);
  for (const c of [b, ...b.loops]) place(c.events, to, c.beats, boundary, fromBeat + length);
  return out.length ? { lengthBeats: length, events: out } : null;
}
