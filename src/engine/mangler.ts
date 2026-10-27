// Punch FX: performance effects on one shared effect bus (filter, drive, crush, phaser, flanger,
// dub echo, reverb). Not a mixer send: the track delay/reverb sends live in trackfx.ts.
//
// While a punch is held it either "takes over" the mix (every track's dry output is cut and fully
// sent through the chain, like the punch-in FX of a Pocket Operator) or "throws" (the tracks' sends
// into the bus are lifted, DUB / ROLL / VERB). Each punch has one character parameter and a sweep
// level 0..1: the level rises while the pad is held, so the effect is performed in, not switched on.
import { DubDelayDivision, NodeParam } from "webdsp";
import type { ManglerBase } from "./state";

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
  { label: "1 BT", steps: 4 },
  { label: "2 BT", steps: 8 },
  { label: "1 BAR", steps: 16 },
] as const;
export const DEFAULT_SWEEP = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const expLerp = (a: number, b: number, t: number) => a * Math.pow(b / a, t);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

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

export interface PunchDef {
  id: number;
  label: string;
  hint: string;
  /** Cut every track's dry output and send it all through the mangler. */
  takeover: boolean;
  /** Send level into the bus at full effect (non-takeover punches; scales with the sweep level). */
  boost: number;
  /** The one character parameter: FX → amount (sweep) → character. */
  param: PunchParam;
  /** Overrides on top of the resting values. `p` is the character parameter, `lvl` the 0..1 sweep level. */
  values(p: number, lvl: number): Partial<ManglerValues>;
}

export const PUNCHES: readonly PunchDef[] = [
  {
    id: 1, label: "FILTER", hint: "CLOSING LOW-PASS", takeover: true, boost: 1,
    param: { label: "DEPTH", def: 0.6, format: pct },
    values: (p, l) => ({ fCut: expLerp(20000, expLerp(1800, 200, p), l), fRes: lerp(0.707, lerp(1.2, 3.2, p), l), ...OWN }),
  },
  {
    id: 2, label: "DRIVE", hint: "TAPE SATURATION", takeover: true, boost: 1,
    param: { label: "DRIVE", def: 0.6, format: pct },
    values: (p, l) => ({ sDrive: lerp(10, 30, p), sOut: -lerp(3, 9, p) * l, sMix: l, ...OWN }),
  },
  {
    id: 3, label: "CRUSH", hint: "BIT + RATE REDUCTION", takeover: true, boost: 1,
    param: { label: "CRUSH", def: 0.6, format: pct },
    values: (p, l) => ({
      cBits: Math.round(lerp(16, lerp(9, 4, p), l)), cDown: Math.round(lerp(1, lerp(2, 10, p), l)), cMix: 1, ...OWN,
    }),
  },
  {
    id: 4, label: "PHASE", hint: "SWEEPING PHASER", takeover: true, boost: 1,
    param: { label: "RATE", def: 0.6, format: (n) => `${lerp(0.4, 3, n).toFixed(1)} Hz` },
    values: (p, l) => ({ pMix: 0.85 * l, pRate: lerp(0.4, 3, p), pDepth: 0.95, pFb: lerp(0.4, 0.8, p), ...OWN }),
  },
  {
    id: 5, label: "DUB", hint: "ECHO THROW", takeover: false, boost: 0.85,
    param: {
      label: "TIME", steps: DUB_DIVISIONS.map((d) => d.label), def: 0.5,
      format: (n) => DUB_DIVISIONS[Math.round(n * (DUB_DIVISIONS.length - 1))].label,
    },
    values: (p, l) => ({
      dDiv: DUB_DIVISIONS[Math.round(p * (DUB_DIVISIONS.length - 1))].value, dFb: lerp(0.55, 0.9, l), dMix: 1,
    }),
  },
  {
    id: 6, label: "ROLL", hint: "1/16 FEEDBACK ROLL", takeover: false, boost: 1,
    param: { label: "FEEDBACK", def: 0.6, format: pct },
    values: (p, l) => ({ dDiv: DubDelayDivision.Sixteenth, dFb: lerp(0.6, lerp(0.8, 0.93, p), l), dTone: 7000, dMix: 1 }),
  },
  {
    id: 7, label: "SWEEP", hint: "FILTER SWEEP", takeover: true, boost: 1,
    param: {
      label: "SHAPE", steps: SWEEP_SHAPES, def: 0,
      format: (n) => SWEEP_SHAPES[Math.round(n * (SWEEP_SHAPES.length - 1))],
    },
    // CLOSE: open → closed.  OPEN: closed → open.  RES adds a resonant peak that rides the sweep.
    values: (p, l) => {
      const shape = Math.round(p * (SWEEP_SHAPES.length - 1));
      const cut = shape >= 2 ? expLerp(120, 20000, l) : expLerp(20000, 140, l);
      return { fCut: cut, fRes: shape % 2 === 1 ? 3.4 : 1.3, ...OWN };
    },
  },
  {
    id: 8, label: "FLANGE", hint: "JET FLANGER", takeover: true, boost: 1,
    param: { label: "RATE", def: 0.4, format: (n) => `${lerp(0.1, 1.2, n).toFixed(1)} Hz` },
    values: (p, l) => ({ xMix: 0.8 * l, xRate: lerp(0.1, 1.2, p), xDepth: 3, xDelay: 2.5, xFb: 0.75, ...OWN }),
  },
  {
    id: 9, label: "VERB", hint: "REVERB THROW", takeover: false, boost: 1,
    param: { label: "SIZE", def: 0.6, format: pct },
    values: (p) => ({ rMix: 1, rDecay: lerp(0.6, 0.95, p), rDamp: 0.3, dMix: 0 }),
  },
];

export const punchById = (id: number): PunchDef | undefined => PUNCHES.find((p) => p.id === id);

/** Seconds a reverb punch keeps ringing after release (the return would otherwise cut its own tail). */
export const VERB_TAIL = 2.5;
export const VERB_ID = 9;

/** The defaults for a new pattern's punch settings. */
export function defaultMangler(): ManglerBase {
  return { sweep: DEFAULT_SWEEP, param: [0, ...PUNCHES.map((p) => p.param.def)] };
}

export interface ManglerTarget {
  values: ManglerValues;
  takeover: boolean;
  /** Send level of every track into the bus. */
  boost: number;
}

/** Everything the mangler should look like for a punch (0 = none) at sweep level `lvl`. */
export function manglerTarget(base: ManglerBase, punchId: number, lvl = 1, keepVerb = false): ManglerTarget {
  const resting = baseValues();
  const punch = punchById(punchId);
  if (!punch) return { values: keepVerb ? { ...resting, rMix: 1, dMix: 0 } : resting, takeover: false, boost: 0 };
  const l = clamp01(lvl);
  const p = clamp01(base.param[punchId] ?? punch.param.def);
  return {
    values: { ...resting, ...punch.values(p, l) },
    takeover: punch.takeover,
    boost: punch.takeover ? 1 : punch.boost * l,
  };
}

/** Sweep level reached `elapsed` seconds after a punch went down. */
export function sweepLevel(base: ManglerBase, bpm: number, elapsed: number): number {
  const steps = SWEEPS[base.sweep]?.steps ?? 0;
  if (steps === 0) return 1;
  return clamp01(elapsed / (steps * (15 / bpm)));
}
