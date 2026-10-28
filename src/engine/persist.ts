// Saves patterns, the chain and the transport settings to IndexedDB (db.ts): an autosave slot
// plus named saves. Performance state (mutes, solos, FX arming, the screen) is deliberately not
// saved. Project files (export / import) are separate and unchanged.
import { BASS_TRACK, defaultSound, NUM_TRACKS, TRACKS } from "./spec";
import { MAX_CHAIN, MAX_STEPS, newPattern, NUM_PATTERNS, type AppState, type Pattern } from "./state";
import { defaultMangler } from "./mangler";
import { newDelay, newReverb } from "./trackfx";
import { normalizeScale, type ProjectScale } from "./scale";
import { CURRENT_STORE, idbRequest, openDb, SAVES_STORE, txDone } from "./db";
import { getState, observe, setState } from "./store";

const CURRENT_ID = "current";

interface Saved {
  projectName?: string;
  /** `null` stands for an untouched pattern (see `sparse`); older files hold only 16 entries. */
  patterns: Array<Pattern | null>;
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
function parseProject(s: Saved): (Saved & { patterns: Pattern[] }) | null {
  if (!s || !Array.isArray(s.patterns) || s.patterns.length < 1 || s.patterns.length > NUM_PATTERNS) return null;
  // Untouched patterns are saved as null, and saves from before the bank grew to 64 are short.
  const patterns: Pattern[] = Array.from({ length: NUM_PATTERNS }, (_, i) => s.patterns[i] ?? newPattern());
  // The bass gained a control (ENV MOD): older saves get its default sound, the rest is kept.
  for (const p of patterns) {
    const t = p?.tracks?.[BASS_TRACK];
    if (t && Array.isArray(t.sound) && t.sound.length !== TRACKS[BASS_TRACK].controls.length) t.sound = defaultSound(TRACKS[BASS_TRACK]);
  }
  for (const p of patterns) migrate(p);
  if (!patterns.every(valid)) return null;
  return {
    projectName: typeof s.projectName === "string" ? s.projectName.slice(0, 40) : "",
    patterns,
    chain: Array.isArray(s.chain) ? s.chain.filter((n) => n >= 0 && n < NUM_PATTERNS).slice(0, MAX_CHAIN) : [],
    chainOn: !!s.chainOn,
    bpm: Number.isFinite(s.bpm) ? s.bpm : 128,
    swing: Number.isFinite(s.swing) ? s.swing : 0.5,
    pattern: s.pattern >= 0 && s.pattern < NUM_PATTERNS ? s.pattern : 0,
    scale: normalizeScale(s.scale),
  };
}

/** Files hold JSON, and 64 patterns are ~1.7 MB of it: patterns still equal to a fresh one are written as null. */
function sparse(patterns: Pattern[]): Array<Pattern | null> {
  const blank = JSON.stringify(newPattern());
  return patterns.map((p) => (JSON.stringify(p) === blank ? null : p));
}

function snapshot(): Saved {
  const s = getState();
  return { projectName: s.projectName, patterns: s.patterns, chain: s.chain, chainOn: s.chainOn, bpm: s.bpm, swing: s.swing, pattern: s.pattern, scale: s.scale };
}

/** Restores the autosave slot into the store. Resolves once done; a missing or damaged slot just
 * leaves the default project, and an unreachable store also raises `storageBlocked`. */
export async function loadProject(): Promise<void> {
  try {
    await openDb();
  } catch {
    setState({ storageBlocked: true });
    return;
  }
  try {
    const db = await openDb();
    const record = await idbRequest<{ id: string; project: Saved } | undefined>(db.transaction(CURRENT_STORE).objectStore(CURRENT_STORE).get(CURRENT_ID));
    const project = record ? parseProject(record.project) : null;
    if (project) setState(project);
  } catch {
    /* unreadable or blocked storage: start from the default project */
  }
}

// ---- named projects (save / load) and files (export / import) -------------------------------------

const FILE_APP = "pulse8";

export interface SavedProject {
  id: string;
  name: string;
  savedAt: number;
  project: Saved;
}

export async function listSaves(): Promise<SavedProject[]> {
  try {
    const db = await openDb();
    const list = await idbRequest<SavedProject[]>(db.transaction(SAVES_STORE).objectStore(SAVES_STORE).getAll());
    return list.filter((e) => e && typeof e.id === "string" && typeof e.name === "string").sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Saves the current project under `name`; the same name overwrites. False if storage refused. */
export async function saveProject(name: string): Promise<boolean> {
  try {
    const clean = name.trim() || "Untitled";
    const existing = (await listSaves()).find((e) => e.name.toLowerCase() === clean.toLowerCase());
    const project = snapshot();
    project.projectName = clean;
    const entry: SavedProject = {
      id: existing?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: clean,
      savedAt: Date.now(),
      project,
    };
    const db = await openDb();
    const tx = db.transaction(SAVES_STORE, "readwrite");
    tx.objectStore(SAVES_STORE).put(entry); // structured clone happens here, before any later edit
    await txDone(tx);
    setState({ projectName: clean });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSave(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(SAVES_STORE, "readwrite");
    tx.objectStore(SAVES_STORE).delete(id);
    await txDone(tx);
  } catch {
    /* nothing to delete from an unreachable store */
  }
}

/** Replaces the current project. The caller stops playback first. */
export function loadSaved(entry: SavedProject): boolean {
  const project = parseProject(structuredClone(entry.project));
  if (!project) return false;
  setState({ ...project, projectName: entry.name, cue: null });
  return true;
}

export function exportProject(name: string): void {
  const clean = name.trim() || "pulse8-project";
  const blob = new Blob([JSON.stringify({ app: FILE_APP, version: 1, name: clean, project: { ...snapshot(), patterns: sparse(getState().patterns) } })], { type: "application/json" });
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

/** Writes the project to the autosave slot shortly after each change, and straight away when the
 * page is hidden or closed so the last edit is not lost. */
export function autosave(): void {
  let timer: number | undefined;
  let dirty = false;
  const persisted = (s: AppState) => [s.patterns, s.chain, s.chainOn, s.bpm, s.swing, s.projectName, s.scale];
  const flush = () => {
    window.clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    void (async () => {
      try {
        const db = await openDb();
        const tx = db.transaction(CURRENT_STORE, "readwrite");
        tx.objectStore(CURRENT_STORE).put({ id: CURRENT_ID, savedAt: Date.now(), project: snapshot() });
        await txDone(tx);
        if (getState().storageBlocked) setState({ storageBlocked: false });
      } catch {
        /* storage full or blocked: say so (the Save button explains) */
        setState({ storageBlocked: true });
      }
    })();
  };
  observe((next, prev) => {
    const a = persisted(next);
    const b = persisted(prev);
    if (a.every((v, i) => v === b[i])) return;
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);
}
