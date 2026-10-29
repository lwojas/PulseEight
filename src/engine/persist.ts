// Saves patterns, the chain and the transport settings to IndexedDB (db.ts): an autosave slot
// plus named saves. Performance state (mutes, solos, FX arming, the screen) is deliberately not
// saved. Project files (export / import) are separate and unchanged.
import { BASS_TRACK, defaultSound, NUM_TRACKS, TRACKS } from "./spec";
import { FX_LANES, MAX_CHAIN, MAX_STEPS, newFxLane, newPattern, NUM_PATTERNS, type AppState, type Pattern } from "./state";
import { normalizeArp, type ArpSettings } from "./arp";
import { defaultMangler } from "./mangler";
import { newDelay, newReverb } from "./trackfx";
import { normalizeScale, type ProjectScale } from "./scale";
import { CURRENT_STORE, idbRequest, openDb, SAVES_STORE, txDone } from "./db";
import { getState, observe, setState } from "./store";
import { getHostFiles, getHostState, type HostStateBridge, type HostStateSnapshot } from "webdsp";

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
  /** Per-track arpeggiator settings; absent in older saves. */
  arp?: ArpSettings[];
}

function valid(p: unknown): p is Pattern {
  const x = p as Pattern;
  return (
    !!x && Array.isArray(x.tracks) && x.tracks.length === NUM_TRACKS && Array.isArray(x.fxLanes) && x.fxLanes.length === FX_LANES &&
    x.fxLanes.every((l) => Array.isArray(l?.fx) && l.fx.length === MAX_STEPS && Array.isArray(l.fxLvl) && l.fxLvl.length === MAX_STEPS) &&
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
    if (typeof t.punch !== "boolean") t.punch = true;
    delete old.send;
  });
  if (!Array.isArray(p.mangler?.param)) p.mangler = defaultMangler();
  // The single FX lane became three: an old pattern's lane is the first.
  const old = p as unknown as { fx?: number[]; fxLvl?: number[] };
  if (!Array.isArray(p.fxLanes) && Array.isArray(old.fx)) {
    const lvl = Array.isArray(old.fxLvl) ? old.fxLvl : old.fx.map((id) => (id ? 1 : 0));
    p.fxLanes = [{ fx: old.fx, fxLvl: lvl }, ...Array.from({ length: FX_LANES - 1 }, newFxLane)];
  }
  delete old.fx;
  delete old.fxLvl;
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
    arp: Array.from({ length: NUM_TRACKS }, (_, i) => normalizeArp(Array.isArray(s.arp) ? s.arp[i] : undefined)),
  };
}

/** Files hold JSON, and 64 patterns are ~1.7 MB of it: patterns still equal to a fresh one are written as null. */
function sparse(patterns: Pattern[]): Array<Pattern | null> {
  const blank = JSON.stringify(newPattern());
  return patterns.map((p) => (JSON.stringify(p) === blank ? null : p));
}

function snapshot(): Saved {
  const s = getState();
  return { projectName: s.projectName, patterns: s.patterns, chain: s.chain, chainOn: s.chainOn, bpm: s.bpm, swing: s.swing, pattern: s.pattern, scale: s.scale, arp: s.arp };
}

/** Restores the autosave slot into the store. Resolves once done; a missing or damaged slot just
 * leaves the default project, and an unreachable store also raises `storageBlocked`. */
export async function loadProject(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    setState({ storageBlocked: true });
    return;
  }
  try {
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

/** Puts a parsed project in the store. The view resets too: the old page or selected step may not exist in it. */
function replaceProject(project: Saved & { patterns: Pattern[] }, projectName: string): void {
  setState({ ...project, projectName, cue: null, page: 0, selStep: -1 });
}

/** Replaces the current project. The caller stops playback first. */
export function loadSaved(entry: SavedProject): boolean {
  const project = parseProject(structuredClone(entry.project));
  if (!project) return false;
  replaceProject(project, entry.name);
  return true;
}

/** The project as the text of an export file (and of a host snapshot): untouched patterns are written as null. */
function projectText(name: string): string {
  return JSON.stringify({ app: FILE_APP, version: 1, name, project: { ...snapshot(), patterns: sparse(getState().patterns) } });
}

/** Whether export / import must go through the host's own dialogs: a plugin's WKWebView has no file input and ignores
 * `<a download>`. False in a browser, where the input and the download link are used. */
export const hasHostFiles = (): boolean => getHostFiles() !== null;

export async function exportProject(name: string): Promise<void> {
  const clean = name.trim() || "pulse8-project";
  const fileName = clean.replace(/[^\w.-]+/g, "-").toLowerCase() + ".pulse8.json";
  const files = getHostFiles();
  if (files) {
    await files.saveFile({ suggestedName: fileName, data: projectText(clean) });
    return;
  }
  const blob = new Blob([projectText(clean)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Reads an exported file (or a bare project) and loads it. Resolves to the project name, or rejects. */
export async function importProject(file: File): Promise<string> {
  return importProjectText(await file.text(), file.name);
}

/** The same through the host's open dialog. Resolves to the project name, or null if the user cancelled. */
export async function importProjectFromHost(beforeReplace: () => void): Promise<string | null> {
  const picked = await getHostFiles()?.openFile({ extensions: ["json"] });
  if (picked) beforeReplace(); // only once a file was chosen: cancelling leaves playback alone
  return picked ? importProjectText(new TextDecoder().decode(picked.data), picked.name) : null;
}

function importProjectText(text: string, fileName: string): string {
  let data: { app?: string; name?: string; project?: Saved } & Partial<Saved>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const project = parseProject((data?.project ?? data) as Saved);
  if (!project) throw new Error("That file is not a Pulse.8 project.");
  const name = (typeof data.name === "string" && data.name ? data.name : fileName.replace(/\.pulse8\.json$|\.json$/i, "")).slice(0, 40);
  replaceProject(project, name);
  return name;
}

// ---- the project in a plugin host's session ------------------------------------------------------
//
// In a DAW plugin the session is the source of truth (webdsp getHostState(), docs/host-state.md): the page's IndexedDB is
// shared by every instance of the plugin, so the autosave slot is not used at all there. The rules that made reopening the
// window recover the project (learnt in webvst / webseq):
//  - nothing is published before the host has answered (a pristine default would overwrite the saved session), so the
//    first render waits for the answer (`restoreFromHost`), and edits are observed only after it;
//  - the answer is a snapshot or null; null is "nothing saved" and leaves the demo project, never an error;
//  - publish on a short debounce, and at once when the page hides: a plugin window can close at any moment;
//  - a snapshot that is not ours or not readable starts fresh instead of wedging startup.

/** The persisted fields, compared by reference: if you add a persisted field, add it here too (and to `snapshot`). */
const persisted = (s: AppState) => [s.patterns, s.chain, s.chainOn, s.bpm, s.swing, s.projectName, s.scale, s.arp];
const projectChanged = (next: AppState, prev: AppState) => {
  const a = persisted(next);
  const b = persisted(prev);
  return !a.every((v, i) => v === b[i]);
};

export const HOST_APP = FILE_APP;
/** Version of a snapshot's `data` (the export file's JSON). Bump when older code could no longer read it. */
export const HOST_FORMAT = 1;
export const HOST_PUBLISH_DEBOUNCE_MS = 300;
/** An older plugin never answers: give up waiting after this long and run on the default project. */
export const HOST_ANSWER_TIMEOUT_MS = 2500;

export function toHostSnapshot(): HostStateSnapshot {
  return { app: HOST_APP, format: HOST_FORMAT, data: projectText(getState().projectName), blobs: {} };
}

/** The project in a snapshot, or null when it is not ours, not a format we read, or malformed. */
export function fromHostSnapshot(snap: HostStateSnapshot): (Saved & { patterns: Pattern[] }) | null {
  if (snap.app !== HOST_APP || snap.format !== HOST_FORMAT) return null;
  try {
    const data = JSON.parse(snap.data) as { project?: Saved };
    return parseProject(data?.project as Saved);
  } catch {
    return null;
  }
}

/** Resolves once the host has answered (or after the timeout), with the saved project installed in the store. A later
 * answer (the DAW reverting the session) installs that project too, after `beforeReplace` (stop playback). Returns after
 * the first answer; the subscription lives as long as the page. */
export function restoreFromHost(host: HostStateBridge, beforeReplace: () => void): Promise<void> {
  return new Promise((resolve) => {
    let answered = false;
    let edited = false;
    let lastData = "";
    observe((next, prev) => { if (projectChanged(next, prev)) edited = true; });
    const timer = window.setTimeout(resolve, HOST_ANSWER_TIMEOUT_MS);
    host.onRestore((snap) => {
      const first = !answered;
      answered = true;
      window.clearTimeout(timer);
      // A first answer that came after the timeout must not clobber what was done meanwhile; null is a new session.
      const stale = first && edited;
      if (snap && !stale && snap.data !== lastData) {
        lastData = snap.data;
        const project = fromHostSnapshot(snap);
        if (project) {
          if (!first) beforeReplace();
          replaceProject(project, project.projectName ?? "");
        }
      }
      resolve();
    });
  });
}

/** Writes the project to the autosave slot shortly after each change (or, in a plugin host, publishes it to the host's
 * session), and straight away when the page is hidden or closed so the last edit is not lost. */
export function autosave(): void {
  let timer: number | undefined;
  let dirty = false;
  const host = getHostState();
  const flush = () => {
    window.clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    if (host) {
      host.publish(toHostSnapshot());
      return;
    }
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
    if (!projectChanged(next, prev)) return;
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, host ? HOST_PUBLISH_DEBOUNCE_MS : 500);
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);
}
