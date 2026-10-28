// Wires the generic MIDI pieces to Pulse.8: the parameter registry, the mapping, the transport.
// This is the only MIDI module that imports the app.
import { hasEmbeddedHost } from "webdsp";
import { controller } from "../engine/controller";
import { cleanValue, getParam, onParamChange, paramInfo, setParam } from "../engine/params";
import { getState, setState } from "../engine/store";
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
  /** Follow incoming MIDI clock, Start/Stop/Continue and Song Position Pointer. */
  clock: boolean;
}

const KEY = "pulse8.midi";
const DEFAULTS: MidiSettings = { enabled: false, input: "all", output: "all", clock: false };

function loadSettings(): MidiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MidiSettings> | null;
    return { ...DEFAULTS, ...raw };
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

function onMessage(data: Uint8Array, stamp: number): void {
  const status = data[0];
  if (status >= 0xf0) {
    if (!settings.clock) return;
    const t = audioTime(stamp);
    if (t === null) return;
    if (status === 0xf8) lastPulseWall = performance.now();
    clock.handle(data, t);
    return;
  }
  control?.handle(data);
}

// --- lifecycle -----------------------------------------------------------------------------------------

ports.onMessage(onMessage);
ports.onPortsChanged(() => control?.sendAll());

function apply(): void {
  ports.choose({ input: settings.input, output: settings.output });
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
    if (hasEmbeddedHost() && !settings.enabled) settings = { ...settings, enabled: true, clock: false };
    if (settings.enabled) apply();
  },
};
