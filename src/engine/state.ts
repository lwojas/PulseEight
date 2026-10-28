// The whole application state, and the pure functions that edit a pattern.
// Nothing here touches audio or React.
import { defaultSound, DRUM_TRACKS, NUM_TRACKS, TRACKS, BASS_TRACK, TONE_TRACK } from "./spec";
import { defaultMangler } from "./mangler";
import { defaultScale, isChromatic, notesInRange, rootAtOrAbove, type ProjectScale } from "./scale";
import { newDelay, newReverb, type DelaySend, type ReverbSend } from "./trackfx";

export const MAX_STEPS = 64;
export const PAGE = 16;
export const NUM_PATTERNS = 16;
export const MAX_CHAIN = 16;
export const LENGTHS = [16, 32, 48, 64] as const;

export interface Step {
  on: boolean;
  /** MIDI note (melodic tracks only). */
  note: number;
  /** Accent: harder hit; on the bass it also opens the filter via velocity-driven bite. */
  acc: boolean;
  /** Slide: glide into this note from the previous one (melodic tracks only). */
  slide: boolean;
}

export interface TrackPattern {
  steps: Step[];
  /** Normalised 0..1 per control of the track's spec. */
  sound: number[];
  level: number;
  /** Track sends (mixing): delay and reverb. */
  dly: DelaySend;
  rev: ReverbSend;
  /** Octave shift for melodic tracks. */
  oct: number;
  /** Name of the preset last loaded into this track (cosmetic). */
  preset: string;
}

export interface ManglerBase {
  /** Index into `SWEEPS`: how long a held punch takes to reach full effect. */
  sweep: number;
  /** Character parameter per punch id (index 0 unused), normalised 0..1. */
  param: number[];
}

export interface Pattern {
  length: number;
  tracks: TrackPattern[];
  /** Written FX, one punch id per step (0 = none). */
  fx: number[];
  /** Sweep level 0..1 of the written punch at the start of each step (the recorded automation). */
  fxLvl: number[];
  mangler: ManglerBase;
}

export type Tab = "seq" | "sound" | "mix" | "fx" | "ptn";

export interface AppState {
  // persisted
  /** Name of the loaded or last-saved project; empty for an unsaved one. */
  projectName: string;
  patterns: Pattern[];
  chain: number[];
  chainOn: boolean;
  bpm: number;
  swing: number;
  pattern: number;
  /** The project key: shapes the synth keyboards. */
  scale: ProjectScale;
  // performance state
  mutes: boolean[];
  solos: boolean[];
  focus: number;
  page: number;
  selStep: number;
  follow: boolean;
  /** Light piano keys as they are played (manually or by the sequencer). */
  keyHighlight: boolean;
  tab: Tab;
  // transport
  audio: "off" | "starting" | "ready" | "error";
  audioError: string;
  playing: boolean;
  playPattern: number;
  chainPos: number;
  cue: number | null;
  // FX performance
  fxPlay: boolean;
  write: boolean;
  erase: boolean;
  /** Punch id currently held by the player (0 = none). */
  punch: number;
  /** Punch whose character parameter is shown (the last one pressed). */
  punchSel: number;
  // pattern bank tools
  chainEdit: boolean;
  copyArm: boolean;
}

const emptyStep = (note: number): Step => ({ on: false, note, acc: false, slide: false });

export function newTrackPattern(track: number): TrackPattern {
  const spec = TRACKS[track];
  return {
    steps: Array.from({ length: MAX_STEPS }, () => emptyStep(spec.defaultNote ?? 0)),
    sound: defaultSound(spec),
    level: DEFAULT_LEVELS[track],
    dly: newDelay(track),
    rev: newReverb(track),
    oct: 0,
    preset: "",
  };
}

export const DEFAULT_LEVELS = [0.85, 0.75, 0.55, 0.55, 0.7, 0.6, 0.78, 0.62];

export function newPattern(): Pattern {
  return {
    length: 16,
    tracks: Array.from({ length: NUM_TRACKS }, (_, i) => newTrackPattern(i)),
    fx: new Array(MAX_STEPS).fill(0),
    fxLvl: new Array(MAX_STEPS).fill(0),
    mangler: defaultMangler(),
  };
}

export const clonePattern = (p: Pattern): Pattern => structuredClone(p);

// --- a groove to start from ------------------------------------------------------------------

const hits = (p: Pattern, track: number, steps: number[], acc: number[] = []) => {
  for (const s of steps) p.tracks[track].steps[s].on = true;
  for (const s of acc) p.tracks[track].steps[s].acc = true;
};

const line = (p: Pattern, track: number, notes: Array<[step: number, note: number, flags?: string]>) => {
  for (const [s, note, flags = ""] of notes) {
    const st = p.tracks[track].steps[s];
    st.on = true;
    st.note = note;
    st.acc = flags.includes("a");
    st.slide = flags.includes("s");
  }
};

export function demoPattern(): Pattern {
  const p = newPattern();
  hits(p, 0, [0, 4, 8, 12], [0, 8]);
  hits(p, 1, [4, 12], [12]);
  hits(p, 2, [0, 2, 4, 6, 8, 10, 12, 14, 15], [2, 10]);
  hits(p, 3, [6, 14]);
  hits(p, 4, [4, 12, 13]);
  hits(p, 5, [3, 7, 11, 14], [7]);
  line(p, BASS_TRACK, [
    [0, 24, "a"], [2, 24], [3, 36, "s"], [6, 27, "a"], [8, 24], [10, 31, "s"], [11, 29], [14, 27, "a"], [15, 36, "s"],
  ]);
  line(p, TONE_TRACK, [[0, 55], [3, 58], [7, 62, "a"], [10, 58], [12, 55]]);
  // start with a bright kit and acid preset values (loaded by the presets module at boot)
  p.tracks[TONE_TRACK].level = 0.55;
  return p;
}

// --- pattern edits (pure; each returns a new pattern) -----------------------------------------

export function withPattern(p: Pattern, edit: (draft: Pattern) => void): Pattern {
  const d = clonePattern(p);
  edit(d);
  return d;
}

export function clearTrackSteps(p: Pattern, track: number) {
  const spec = TRACKS[track];
  for (const s of p.tracks[track].steps) {
    s.on = false;
    s.acc = false;
    s.slide = false;
    s.note = spec.defaultNote ?? 0;
  }
}

/** A quick, musical starting point for one track (the RND button). */
export function randomizeTrack(p: Pattern, track: number, rnd: () => number = Math.random, key?: ProjectScale) {
  const spec = TRACKS[track];
  const len = p.length;
  clearTrackSteps(p, track);
  const steps = p.tracks[track].steps;
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  if (spec.role === "drum") {
    const density: Record<number, number[]> = {
      0: [0.9, 0.05, 0.35, 0.05],
      1: [0, 0.8, 0.05, 0.8],
      2: [0.5, 0.9, 0.5, 0.9],
      3: [0.02, 0.45, 0.02, 0.2],
      4: [0, 0.6, 0.05, 0.5],
      5: [0.2, 0.3, 0.3, 0.35],
    };
    const d = density[track] ?? [0.3, 0.3, 0.3, 0.3];
    for (let i = 0; i < len; i++) {
      const beatPos = i % 4;
      steps[i].on = rnd() < d[beatPos];
      steps[i].acc = steps[i].on && rnd() < 0.2;
    }
    return;
  }
  const lo = spec.noteLo ?? 0;
  const hi = spec.noteHi ?? 127;
  let notes: number[];
  if (key && !isChromatic(key)) {
    // the project's scale over one octave from its root, with the root favoured
    const root = rootAtOrAbove(key, lo + (spec.role === "bass" ? 0 : 12));
    const inRange = notesInRange(key, root, root + 12).filter((n) => n >= lo && n <= hi);
    notes = inRange.length ? [root, root, ...inRange] : [root];
  } else {
    const base = spec.role === "bass" ? 24 : 48;
    notes = [0, 0, 3, 5, 7, 10, 12, 0, 7].map((o) => Math.min(hi, Math.max(lo, base + o)));
  }
  let prev = false;
  for (let i = 0; i < len; i++) {
    const on = rnd() < (i % 4 === 0 ? 0.85 : i % 2 === 0 ? 0.55 : 0.4);
    const s = steps[i];
    s.on = on;
    if (!on) { prev = false; continue; }
    s.note = pick(notes);
    s.acc = rnd() < 0.25;
    s.slide = prev && rnd() < 0.3;
    prev = true;
  }
}

export function isDrum(track: number): boolean {
  return DRUM_TRACKS.includes(track);
}

// --- app state -------------------------------------------------------------------------------

export function initialState(): AppState {
  return {
    projectName: "",
    patterns: Array.from({ length: NUM_PATTERNS }, (_, i) => (i === 0 ? demoPattern() : newPattern())),
    chain: [],
    chainOn: false,
    bpm: 128,
    swing: 0.5,
    pattern: 0,
    scale: defaultScale(),
    mutes: new Array(NUM_TRACKS).fill(false),
    solos: new Array(NUM_TRACKS).fill(false),
    focus: BASS_TRACK,
    page: 0,
    selStep: -1,
    follow: false,
    keyHighlight: loadKeyHighlight(),
    tab: "seq",
    audio: "off",
    audioError: "",
    playing: false,
    playPattern: 0,
    chainPos: 0,
    cue: null,
    fxPlay: true,
    write: false,
    erase: false,
    punch: 0,
    punchSel: 1,
    chainEdit: false,
    copyArm: false,
  };
}

const KEY_HL = "pulse8.keyHighlight";

function loadKeyHighlight(): boolean {
  try {
    return localStorage.getItem(KEY_HL) !== "off";
  } catch {
    return true;
  }
}

export function saveKeyHighlight(on: boolean): void {
  try {
    localStorage.setItem(KEY_HL, on ? "on" : "off");
  } catch {
    /* storage blocked: the setting just won't persist */
  }
}
