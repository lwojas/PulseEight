// Wires the generic MIDI pieces to Pulse.8: the parameter registry, the mapping, the transport.
// This is the only MIDI module that imports the app.
import { hasEmbeddedHost, sameMidiRoute, type MidiRoute } from "webdsp";
import { storageKey } from "../product";
import { controller } from "../engine/controller";
import { setStepNote } from "../engine/actions";
import { flashKey } from "../engine/keyhl";
import { TRACKS } from "../engine/spec";
import { cleanValue, getParam, onParamChange, paramInfo, setParam } from "../engine/params";
import { getState, observe, setState } from "../engine/store";
import { createClockFollower } from "./clock";
import { createMidiControl, type MidiControl, type ParamBus } from "./control";
import { midiMapping } from "./mapping";
import { createPorts, type PortChoice } from "./ports";

/** The follower plays this far behind the incoming clock, so the first step has time to be scheduled. */
export const CLOCK_LATENCY = 0.05;
/** The clock is considered gone after this long without a pulse while it was running the transport. */
const CLOCK_TIMEOUT_MS = 1000;

export interface MidiSettings extends PortChoice {
  enabled: boolean;
  /** Device for controllers, program changes and clock: "all" or a port id. */
  input: string;
  /** Follow incoming MIDI clock, Start/Stop/Continue and Song Position Pointer. */
  clock: boolean;
  /** Device whose notes, on any channel, play the selected track: "off", "all" or a port id. */
  keyboard: string;
  /** Octave shift applied to keyboard notes, -4..4. */
  keyboardOctave: number;
}

const KEY = storageKey("midi");
const DEFAULTS: MidiSettings = { enabled: false, input: "all", output: "all", clock: false, keyboard: "off", keyboardOctave: 0 };

function loadSettings(): MidiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MidiSettings> | null;
    const merged = { ...DEFAULTS, ...raw };
    // an earlier build stored keyboard mode as a boolean
    if (typeof merged.keyboard !== "string") merged.keyboard = merged.keyboard ? "all" : "off";
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

const bus: ParamBus = {
  describe: (id) => paramInfo(id),
  get: (id) => getParam(id, getState()),
  set: (id, value, source) => setParam(id, cleanValue(paramInfo(id)!, value), source),
  subscribe: onParamChange,
};

export const ports = createPorts();
let settings = loadSettings();
let control: MidiControl | null = null;
const listeners = new Set<() => void>();

// --- clock -----------------------------------------------------------------------------------------

/** Offset between the MIDI event clock (performance.now) and the audio clock, smoothed. */
let clockOffset: number | null = null;

function audioTime(eventStamp: number): number | null {
  const now = controller.audioNow;
  if (now === null) return null;
  const wall = performance.now();
  const sample = now - wall / 1000;
  clockOffset = clockOffset === null ? sample : clockOffset * 0.95 + sample * 0.05;
  // a stamp that is not on the performance clock (some embeds) is replaced by "now"
  const stamp = Math.abs(eventStamp - wall) < 2000 ? eventStamp : wall;
  return stamp / 1000 + clockOffset;
}

let ownsTransport = false;
let lastPulseWall = 0;

const clock = createClockFollower({
  start(step, time) {
    ownsTransport = true;
    controller.play({ songStep: step, time: time + CLOCK_LATENCY });
  },
  stop() {
    if (!ownsTransport) return;
    ownsTransport = false;
    controller.stop();
  },
  step(step, time) {
    if (ownsTransport) controller.followPhase(step, time + CLOCK_LATENCY);
  },
  tempo(bpm) {
    setState({ bpm: Math.min(200, Math.max(60, bpm)) });
  },
});

setInterval(() => {
  if (ownsTransport && performance.now() - lastPulseWall > CLOCK_TIMEOUT_MS) {
    ownsTransport = false;
    controller.stop();
  }
}, 250);

// --- keyboard mode -----------------------------------------------------------------------------------

// A plugin host that plays MIDI itself (capabilities.midiRouting) is told what a key plays and plays it on its audio thread,
// sample-accurately, with no round trip through the page and with the window closed (webdsp docs/midi-routing.md). Then the page must
// not play the same note. What a key plays is what the page's own keyboard path would play, so a route is declared only where that
// path just auditions the focused track; the arpeggiator and step entry stay with the page.
let routeSent: MidiRoute | null = null;

/** The host plays keyboard notes itself right now. */
const routed = (): boolean => routeSent !== null;

function wantedRoute(): MidiRoute | null {
  const gb = controller.engine;
  if (!gb || !gb.runtime.getCapabilities().midiRouting) return null;
  if (!settings.enabled || settings.keyboard === "off") return null;
  const st = getState();
  const track = st.focus;
  const spec = TRACKS[track];
  const id = gb.ids.inst[track];
  // a drum pad: any key plays the drum at its own pitch
  if (spec.role === "drum") return { kind: "instrument", id, unityNote: 60, fixedPitch: true, ...(spec.chokeGroup !== undefined ? { chokeGroup: spec.chokeGroup } : {}) };
  if (st.arp[track].on || st.selStep >= 0) return null; // the arp, or entering a step's note: the page
  // a key plays `key + keyboard octave - root + track octave` semitones, as the page's own audition does
  const unity = (spec.rootMidi ?? 0) - 12 * (settings.keyboardOctave + controller.soundOct(track));
  return { kind: "instrument", id, unityNote: Math.min(127, Math.max(0, unity)), holdUntilKeyUp: true };
}

/** Declares the route to the host when it has changed (what a key plays follows the focused track and the keyboard settings). */
function syncRoute(): void {
  const gb = controller.engine;
  if (!gb) return;
  const wanted = wantedRoute();
  if (sameMidiRoute(routeSent, wanted)) return;
  routeSent = wanted;
  gb.runtime.setMidiRoute(wanted);
}

observe((next, prev) => {
  if (
    next.audio !== prev.audio || next.focus !== prev.focus || next.arp !== prev.arp || next.selStep !== prev.selStep ||
    (next.patterns !== prev.patterns && controller.ready) || next.playPattern !== prev.playPattern
  ) syncRoute();
});

/** Notes held by the keyboard, per track, so they can be released if the mode ends. */
const held = new Map<number, Set<number>>();

function releaseHeld(): void {
  for (const [track, notes] of held) for (const n of notes) controller.arpUp(track, n);
  held.clear();
}

/** Note On/Off on any channel plays the selected track (`focus`), as the on-screen keys do. */
function keyboardNote(data: Uint8Array): boolean {
  const type = data[0] & 0xf0;
  if (type !== 0x90 && type !== 0x80) return false;
  const on = type === 0x90 && (data[2] & 0x7f) > 0;
  const st = getState();
  const track = st.focus;
  if (TRACKS[track].role === "drum") {
    if (on && !routed()) controller.audition(track);
    return true;
  }
  const spec = TRACKS[track];
  const note = (data[1] & 0x7f) + 12 * settings.keyboardOctave;
  if (note < (spec.noteLo ?? 24) || note > (spec.noteHi ?? 59)) return true;
  const useArp = st.arp[track].on && st.selStep < 0;
  if (!on) {
    // release whatever this note was held on, even if the selection moved meanwhile
    for (const [t, notes] of held) if (notes.delete(note)) controller.arpUp(t, note);
    controller.recordUp(track, note);
    return true;
  }
  flashKey(track, note);
  const recording = controller.recording;
  if (recording) controller.recordDown(track, note);
  if (useArp) {
    (held.get(track) ?? held.set(track, new Set()).get(track)!).add(note);
    controller.arpDown(track, note);
  } else if (st.selStep >= 0 && !recording) setStepNote(track, st.selStep, note);
  else if (!routed()) controller.audition(track, note);
  return true;
}

function onMessage(data: Uint8Array, stamp: number, from: string): void {
  const status = data[0];
  if (status >= 0xf0) {
    if (!settings.clock || !(settings.input === "all" || settings.input === from)) return;
    const t = audioTime(stamp);
    if (t === null) return;
    if (status === 0xf8) lastPulseWall = performance.now();
    clock.handle(data, t);
    return;
  }
  const isNote = (data[0] & 0xe0) === 0x80 && (data[0] & 0xf0) <= 0x90;
  if (isNote && settings.keyboard !== "off" && (settings.keyboard === "all" || settings.keyboard === from) && keyboardNote(data)) return;
  if (settings.input === "all" || settings.input === from) control?.handle(data);
}

// --- lifecycle -----------------------------------------------------------------------------------------

ports.onMessage(onMessage);
ports.onPortsChanged(() => control?.sendAll());

function apply(): void {
  if (!settings.enabled || settings.keyboard === "off") releaseHeld();
  syncRoute();
  ports.choose({ output: settings.output });
  if (settings.enabled) {
    control ??= createMidiControl({ mapping: midiMapping, bus, send: (b) => ports.send(b) });
    if (control.compiled.warnings.length) console.warn("MIDI mapping:", control.compiled.warnings);
    void ports.start();
  } else {
    control?.dispose();
    control = null;
    ports.stop();
  }
}

export const midi = {
  settings: (): MidiSettings => settings,
  /** Change settings; they are remembered. */
  update(patch: Partial<MidiSettings>): void {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage blocked: the choice just won't persist */
    }
    apply();
    listeners.forEach((f) => f());
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    const off = ports.subscribe(fn);
    return () => { listeners.delete(fn); off(); };
  },
  /** Start at app boot when MIDI was left on, or when hosted as a plugin (the DAW's MIDI is the point). */
  boot(): void {
    // (in a DAW the notes it sends play the focused track unless the player turned that off)
    if (hasEmbeddedHost() && !settings.enabled) settings = { ...settings, enabled: true, clock: false, keyboard: settings.keyboard === "off" ? "all" : settings.keyboard };
    if (settings.enabled) apply();
  },
};
