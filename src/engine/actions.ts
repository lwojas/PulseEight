// User-level edits. UI components call these; they edit the store and (for immediate feedback)
// audition sounds. No React here.
import { controller } from "./controller";
import { kitSounds, KITS, presetsFor, synthSound } from "./presets";
import { TRACKS } from "./spec";
import { clearTrackSteps, newPattern, newTrackPattern, PAGE, randomizeTrack, type ManglerBase } from "./state";
import { editPattern, getState, setState } from "./store";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// --- steps -------------------------------------------------------------------------------------

/** Tap a step. Drums toggle. Melodic steps: tap an empty step to place a note and select it, tap an
 * unselected note to select it for editing, tap the selected note to remove it. */
export function tapStep(track: number, step: number): void {
  const st = getState();
  const spec = TRACKS[track];
  const cur = st.patterns[st.pattern].tracks[track].steps[step];
  if (spec.role === "drum") {
    editPattern((p) => {
      const s = p.tracks[track].steps[step];
      s.on = !s.on;
      s.acc = false;
    });
    setState({ focus: track });
    if (!cur.on) controller.audition(track);
    return;
  }
  const selected = st.focus === track && st.selStep === step;
  if (cur.on && selected) {
    editPattern((p) => { p.tracks[track].steps[step].on = false; });
    setState({ selStep: -1 });
    return;
  }
  if (!cur.on) editPattern((p) => { p.tracks[track].steps[step].on = true; });
  setState({ focus: track, selStep: step });
  controller.audition(track, cur.note);
}

/** Long-press a step: accent a drum hit; select (and place) a melodic step for editing. */
export function holdStep(track: number, step: number): void {
  const spec = TRACKS[track];
  if (spec.role === "drum") {
    editPattern((p) => {
      const s = p.tracks[track].steps[step];
      s.acc = s.on ? !s.acc : true;
      s.on = true;
    });
    setState({ focus: track });
    controller.audition(track);
    return;
  }
  editPattern((p) => { p.tracks[track].steps[step].on = true; });
  setState({ focus: track, selStep: step });
}

export function setStepNote(track: number, step: number, note: number): void {
  editPattern((p) => {
    const s = p.tracks[track].steps[step];
    s.note = note;
    s.on = true;
  });
  controller.audition(track, note);
}

export function toggleStepFlag(track: number, step: number, flag: "acc" | "slide"): void {
  editPattern((p) => {
    const s = p.tracks[track].steps[step];
    s[flag] = !s[flag];
    s.on = true;
  });
}

// --- sound / mix ---------------------------------------------------------------------------------

export function setSound(track: number, control: number, value: number): void {
  editPattern((p) => {
    p.tracks[track].sound[control] = clamp01(value);
    p.tracks[track].preset = "";
  });
}

export function setLevel(track: number, value: number): void {
  editPattern((p) => { p.tracks[track].level = clamp01(value); });
}

export function setSend(track: number, value: number): void {
  editPattern((p) => { p.tracks[track].send = clamp01(value); });
}

export function setOctave(track: number, oct: number): void {
  editPattern((p) => { p.tracks[track].oct = Math.max(-2, Math.min(2, oct)); });
}

export function toggleMute(track: number): void {
  setState((s) => ({ mutes: s.mutes.map((m, i) => (i === track ? !m : m)) }));
}

export function toggleSolo(track: number): void {
  setState((s) => ({ solos: s.solos.map((m, i) => (i === track ? !m : m)) }));
}

export function setMangler(patch: Partial<ManglerBase>): void {
  editPattern((p) => { Object.assign(p.mangler, patch); });
}

export function loadKit(index: number): void {
  const kit = KITS[index];
  const sounds = kitSounds(kit);
  editPattern((p) => {
    sounds.forEach((sound, t) => {
      p.tracks[t].sound = sound;
      p.tracks[t].preset = kit.name;
    });
  });
  controller.audition(0);
}

export function loadSynthPreset(track: number, index: number): void {
  const preset = presetsFor(track)[index];
  if (!preset) return;
  const sound = synthSound(track, preset);
  editPattern((p) => {
    p.tracks[track].sound = sound;
    p.tracks[track].preset = preset.name;
  });
  controller.audition(track);
}

// --- pattern -------------------------------------------------------------------------------------

export function setLength(length: number): void {
  editPattern((p) => { p.length = length; });
  setState((s) => ({ page: Math.min(s.page, length / PAGE - 1), selStep: -1 }));
}

export function clearTrack(track: number): void {
  editPattern((p) => clearTrackSteps(p, track));
  setState({ selStep: -1 });
}

export function randomize(track: number): void {
  editPattern((p) => randomizeTrack(p, track));
  setState({ selStep: -1 });
}

export function clearPattern(): void {
  const st = getState();
  const patterns = st.patterns.slice();
  patterns[st.pattern] = newPattern();
  setState({ patterns, selStep: -1 });
}

export function resetTrackSound(track: number): void {
  editPattern((p) => { p.tracks[track].sound = newTrackPattern(track).sound; p.tracks[track].preset = ""; });
}

// --- chain ---------------------------------------------------------------------------------------

export function removeChainEntry(index: number): void {
  setState((s) => ({ chain: s.chain.filter((_, i) => i !== index) }));
}

export function clearChain(): void {
  setState({ chain: [], chainOn: false });
}
