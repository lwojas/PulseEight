// A small, instrument-agnostic arpeggiator. Pure logic: no audio, no React, no knowledge of any
// track. Held notes go in; timed note events come out, expressed in *transport steps* (one step =
// a 16th note) so the host schedules them on the clock it already has. A track's settings are plain
// data (`ArpSettings`); one `Arpeggiator` instance holds the live state of one track.

export type ArpDirection = "up" | "down" | "updown" | "random";

export const ARP_DIRECTIONS: ReadonlyArray<{ id: ArpDirection; label: string }> = [
  { id: "up", label: "UP" },
  { id: "down", label: "DOWN" },
  { id: "updown", label: "UP/DN" },
  { id: "random", label: "RND" },
];

/** Note rates, as a length in 16th-note steps. */
export const ARP_RATES = [
  { label: "1/4", steps: 4 },
  { label: "1/8", steps: 2 },
  { label: "1/8T", steps: 4 / 3 },
  { label: "1/16", steps: 1 },
  { label: "1/16T", steps: 2 / 3 },
  { label: "1/32", steps: 0.5 },
] as const;

export const ARP_MAX_OCTAVES = 4;

export interface ArpSettings {
  on: boolean;
  /** Index into `ARP_RATES`. */
  rate: number;
  dir: ArpDirection;
  /** 1..ARP_MAX_OCTAVES: how many octaves the held notes are repeated across. */
  octaves: number;
  /** Velocity of every arp note, 0..1. */
  velocity: number;
  /** Fraction of the note length each note is held, 0..1. */
  gate: number;
}

export const defaultArp = (): ArpSettings => ({ on: false, rate: 3, dir: "up", octaves: 1, velocity: 0.8, gate: 0.6 });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Coerces anything (a saved project, an edit patch merged onto settings) into valid settings. */
export function normalizeArp(raw: unknown): ArpSettings {
  const d = defaultArp();
  const a = (raw && typeof raw === "object" ? raw : {}) as Partial<ArpSettings>;
  return {
    on: a.on === true,
    rate: clamp(Math.round(num(a.rate, d.rate)), 0, ARP_RATES.length - 1),
    dir: ARP_DIRECTIONS.some((x) => x.id === a.dir) ? (a.dir as ArpDirection) : d.dir,
    octaves: clamp(Math.round(num(a.octaves, d.octaves)), 1, ARP_MAX_OCTAVES),
    velocity: clamp(num(a.velocity, d.velocity), 0, 1),
    gate: clamp(num(a.gate, d.gate), 0.05, 1),
  };
}

/** One note for the host to play: `offset` steps into the window it was generated for. */
export interface ArpEvent {
  offset: number;
  note: number;
  velocity: number;
  /** How long to hold it, in steps. */
  length: number;
}

/** The held notes, lowest first, repeated across `octaves` octaves (ascending). */
export function arpPool(held: readonly number[], octaves: number): number[] {
  const base = [...new Set(held)].sort((a, b) => a - b);
  const pool: number[] = [];
  for (let o = 0; o < octaves; o++) for (const n of base) pool.push(n + 12 * o);
  return pool;
}

/** Index into a pool of `len` notes for the `cursor`-th arp note. */
export function arpIndex(dir: ArpDirection, len: number, cursor: number, rnd: () => number = Math.random): number {
  if (len <= 1) return 0;
  switch (dir) {
    case "up": return cursor % len;
    case "down": return len - 1 - (cursor % len);
    case "updown": {
      const cycle = 2 * len - 2; // the top and bottom notes are not played twice in a row
      const i = cursor % cycle;
      return i < len ? i : cycle - i;
    }
    case "random": return Math.floor(rnd() * len);
  }
}

const EPS = 1e-6;

interface Held {
  note: number;
  released: boolean;
  /** The arp has played it at least once. A note released before that is kept until it has, so a quick tap is heard. */
  heard: boolean;
}

export class Arpeggiator {
  private held: Held[] = [];
  private cursor = 0;
  /** Steps until the next note, relative to the start of the next window. */
  private phase = 0;
  private aligned = false;

  get active(): boolean {
    return this.held.some((h) => !h.released || !h.heard);
  }

  noteDown(note: number): void {
    const h = this.held.find((x) => x.note === note);
    if (h) h.released = false;
    else this.held.push({ note, released: false, heard: false });
  }

  noteUp(note: number): void {
    const h = this.held.find((x) => x.note === note);
    if (h) h.released = true;
  }

  /** Drop every held note (arp switched off). */
  clear(): void {
    this.held = [];
    this.aligned = false;
    this.cursor = 0;
  }

  /** The host's grid restarted (transport start/stop): line up with it again on the next window. */
  realign(): void {
    this.aligned = false;
  }

  /**
   * Walk one transport step. `gridPos` is the step's position on the host's grid (used to line the
   * first note up with the rate, so a 1/4 arp lands on beats). Returns the notes that start in it.
   * Nothing is returned, and nothing advances, while no keys are held.
   */
  advance(settings: ArpSettings, gridPos: number, rnd: () => number = Math.random): ArpEvent[] {
    if (!this.active) {
      this.held = [];
      this.aligned = false;
      this.cursor = 0;
      return [];
    }
    const period = ARP_RATES[settings.rate].steps;
    if (!this.aligned) {
      const r = gridPos % period;
      this.phase = r < EPS || period - r < EPS ? 0 : period - r;
      this.aligned = true;
      this.cursor = 0;
    }
    const events: ArpEvent[] = [];
    // Held notes, plus any released before they were heard.
    const pool = arpPool(this.held.filter((h) => !h.released || !h.heard).map((h) => h.note), settings.octaves);
    while (this.phase < 1 - EPS) {
      const note = pool[arpIndex(settings.dir, pool.length, this.cursor++, rnd)];
      events.push({ offset: Math.max(0, this.phase), note, velocity: settings.velocity, length: period * settings.gate });
      this.phase += period;
    }
    this.phase -= 1;
    if (events.length) {
      this.held = this.held.filter((h) => !h.released || !h.heard);
      for (const h of this.held) h.heard = true;
    }
    return events;
  }
}
