// Punch FX: performance effects on one shared effect bus (filter, drive, crush, phaser, flanger,
// dub echo, reverb). Not a mixer send: the track delay/reverb sends live in trackfx.ts.
//
// While a punch is held it either "takes over" the mix (every track's dry output is cut and fully
// sent through the chain, like the punch-in FX of a Pocket Operator) or "throws" (the tracks' sends
// into the bus are lifted, DUB / ROLL / VERB). Each punch has one character parameter and a sweep
// level 0..1: the level rises while the pad is held, so the effect is performed in, not switched on.
import { DubDelayDivision, NodeParam } from "webdsp";
import { lfoOffset, newLfo, sanitizeLfo, LFO_DIVISION_NAMES, type Lfo } from "./lfo";
import type { ManglerBase, Pattern } from "./state";

export type ManglerKey =
  | "fCut" | "fRes"
  | "sDrive" | "sOut" | "sMix"
  | "cBits" | "cDown" | "cMix"
  | "pRate" | "pDepth" | "pFb" | "pCenter" | "pMix"
  | "xRate" | "xDepth" | "xDelay" | "xFb" | "xMix"
  | "dDiv" | "dFb" | "dTone" | "dMix"
  | "rDecay" | "rDamp" | "rMix";

export type ManglerValues = Record<ManglerKey, number>;
export type FxSlot = "filter" | "sat" | "crush" | "phaser" | "flange" | "dub" | "verb";

/** Where each mangler value goes, in chain order. */
export const MANGLER_PARAMS: Record<ManglerKey, { fx: FxSlot; param: NodeParam }> = {
  fCut: { fx: "filter", param: NodeParam.FilterCutoff },
  fRes: { fx: "filter", param: NodeParam.FilterResonance },
  sDrive: { fx: "sat", param: NodeParam.SatDrive },
  sOut: { fx: "sat", param: NodeParam.SatOutputGain },
  sMix: { fx: "sat", param: NodeParam.SatMix },
  cBits: { fx: "crush", param: NodeParam.CrushBits },
  cDown: { fx: "crush", param: NodeParam.CrushDownsample },
  cMix: { fx: "crush", param: NodeParam.CrushMix },
  pRate: { fx: "phaser", param: NodeParam.PhaserRate },
  pDepth: { fx: "phaser", param: NodeParam.PhaserDepth },
  pFb: { fx: "phaser", param: NodeParam.PhaserFeedback },
  pCenter: { fx: "phaser", param: NodeParam.PhaserCenter },
  pMix: { fx: "phaser", param: NodeParam.PhaserMix },
  xRate: { fx: "flange", param: NodeParam.ChorusFlangerRate },
  xDepth: { fx: "flange", param: NodeParam.ChorusFlangerDepth },
  xDelay: { fx: "flange", param: NodeParam.ChorusFlangerDelay },
  xFb: { fx: "flange", param: NodeParam.ChorusFlangerFeedback },
  xMix: { fx: "flange", param: NodeParam.ChorusFlangerMix },
  dDiv: { fx: "dub", param: NodeParam.DubDelayDivision },
  dFb: { fx: "dub", param: NodeParam.DubDelayFeedback },
  dTone: { fx: "dub", param: NodeParam.DubDelayTone },
  dMix: { fx: "dub", param: NodeParam.DubDelayMix },
  rDecay: { fx: "verb", param: NodeParam.ReverbDecay },
  rDamp: { fx: "verb", param: NodeParam.ReverbDamping },
  rMix: { fx: "verb", param: NodeParam.ReverbMix },
};

export const MANGLER_KEYS = Object.keys(MANGLER_PARAMS) as ManglerKey[];

/** Echo divisions the UI offers (sweet spots only). */
export const DUB_DIVISIONS = [
  { label: "1/16", value: DubDelayDivision.Sixteenth },
  { label: "1/8", value: DubDelayDivision.Eighth },
  { label: "1/8.", value: DubDelayDivision.DottedEighth },
  { label: "1/4", value: DubDelayDivision.Quarter },
  { label: "1/8T", value: DubDelayDivision.EighthTriplet },
] as const;

/** How long a held punch takes to reach full effect, in 16th steps (0 = instantly). */
export const SWEEPS = [
  { label: "NOW", steps: 0 },
  { label: "1 BEAT", steps: 4 },
  { label: "2 BEATS", steps: 8 },
  { label: "1 BAR", steps: 16 },
] as const;
export const DEFAULT_SWEEP = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const expLerp = (a: number, b: number, t: number) => a * Math.pow(b / a, t);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
/** A macro's travel around the setting `mid` that the effect has always had: `mid` exactly at 0.5, `lo` at 0 and `hi` at 1. */
const span = (m: number, lo: number, mid: number, hi: number) => (m >= 0.5 ? mid + (hi - mid) * (m - 0.5) * 2 : mid - (mid - lo) * (0.5 - m) * 2);
/** A factor of up to 2^`oct` either way, 1 exactly at 0.5. */
const oct = (m: number, o: number) => 2 ** ((m - 0.5) * 2 * o);

/** The resting state: transparent chain, dub echo return open, reverb out of the path. */
export function baseValues(): ManglerValues {
  return {
    fCut: 20000, fRes: 0.707,
    sDrive: 0, sOut: 0, sMix: 0,
    cBits: 16, cDown: 1, cMix: 0,
    pRate: 0.5, pDepth: 0.8, pFb: 0.3, pCenter: 900, pMix: 0,
    xRate: 0.3, xDepth: 3, xDelay: 2.5, xFb: 0.7, xMix: 0,
    dDiv: DubDelayDivision.DottedEighth, dFb: 0.55, dTone: 3500, dMix: 1,
    rDecay: 0.8, rDamp: 0.3, rMix: 0,
  };
}

/** Takeover punches own the whole signal, so the wet-only returns must get out of the way. */
const OWN = { dMix: 0, rMix: 0 } as const;

export interface PunchParam {
  label: string;
  /** Detent names for a stepped parameter. */
  steps?: readonly string[];
  def: number;
  /** Readout for a normalised value. */
  format(n: number): string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const SWEEP_SHAPES = ["CLOSE", "CLOSE RES", "OPEN", "OPEN RES"] as const;

/** One of a punch's two macros: a musical dimension of the effect, normalised 0..1. */
export interface MacroDef {
  label: string;
  /** The resting setting; for most, 0.5 is how the effect sounded before macros existed. */
  def: number;
}
/** The two macro values of a punch. */
export type Macros = readonly [number, number];

export interface PunchDef {
  id: number;
  /** Stable name for outside control (`punch.<key>.macro1`). Never change one once shipped. */
  key: string;
  label: string;
  hint: string;
  /** Cut every track's dry output and send it all through the mangler. */
  takeover: boolean;
  /** Send level into the bus at full effect (non-takeover punches; scales with the sweep level). */
  boost: number;
  /** The one character parameter: FX → amount (sweep) → character. */
  param: PunchParam;
  /** The two macros: each moves several of the effect's parameters together (see `values`). */
  macros: readonly [MacroDef, MacroDef];
  /** Overrides on top of the resting values. `p` is the character parameter, `lvl` the 0..1 sweep level, `m` the macros (their
   * defaults when left out). At the default macros it is the effect as it always sounded. */
  values(p: number, lvl: number, m?: Macros): Partial<ManglerValues>;
  /** Scale of a throw's send level with the macros (1 at the defaults). */
  boostScale?(m: Macros): number;
}

type RawPunch = Omit<PunchDef, "values"> & { values(p: number, lvl: number, m: Macros): Partial<ManglerValues> };

const mac = (label: string, def = 0.5): MacroDef => ({ label, def });

// Every mapping below is anchored on the effect as it was before macros: at the default macros `values` returns the same numbers.
const RAW: readonly RawPunch[] = [
  {
    id: 1, key: "filter", label: "FILTER", hint: "CLOSING LOW-PASS", takeover: true, boost: 1,
    param: { label: "DEPTH", def: 0.6, format: pct },
    // CUT: where the filter ends up (about 1.5 octaves either way).  RESO: the whistle at the closed end.
    macros: [mac("CUT"), mac("RESO")],
    values: (p, l, [m1, m2]) => ({
      fCut: expLerp(20000, clamp(expLerp(1800, 200, p) * oct(m1, 1.5), 60, 19000), l),
      fRes: lerp(0.707, clamp(lerp(1.2, 3.2, p) + (m2 - 0.5) * 3, 0.707, 4), l), ...OWN,
    }),
  },
  {
    id: 2, key: "drive", label: "DRIVE", hint: "TAPE SATURATION", takeover: true, boost: 1,
    param: { label: "DRIVE", def: 0.6, format: pct },
    // GRIT: pre-gain, with the output trim following it.  BLEND: how much of the driven signal is mixed in.
    macros: [mac("GRIT"), mac("BLEND", 1)],
    values: (p, l, [m1, m2]) => {
      const drive = span(m1, 4, lerp(10, 30, p), 30);
      return { sDrive: drive, sOut: -(lerp(3, 9, p) + (drive - lerp(10, 30, p)) * 0.3) * l, sMix: l * lerp(0.15, 1, m2), ...OWN };
    },
  },
  {
    id: 3, key: "crush", label: "CRUSH", hint: "BIT + RATE REDUCTION", takeover: true, boost: 1,
    param: { label: "CRUSH", def: 0.6, format: pct },
    // BITS: how few bits it is cut down to.  RATE: how far the sample rate drops.
    macros: [mac("BITS"), mac("RATE")],
    values: (p, l, [m1, m2]) => ({
      cBits: Math.round(lerp(16, clamp(lerp(9, 4, p) - (m1 - 0.5) * 6, 2, 14), l)),
      cDown: Math.round(lerp(1, clamp(lerp(2, 10, p) * oct(m2, 1), 1, 16), l)), cMix: 1, ...OWN,
    }),
  },
  {
    id: 4, key: "phaser", label: "PHASE", hint: "SWEEPING PHASER", takeover: true, boost: 1,
    param: { label: "RATE", def: 0.6, format: (n) => `${lerp(0.4, 3, n).toFixed(1)} Hz` },
    // DEPTH: how deep the notches and how much of the phased signal there is.  COLOR: feedback and where the notches centre.
    macros: [mac("DEPTH"), mac("COLOR")],
    values: (p, l, [m1, m2]) => ({
      pMix: span(m1, 0.2, 0.85, 1) * l, pRate: lerp(0.4, 3, p), pDepth: span(m1, 0.4, 0.95, 0.99),
      pFb: clamp(lerp(0.4, 0.8, p) + (m2 - 0.5) * 0.4, 0, 0.85), pCenter: 900 * oct(m2, 1), ...OWN,
    }),
  },
  {
    id: 5, key: "dub", label: "DUB", hint: "ECHO THROW", takeover: false, boost: 0.85,
    param: {
      label: "TIME", steps: DUB_DIVISIONS.map((d) => d.label), def: 0.5,
      format: (n) => DUB_DIVISIONS[Math.round(n * (DUB_DIVISIONS.length - 1))].label,
    },
    // SPACE: how much goes into the echo and how long it keeps repeating.  TONE: how dark or bright the repeats are.
    macros: [mac("SPACE"), mac("TONE")],
    values: (p, l, [m1, m2]) => ({
      dDiv: DUB_DIVISIONS[Math.round(p * (DUB_DIVISIONS.length - 1))].value, dFb: lerp(0.55, span(m1, 0.4, 0.9, 0.95), l),
      dTone: 3500 * oct(m2, 1.5), dMix: 1,
    }),
    boostScale: ([m1]) => span(m1, 0.4, 1, 1.15),
  },
  {
    id: 6, key: "roll", label: "ROLL", hint: "1/16 FEEDBACK ROLL", takeover: false, boost: 1,
    param: { label: "FEEDBACK", def: 0.6, format: pct },
    // WET: how hard the mix is thrown into the roll.  TONE: how dark or bright the repeats are.
    macros: [mac("WET"), mac("TONE")],
    values: (p, l, [, m2]) => ({ dDiv: DubDelayDivision.Sixteenth, dFb: lerp(0.6, lerp(0.8, 0.93, p), l), dTone: 7000 * oct(m2, 1.5), dMix: 1 }),
    boostScale: ([m1]) => span(m1, 0.3, 1, 1.2),
  },
  {
    id: 7, key: "sweep", label: "SWEEP", hint: "FILTER SWEEP", takeover: true, boost: 1,
    param: {
      label: "SHAPE", steps: SWEEP_SHAPES, def: 0,
      format: (n) => SWEEP_SHAPES[Math.round(n * (SWEEP_SHAPES.length - 1))],
    },
    // CLOSE: open → closed.  OPEN: closed → open.  RES adds a resonant peak that rides the sweep.
    // RANGE: how dark the sweep gets (2 octaves either way).  RESO: the resonant peak.
    macros: [mac("RANGE"), mac("RESO")],
    values: (p, l, [m1, m2]) => {
      const shape = Math.round(p * (SWEEP_SHAPES.length - 1));
      const dark = (shape >= 2 ? 120 : 140) / oct(m1, 2);
      const cut = shape >= 2 ? expLerp(dark, 20000, l) : expLerp(20000, dark, l);
      return { fCut: cut, fRes: span(m2, 0.8, shape % 2 === 1 ? 3.4 : 1.3, 4.2), ...OWN };
    },
  },
  {
    id: 8, key: "flanger", label: "FLANGE", hint: "JET FLANGER", takeover: true, boost: 1,
    param: { label: "RATE", def: 0.4, format: (n) => `${lerp(0.1, 1.2, n).toFixed(1)} Hz` },
    // DEPTH: how far the delay swings and how much of the flanged signal there is.  FEEDBACK: the metallic ring, and a longer delay with it.
    macros: [mac("DEPTH"), mac("FEEDBACK")],
    values: (p, l, [m1, m2]) => ({
      xMix: span(m1, 0.25, 0.8, 0.95) * l, xRate: lerp(0.1, 1.2, p), xDepth: span(m1, 1.5, 3, 4), xDelay: 2.5 * oct(m2, 0.75),
      xFb: span(m2, 0.35, 0.75, 0.88), ...OWN,
    }),
  },
  {
    id: 9, key: "verb", label: "VERB", hint: "REVERB THROW", takeover: false, boost: 1,
    param: { label: "SIZE", def: 0.6, format: pct },
    // WET: how hard the mix is thrown into the room.  TONE: how dark or bright the tail is (the damping, upside down).
    macros: [mac("WET"), mac("TONE")],
    values: (p, _l, [, m2]) => ({ rMix: 1, rDecay: lerp(0.6, 0.95, p), rDamp: span(m2, 0.85, 0.3, 0.05), dMix: 0 }),
    boostScale: ([m1]) => span(m1, 0.25, 1, 1.15),
  },
];

const defaultMacros = (p: { macros: readonly [MacroDef, MacroDef] }): Macros => [p.macros[0].def, p.macros[1].def];

export const PUNCHES: readonly PunchDef[] = RAW.map((p) => ({ ...p, values: (v, l, m) => p.values(v, l, m ?? defaultMacros(p)) }));

export const punchById = (id: number): PunchDef | undefined => PUNCHES.find((p) => p.id === id);

/** Seconds a reverb punch keeps ringing after release (the return would otherwise cut its own tail). */
export const VERB_TAIL = 2.5;
export const VERB_ID = 9;

/** What an FX LFO can move. */
export const FX_LFO_TARGETS = [
  { id: "macro1", label: "MACRO 1" },
  { id: "macro2", label: "MACRO 2" },
] as const;

/** A fresh FX LFO: off, locked to the beat at 4 bars, so a slow evolution is one switch away. */
export const newFxLfo = (): Lfo => ({ ...newLfo(), sync: true, div: Math.max(0, LFO_DIVISION_NAMES.indexOf("4 bars")), depth: 0.6 });

/** The defaults for a new pattern's punch settings. */
export function defaultMangler(): ManglerBase {
  return {
    sweep: DEFAULT_SWEEP,
    param: [0, ...PUNCHES.map((p) => p.param.def)],
    macro: [[0.5, 0.5], ...PUNCHES.map((p) => [...defaultMacros(p)] as [number, number])],
    lfo: [newFxLfo(), ...PUNCHES.map(newFxLfo)],
  };
}

/** Fill in what an older save lacks (macros and FX LFOs, and any punch added since) and clean what it has. Mutates `m`. */
export function fillMangler(m: ManglerBase): void {
  const raw = m as Partial<ManglerBase>;
  const macro = Array.isArray(raw.macro) ? raw.macro : [];
  const lfo = Array.isArray(raw.lfo) ? raw.lfo : [];
  const ok = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? clamp01(v) : def);
  m.macro = [[0.5, 0.5], ...PUNCHES.map((p, i) => {
    const d = defaultMacros(p);
    const saved = Array.isArray(macro[i + 1]) ? macro[i + 1] : [];
    return [ok(saved[0], d[0]), ok(saved[1], d[1])] as [number, number];
  })];
  m.lfo = [newFxLfo(), ...PUNCHES.map((_, i) => {
    const l = sanitizeLfo(lfo[i + 1], newFxLfo());
    if (!FX_LFO_TARGETS.some((t) => t.id === l.target)) return { ...l, on: false, target: "" };
    return l;
  })];
}

/** A punch's macros as set (before any LFO). */
export const macrosOf = (base: ManglerBase, id: number): Macros => base.macro?.[id] ?? (punchById(id) ? defaultMacros(punchById(id)!) : [0.5, 0.5]);

/** Whether a punch's LFO is moving one of its macros. */
export const fxLfoActive = (base: ManglerBase, id: number): boolean => {
  const l = base.lfo?.[id];
  return !!l && l.on && FX_LFO_TARGETS.some((t) => t.id === l.target);
};

/** A punch's macros at audio time `time`: as set, with its LFO added to the one it points at. The LFO runs on the beat grid
 * (`anchorTime`, `bpm`) and not on the sequencer's step, so it keeps its own cycle however long the pattern is. */
export function macrosAt(base: ManglerBase, id: number, time: number, anchorTime: number, bpm: number): Macros {
  const m = macrosOf(base, id);
  if (!fxLfoActive(base, id)) return m;
  const off = lfoOffset(base.lfo[id], time, anchorTime, bpm);
  return base.lfo[id].target === "macro1" ? [clamp01(m[0] + off), m[1]] : [m[0], clamp01(m[1] + off)];
}

export interface ManglerTarget {
  values: ManglerValues;
  takeover: boolean;
  /** Send level of every track into the bus. */
  boost: number;
}

/** Everything the mangler should look like for a punch (0 = none) at sweep level `lvl`. `macros` replaces the pattern's own
 * (what an LFO-moved punch passes). */
export function manglerTarget(base: ManglerBase, punchId: number, lvl = 1, keepVerb = false, macros?: Macros): ManglerTarget {
  const resting = baseValues();
  const punch = punchById(punchId);
  if (!punch) return { values: keepVerb ? { ...resting, rMix: 1, dMix: 0 } : resting, takeover: false, boost: 0 };
  const l = clamp01(lvl);
  const p = clamp01(base.param[punchId] ?? punch.param.def);
  const m = macros ?? macrosOf(base, punchId);
  return {
    values: { ...resting, ...punch.values(p, l, m) },
    takeover: punch.takeover,
    boost: punch.takeover ? 1 : punch.boost * l * (punch.boostScale?.(m) ?? 1),
  };
}

/** A punch at a sweep level: one written lane's contribution at a step. */
export interface PunchLayer {
  id: number;
  lvl: number;
  /** Macros to use instead of the pattern's (an LFO-moved punch). */
  macros?: Macros;
}

/** Several punches at once (the FX lanes play layered). Each layer's overrides on the resting chain are
 * stacked in order, a later layer winning where two touch the same value; takeover if any layer is,
 * and the loudest boost. One layer is exactly `manglerTarget`. */
export function layeredTarget(base: ManglerBase, layers: readonly PunchLayer[], keepVerb = false): ManglerTarget {
  if (layers.length === 0) return manglerTarget(base, 0, 0, keepVerb);
  const resting = baseValues();
  const values = { ...resting };
  let takeover = false;
  let boost = 0;
  for (const { id, lvl, macros } of layers) {
    const t = manglerTarget(base, id, lvl, false, macros);
    for (const k of Object.keys(resting) as ManglerKey[]) if (t.values[k] !== resting[k]) values[k] = t.values[k];
    takeover ||= t.takeover;
    boost = Math.max(boost, t.boost);
  }
  return { values, takeover, boost };
}

/** The punches the written lanes of a pattern hold at `step`, in lane order. */
export const laneLayers = (pat: Pattern, step: number): PunchLayer[] =>
  pat.fxLanes.flatMap((l) => (l.fx[step] ? [{ id: l.fx[step], lvl: l.fxLvl[step] }] : []));

/** Punches whose level swings back and forth (0 → 1 → 0 …) for as long as the pad is held. */
export const PING_PONG = new Set([7]);
/** Half-period of a ping-pong swing when the sweep time is NOW, in 16th steps. */
export const PING_PONG_NOW_STEPS = 8;

/** Sweep level reached `elapsed` seconds after a punch went down. */
export function sweepLevel(base: ManglerBase, bpm: number, elapsed: number, punchId = 0): number {
  const steps = SWEEPS[base.sweep]?.steps ?? 0;
  const pingPong = PING_PONG.has(punchId);
  if (steps === 0 && !pingPong) return 1;
  const t = elapsed / ((steps || PING_PONG_NOW_STEPS) * (15 / bpm));
  if (!pingPong) return clamp01(t);
  const ph = ((t % 2) + 2) % 2;
  return ph <= 1 ? ph : 2 - ph;
}
