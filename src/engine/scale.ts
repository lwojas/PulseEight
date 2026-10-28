// The project key: a root note and a scale. A context for note entry only: it decides which keys the
// synth keyboard shows and never rewrites or constrains a note that is already in a pattern.

export interface ScaleDef {
  id: string;
  label: string;
  /** Semitones above the root, ascending, starting at 0. */
  intervals: number[];
}

export const SCALES: ScaleDef[] = [
  { id: "chromatic", label: "Chromatic (all notes)", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "major", label: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harmonicMinor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", label: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "pentatonicMajor", label: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { id: "pentatonicMinor", label: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "wholeTone", label: "Whole Tone", intervals: [0, 2, 4, 6, 8, 10] },
];

export const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** `preset` remembers which genre preset set root + scale (empty when picked by hand). */
export interface ProjectScale {
  root: number;
  scale: string;
  preset: string;
}

export interface ScalePreset {
  id: string;
  label: string;
  root: number;
  scale: string;
}

/** Subjective starting points per genre, not definitions of one. */
export const SCALE_PRESETS: ScalePreset[] = [
  { id: "acid", label: "Acid", root: 9, scale: "pentatonicMinor" },
  { id: "ambient", label: "Ambient", root: 0, scale: "lydian" },
  { id: "cinematic", label: "Cinematic", root: 2, scale: "harmonicMinor" },
  { id: "deepHouse", label: "Deep House", root: 7, scale: "dorian" },
  { id: "detroitTechno", label: "Detroit Techno", root: 4, scale: "minor" },
  { id: "liquidDnb", label: "Liquid DnB", root: 2, scale: "dorian" },
  { id: "lofi", label: "Lo-fi", root: 0, scale: "dorian" },
  { id: "minimalTechno", label: "Minimal Techno", root: 9, scale: "phrygian" },
  { id: "synthwave", label: "Synthwave", root: 9, scale: "minor" },
  { id: "trap", label: "Trap", root: 6, scale: "phrygian" },
  { id: "ukGarage", label: "UK Garage", root: 7, scale: "minor" },
];

export const defaultScale = (): ProjectScale => ({ root: 0, scale: "chromatic", preset: "" });

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export const scaleDef = (id: string): ScaleDef => SCALES.find((s) => s.id === id) ?? SCALES[0];

export const isChromatic = (s: ProjectScale) => scaleDef(s.scale).intervals.length === 12;

export function isInScale(s: ProjectScale, midi: number): boolean {
  return scaleDef(s.scale).intervals.includes(mod12(midi - s.root));
}

/** Every in-scale MIDI note in [lo, hi], ascending. */
export function notesInRange(s: ProjectScale, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (isInScale(s, n)) out.push(n);
  return out;
}

/** The lowest MIDI note at or above `from` that is the scale's root. */
export const rootAtOrAbove = (s: ProjectScale, from: number) => from + mod12(s.root - from);

/** The highest MIDI note at or below `from` that is the scale's root. */
export const rootAtOrBelow = (s: ProjectScale, from: number) => from - mod12(from - s.root);

/** A saved scale of any age, or untrusted data: every field defaulted. */
export function normalizeScale(raw: Partial<ProjectScale> | null | undefined): ProjectScale {
  const d = defaultScale();
  if (!raw || typeof raw !== "object") return d;
  return {
    root: Number.isFinite(raw.root) ? mod12(Math.round(raw.root as number)) : d.root,
    scale: SCALES.some((s) => s.id === raw.scale) ? (raw.scale as string) : d.scale,
    preset: SCALE_PRESETS.some((p) => p.id === raw.preset) ? (raw.preset as string) : "",
  };
}

/** Picking a root or scale by hand clears the genre label; picking a genre sets both. */
export function withRoot(s: ProjectScale, root: number): ProjectScale {
  return { root: mod12(root), scale: s.scale, preset: "" };
}
export function withScale(s: ProjectScale, scale: string): ProjectScale {
  return normalizeScale({ root: s.root, scale, preset: "" });
}
export function withPreset(s: ProjectScale, id: string): ProjectScale {
  const p = SCALE_PRESETS.find((x) => x.id === id);
  return p ? { root: p.root, scale: p.scale, preset: p.id } : s;
}
