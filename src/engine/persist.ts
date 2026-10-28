// Saves patterns, the chain and the transport settings to localStorage. Performance state
// (mutes, solos, FX arming, the screen) is deliberately not saved.
import { BASS_TRACK, defaultSound, NUM_TRACKS, TRACKS } from "./spec";
import { MAX_STEPS, NUM_PATTERNS, type AppState, type Pattern } from "./state";
import { defaultMangler } from "./mangler";
import { newDelay, newReverb } from "./trackfx";
import { normalizeScale, type ProjectScale } from "./scale";
import { getState, observe, setState } from "./store";

const KEY = "pulse8.project.v1";

interface Saved {
  projectName?: string;
  patterns: Pattern[];
  chain: number[];
  chainOn: boolean;
  bpm: number;
  swing: number;
  pattern: number;
  /** Absent in saves from before scales existed. */
  scale?: ProjectScale;
}

function valid(p: unknown): p is Pattern {
  const x = p as Pattern;
  return (
    !!x && Array.isArray(x.tracks) && x.tracks.length === NUM_TRACKS && Array.isArray(x.fx) && x.fx.length === MAX_STEPS && Array.isArray(x.fxLvl) && x.fxLvl.length === MAX_STEPS &&
    typeof x.length === "number" && !!x.mangler &&
    x.tracks.every((t, i) => Array.isArray(t.steps) && t.steps.length === MAX_STEPS && t.sound?.length === TRACKS[i].controls.length)
  );
}

/** Older saves: the FX send became separate delay and reverb sends; punches gained per-FX
 * parameters and a recorded sweep level (a written punch used to be simply "on", i.e. full). */
function migrate(p: Pattern): void {
  if (!p || !Array.isArray(p.tracks)) return;
  p.tracks.forEach((t, i) => {
    const old = t as unknown as { send?: number };
    if (!t.dly) t.dly = { ...newDelay(i), send: typeof old.send === "number" ? old.send : newDelay(i).send };
    if (!t.rev) t.rev = newReverb(i);
    delete old.send;
  });
  if (!Array.isArray(p.mangler?.param)) p.mangler = defaultMangler();
  if (!Array.isArray(p.fxLvl) && Array.isArray(p.fx)) p.fxLvl = p.fx.map((id) => (id ? 1 : 0));
}

/** Validates and normalises a saved project (any age); null if it is not a usable project. */
function parseProject(s: Saved): Saved | null {
  if (!s || !Array.isArray(s.patterns) || s.patterns.length !== NUM_PATTERNS) return null;
  // The bass gained a control (ENV MOD): older saves get its default sound, the rest is kept.
  for (const p of s.patterns) {
    const t = p?.tracks?.[BASS_TRACK];
    if (t && Array.isArray(t.sound) && t.sound.length !== TRACKS[BASS_TRACK].controls.length) t.sound = defaultSound(TRACKS[BASS_TRACK]);
  }
  for (const p of s.patterns) migrate(p);
  if (!s.patterns.every(valid)) return null;
  return {
    projectName: typeof s.projectName === "string" ? s.projectName.slice(0, 40) : "",
    patterns: s.patterns,
    chain: Array.isArray(s.chain) ? s.chain.filter((n) => n >= 0 && n < NUM_PATTERNS) : [],
    chainOn: !!s.chainOn,
    bpm: Number.isFinite(s.bpm) ? s.bpm : 128,
    swing: Number.isFinite(s.swing) ? s.swing : 0.5,
    pattern: s.pattern >= 0 && s.pattern < NUM_PATTERNS ? s.pattern : 0,
    scale: normalizeScale(s.scale),
  };
}

function snapshot(): Saved {
  const s = getState();
  return { projectName: s.projectName, patterns: s.patterns, chain: s.chain, chainOn: s.chainOn, bpm: s.bpm, swing: s.swing, pattern: s.pattern, scale: s.scale };
}

export function loadProject(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const project = parseProject(JSON.parse(raw) as Saved);
    if (project) setState(project);
  } catch {
    /* unreadable or blocked storage: start from the default project */
  }
}

// ---- named projects (save / load) and files (export / import) -------------------------------------

const SAVES_KEY = "pulse8.saves.v1";
const FILE_APP = "pulse8";

export interface SavedProject {
  id: string;
  name: string;
  savedAt: number;
  project: Saved;
}

export function listSaves(): SavedProject[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVES_KEY) ?? "[]") as SavedProject[];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string" && typeof e.name === "string").sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

function writeSaves(list: SavedProject[]): boolean {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Saves the current project under `name`; the same name overwrites. False if storage refused. */
export function saveProject(name: string): boolean {
  const clean = name.trim() || "Untitled";
  const list = listSaves();
  const existing = list.find((e) => e.name.toLowerCase() === clean.toLowerCase());
  const entry: SavedProject = {
    id: existing?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: clean,
    savedAt: Date.now(),
    project: JSON.parse(JSON.stringify(snapshot())) as Saved,
  };
  entry.project.projectName = clean;
  const ok = writeSaves([entry, ...list.filter((e) => e.id !== entry.id)]);
  if (ok) setState({ projectName: clean });
  return ok;
}

export function deleteSave(id: string): void {
  writeSaves(listSaves().filter((e) => e.id !== id));
}

/** Replaces the current project. The caller stops playback first. */
export function loadSaved(entry: SavedProject): boolean {
  const project = parseProject(JSON.parse(JSON.stringify(entry.project)) as Saved);
  if (!project) return false;
  setState({ ...project, projectName: entry.name, cue: null });
  return true;
}

export function exportProject(name: string): void {
  const clean = name.trim() || "pulse8-project";
  const blob = new Blob([JSON.stringify({ app: FILE_APP, version: 1, name: clean, project: snapshot() })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = clean.replace(/[^\w.-]+/g, "-").toLowerCase() + ".pulse8.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Reads an exported file (or a bare project) and loads it. Resolves to the project name, or rejects. */
export async function importProject(file: File): Promise<string> {
  let data: { app?: string; name?: string; project?: Saved } & Partial<Saved>;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const project = parseProject((data?.project ?? data) as Saved);
  if (!project) throw new Error("That file is not a Pulse.8 project.");
  const name = (typeof data.name === "string" && data.name ? data.name : file.name.replace(/\.pulse8\.json$|\.json$/i, "")).slice(0, 40);
  setState({ ...project, projectName: name, cue: null });
  return name;
}

export function autosave(): void {
  let timer: number | undefined;
  const persisted = (s: AppState) => [s.patterns, s.chain, s.chainOn, s.bpm, s.swing, s.projectName, s.scale];
  observe((next, prev) => {
    const a = persisted(next);
    const b = persisted(prev);
    if (a.every((v, i) => v === b[i])) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(snapshot()));
      } catch {
        /* storage full or blocked: nothing to do */
      }
    }, 500);
  });
}
