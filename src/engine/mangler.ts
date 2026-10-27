// The FX Mangler: one shared effect bus (filter, drive, crush, phaser, dub echo) fed by the
// per-track sends, plus the punch-in FX that perform on it.
//
// Two behaviours share the same chain:
//  * the always-on dub send: tracks send into a wet-only dub echo (the classic dub return);
//  * punches: while held, a punch either lifts the sends (DUB, ROLL) or "takes over" the mix:
//    every track's dry output is cut and fully sent through the chain, so the effect acts on
//    the whole groove, like the punch-in FX of a Pocket Operator.
import { DubDelayDivision, NodeParam } from "webdsp";
import type { ManglerBase } from "./state";

export type ManglerKey =
  | "fCut" | "fRes"
  | "sDrive" | "sOut" | "sMix"
  | "cBits" | "cDown" | "cMix"
  | "pRate" | "pDepth" | "pFb" | "pCenter" | "pMix"
  | "dDiv" | "dFb" | "dTone" | "dMix";

export type ManglerValues = Record<ManglerKey, number>;
export type FxSlot = "filter" | "sat" | "crush" | "phaser" | "dub";

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
  dDiv: { fx: "dub", param: NodeParam.DubDelayDivision },
  dFb: { fx: "dub", param: NodeParam.DubDelayFeedback },
  dTone: { fx: "dub", param: NodeParam.DubDelayTone },
  dMix: { fx: "dub", param: NodeParam.DubDelayMix },
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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const expLerp = (a: number, b: number, t: number) => a * Math.pow(b / a, t);

/** The resting state: transparent chain, dub echo return open. */
export function baseValues(b: ManglerBase): ManglerValues {
  return {
    fCut: 20000, fRes: 0.707,
    sDrive: 0, sOut: 0, sMix: 0,
    cBits: 16, cDown: 1, cMix: 0,
    pRate: 0.5, pDepth: 0.8, pFb: 0.3, pCenter: 900, pMix: 0,
    dDiv: DUB_DIVISIONS[Math.min(DUB_DIVISIONS.length - 1, Math.max(0, b.div))].value,
    dFb: lerp(0.25, 0.88, b.fb),
    dTone: expLerp(500, 9000, b.tone),
    dMix: 1,
  };
}

export interface PunchDef {
  id: number;
  label: string;
  hint: string;
  /** Cut every track's dry output and send it all through the mangler. */
  takeover: boolean;
  /** Minimum send level while held (non-takeover punches). */
  boost: number;
  /** Overrides on top of the base values; `amt` is the 0..1 punch intensity. */
  values(base: ManglerValues, amt: number): Partial<ManglerValues>;
}

export const PUNCHES: readonly PunchDef[] = [
  {
    id: 1, label: "FILTER", hint: "CLOSING LOW-PASS", takeover: true, boost: 1,
    values: (_b, amt) => ({ fCut: expLerp(1800, 200, amt), fRes: lerp(1.2, 3.2, amt), dMix: 0 }),
  },
  {
    id: 2, label: "DRIVE", hint: "TAPE SATURATION", takeover: true, boost: 1,
    values: (_b, amt) => ({ sDrive: lerp(10, 30, amt), sOut: -lerp(3, 9, amt), sMix: 1, dMix: 0 }),
  },
  {
    id: 3, label: "CRUSH", hint: "BIT + RATE REDUCTION", takeover: true, boost: 1,
    values: (_b, amt) => ({ cBits: Math.round(lerp(9, 4, amt)), cDown: Math.round(lerp(2, 10, amt)), cMix: 1, dMix: 0 }),
  },
  {
    id: 4, label: "PHASE", hint: "SWEEPING PHASER", takeover: true, boost: 1,
    values: (_b, amt) => ({ pMix: 0.85, pRate: lerp(0.4, 3, amt), pDepth: 0.95, pFb: lerp(0.4, 0.8, amt), dMix: 0 }),
  },
  {
    id: 5, label: "DUB", hint: "ECHO THROW", takeover: false, boost: 0.85,
    values: (b, amt) => ({ dFb: Math.min(0.92, Math.max(b.dFb, lerp(0.6, 0.9, amt))), dMix: 1 }),
  },
  {
    id: 6, label: "ROLL", hint: "1/16 FEEDBACK ROLL", takeover: false, boost: 1,
    values: (_b, amt) => ({ dDiv: DubDelayDivision.Sixteenth, dFb: lerp(0.8, 0.93, amt), dTone: 7000, dMix: 1 }),
  },
];

export const punchById = (id: number): PunchDef | undefined => PUNCHES.find((p) => p.id === id);

export interface ManglerTarget {
  values: ManglerValues;
  takeover: boolean;
  boost: number;
}

/** Everything the mangler should look like for a base setting and an active punch (0 = none). */
export function manglerTarget(base: ManglerBase, punchId: number): ManglerTarget {
  const resting = baseValues(base);
  const punch = punchById(punchId);
  if (!punch) return { values: resting, takeover: false, boost: 0 };
  return { values: { ...resting, ...punch.values(resting, base.amt) }, takeover: punch.takeover, boost: punch.boost };
}
