// User-level edits. UI components call these; they edit the store and (for immediate feedback)
// audition sounds. No React here.
import { normalizeArp, type ArpSettings } from "./arp";
import { controller } from "./controller";
import { clearLocks, lockParams, setLock } from "./plock";
import { kitSounds, KITS, presetsFor, synthSound } from "./presets";
import { TRACKS } from "./spec";
import { clearTrackSteps, GATES, newPattern, PAGE, randomizeTrack } from "./state";
import { BEAT_DIVISIONS, type DelaySend, type ReverbSend } from "./trackfx";
import { editPattern, getState, setState } from "./store";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// --- steps -------------------------------------------------------------------------------------

/** Tap a step. Drums toggle. Melodic steps: tap an empty step to place a note and select it, tap an
 * unselected note to select it for editing, tap the selected note to remove it. */
export function tapStep(track: number, step: number): void {
  const st = getState();
  if (st.plock) return selectLockStep(track, step);
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
  if (getState().plock) return selectLockStep(track, step);
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

/** Set a step's gate length (index into `GATES`). */
export function setStepGate(track: number, step: number, gate: number): void {
  editPattern((p) => { p.tracks[track].steps[step].gate = Math.max(0, Math.min(GATES.length - 1, Math.round(gate))); });
}

// --- parameter locks (see plock.ts) -------------------------------------------------------------

/** P-LOCK mode on or off. Locks are never touched by this; leaving the mode just returns the pads to normal editing. */
export function setPlockMode(on: boolean): void {
  const st = getState();
  if (st.plock === on) return;
  // a drum step is only ever selected for locking: do not leave it looking selected in normal mode
  setState({ plock: on, ...(!on && TRACKS[st.focus].role === "drum" ? { selStep: -1 } : {}) });
}

/** In P-LOCK mode a tap only selects the step (empty or not): nothing is added, removed or sounded differently. */
function selectLockStep(track: number, step: number): void {
  setState({ focus: track, selStep: step });
  if (!getState().playing) controller.audition(track, getState().patterns[getState().pattern].tracks[track].steps[step].note);
}

/** A sound knob moved. In normal mode it edits the base sound. In P-LOCK mode it writes only that parameter's lock on the selected
 * step (and nothing when no step is selected: the base is not for P-LOCK mode to change). */
export function setSoundControl(track: number, control: number, value: number): void {
  const st = getState();
  if (!st.plock) return setSound(track, control, value);
  if (st.selStep < 0 || st.focus !== track) return;
  const id = lockParams(track)[control].id;
  editPattern((p) => setLock(p.tracks[track].steps[st.selStep], id, clamp01(value)));
}

/** Remove every lock from a step; the step and the base sound stay as they are. */
export function clearStepLocks(track: number, step: number): void {
  editPattern((p) => clearLocks(p.tracks[track].steps[step]));
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

export function setDelay(track: number, patch: Partial<DelaySend>): void {
  editPattern((p) => {
    const d = p.tracks[track].dly;
    Object.assign(d, patch);
    d.send = clamp01(d.send);
    d.time = clamp01(d.time);
    d.div = Math.max(0, Math.min(BEAT_DIVISIONS.length - 1, Math.round(d.div)));
  });
}

export function setReverb(track: number, patch: Partial<ReverbSend>): void {
  editPattern((p) => {
    const r = p.tracks[track].rev;
    Object.assign(r, patch);
    r.send = clamp01(r.send);
    r.size = clamp01(r.size);
  });
}

export function setPunchSend(track: number, on: boolean): void {
  editPattern((p) => { p.tracks[track].punch = on; });
}

export function setOctave(track: number, oct: number): void {
  editPattern((p) => { p.tracks[track].oct = Math.max(-2, Math.min(2, oct)); });
}

/** Edit one track's arpeggiator settings (kept per track, saved with the project). */
export function setArp(track: number, patch: Partial<ArpSettings>): void {
  setState((s) => ({ arp: s.arp.map((a, i) => (i === track ? normalizeArp({ ...a, ...patch }) : a)) }));
}

export function toggleMute(track: number): void {
  setState((s) => ({ mutes: s.mutes.map((m, i) => (i === track ? !m : m)) }));
}

/** Set (not toggle) mute and solo: what an external control sends. */
export function setMute(track: number, on: boolean): void {
  setState((s) => (s.mutes[track] === on ? {} : { mutes: s.mutes.map((m, i) => (i === track ? on : m)) }));
}

export function setSolo(track: number, on: boolean): void {
  setState((s) => (s.solos[track] === on ? {} : { solos: s.solos.map((m, i) => (i === track ? on : m)) }));
}

export function toggleSolo(track: number): void {
  setState((s) => ({ solos: s.solos.map((m, i) => (i === track ? !m : m)) }));
}

/** Set one punch's character parameter. */
export function setPunchParam(id: number, value: number): void {
  editPattern((p) => { p.mangler.param[id] = clamp01(value); });
}

export function setSweep(index: number): void {
  editPattern((p) => { p.mangler.sweep = index; });
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

/** Set the pattern length. With `copyPage`, newly added bars are filled with a copy of that page. */
export function setLength(length: number, copyPage?: number): void {
  editPattern((p) => {
    if (copyPage !== undefined && length > p.length) {
      const from = copyPage * PAGE;
      for (let i = p.length; i < length; i++) {
        const src = from + (i % PAGE);
        for (const t of p.tracks) t.steps[i] = structuredClone(t.steps[src]);
        for (const lane of p.fxLanes) {
          lane.fx[i] = lane.fx[src];
          lane.fxLvl[i] = lane.fxLvl[src];
        }
      }
    }
    p.length = length;
  });
  setState((s) => ({ page: Math.min(s.page, length / PAGE - 1), selStep: -1 }));
}

export function clearTrack(track: number): void {
  editPattern((p) => clearTrackSteps(p, track));
  setState({ selStep: -1 });
}

export function randomize(track: number): void {
  editPattern((p) => randomizeTrack(p, track, Math.random, getState().scale));
  setState({ selStep: -1 });
}

export function clearPattern(): void {
  const st = getState();
  const patterns = st.patterns.slice();
  patterns[st.pattern] = newPattern();
  setState({ patterns, selStep: -1 });
}

// --- chain ---------------------------------------------------------------------------------------

export function removeChainEntry(index: number): void {
  setState((s) => ({ chain: s.chain.filter((_, i) => i !== index) }));
}

export function clearChain(): void {
  setState({ chain: [], chainOn: false });
}
