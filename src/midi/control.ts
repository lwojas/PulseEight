// The MIDI control engine: channel messages (CC, Program Change) in, parameter changes out, and the
// reverse. It is generic. It knows parameter ids and a mapping, and nothing about this app, its UI
// or any CC number: those come in as data (see mapping.ts), the parameters through `ParamBus`.
// A second groovebox reuses it by handing in its own mapping and its own bus.
//
// Channels: the mapping speaks 1-16 (what a player sees on a controller). On the wire a channel is
// the low nibble of the status byte, 0-15; the conversion happens here and only here.

export type ParamSource = "ui" | "midi" | "host" | "automation" | "internal";

export interface ParamDescription {
  kind: "norm" | "int" | "bool";
  min: number;
  max: number;
}

/** What the engine needs from the application's parameter model. */
export interface ParamBus {
  describe(id: string): ParamDescription | undefined;
  get(id: string): number;
  set(id: string, value: number, source: ParamSource): void;
  /** Hear every change with its origin. Returns the unsubscribe. */
  subscribe(fn: (id: string, value: number, source: ParamSource) => void): () => void;
}

// --- the mapping ---------------------------------------------------------------------------------

export interface CcMapping {
  cc: number;
  /** 1-16. Omitted: the mapping's `defaultChannel`. */
  channel?: number;
  /** Flip the direction (127 = parameter minimum). */
  invert?: boolean;
  /** Only for a human reading the file. */
  label?: string;
}

export interface ProgramMapping {
  /** Parameter (an `int`) that program changes select. */
  param: string;
  /** 1-16. Omitted: the mapping's `defaultChannel`. */
  channel?: number;
  /** Program changes address 0-127 values; a bank is this many of them. Bank Select picks the bank. */
  bankSize: number;
  /** Bank Select MSB controller (0 by convention). */
  bankCc?: number;
}

export interface MidiMapping {
  defaultChannel: number;
  parameters: Record<string, CcMapping>;
  program?: ProgramMapping;
}

// --- value conversion --------------------------------------------------------------------------------

/** Where a boolean flips: 0-63 off, 64-127 on. */
export const BOOL_THRESHOLD = 64;

/** A 7-bit controller value as a parameter value. */
export function midiToValue(p: ParamDescription, cc: number, invert = false): number {
  const c = Math.min(127, Math.max(0, cc | 0));
  const x = invert ? 127 - c : c;
  if (p.kind === "bool") return x >= BOOL_THRESHOLD ? 1 : 0;
  const v = p.min + (x / 127) * (p.max - p.min);
  return p.kind === "int" ? Math.round(v) : v;
}

/** A parameter value as a 7-bit controller value (booleans send 0 or 127). */
export function valueToMidi(p: ParamDescription, value: number, invert = false): number {
  let x: number;
  if (p.kind === "bool") x = value >= 0.5 ? 127 : 0;
  else x = p.max === p.min ? 0 : Math.round(((value - p.min) / (p.max - p.min)) * 127);
  x = Math.min(127, Math.max(0, x));
  return invert ? 127 - x : x;
}

// --- compiling the mapping ----------------------------------------------------------------------------

interface Binding {
  id: string;
  /** 0-15 */
  channel: number;
  cc: number;
  invert: boolean;
  info: ParamDescription;
}

export interface CompiledMapping {
  byCc: Map<number, Binding>;
  byParam: Map<string, Binding>;
  program: { param: string; channel: number; bankSize: number; bankCc: number; info: ParamDescription } | null;
  /** Problems found in the mapping: unknown parameter, bad number, two parameters on one CC. */
  warnings: string[];
}

const ccKey = (channel: number, cc: number) => (channel << 7) | cc;
const isInt = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

export function compileMapping(mapping: MidiMapping, bus: Pick<ParamBus, "describe">): CompiledMapping {
  const out: CompiledMapping = { byCc: new Map(), byParam: new Map(), program: null, warnings: [] };
  const warn = (m: string) => out.warnings.push(m);
  if (!isInt(mapping.defaultChannel, 1, 16)) warn(`defaultChannel ${mapping.defaultChannel} is not 1-16`);
  const fallback = isInt(mapping.defaultChannel, 1, 16) ? mapping.defaultChannel : 1;

  for (const [id, m] of Object.entries(mapping.parameters)) {
    const info = bus.describe(id);
    if (!info) { warn(`${id}: no such parameter`); continue; }
    const channel = m.channel ?? fallback;
    if (!isInt(channel, 1, 16)) { warn(`${id}: channel ${channel} is not 1-16`); continue; }
    if (!isInt(m.cc, 0, 127)) { warn(`${id}: cc ${m.cc} is not 0-127`); continue; }
    const key = ccKey(channel - 1, m.cc);
    const taken = out.byCc.get(key);
    if (taken) { warn(`${id}: channel ${channel} CC ${m.cc} is already ${taken.id}`); continue; }
    const binding: Binding = { id, channel: channel - 1, cc: m.cc, invert: m.invert === true, info };
    out.byCc.set(key, binding);
    out.byParam.set(id, binding);
  }

  const pm = mapping.program;
  if (pm) {
    const info = bus.describe(pm.param);
    const channel = pm.channel ?? fallback;
    const bankCc = pm.bankCc ?? 0;
    if (!info) warn(`program: ${pm.param} is not a parameter`);
    else if (info.kind !== "int") warn(`program: ${pm.param} is not an int parameter`);
    else if (!isInt(channel, 1, 16)) warn(`program: channel ${channel} is not 1-16`);
    else if (!isInt(pm.bankSize, 1, 128)) warn(`program: bankSize ${pm.bankSize} is not 1-128`);
    else if (!isInt(bankCc, 0, 127)) warn(`program: bankCc ${bankCc} is not 0-127`);
    else out.program = { param: pm.param, channel: channel - 1, bankSize: pm.bankSize, bankCc, info };
  }
  return out;
}

// --- the engine ---------------------------------------------------------------------------------------

export interface MidiControlOptions {
  mapping: MidiMapping;
  bus: ParamBus;
  /** Send raw bytes to the output(s). Omitted: input only. */
  send?: (bytes: number[]) => void;
  /** Changes with these origins are not sent out. `midi`: what came in is not echoed back. */
  noSendFrom?: readonly ParamSource[];
}

export interface MidiControl {
  /** One channel message (status 0x80-0xEF) with its data bytes. Anything else is ignored. */
  handle(data: ArrayLike<number>): void;
  /** The mapping as compiled, with any warnings. */
  readonly compiled: CompiledMapping;
  /** Send the current value of every mapped parameter (a controller coming online). */
  sendAll(): void;
  dispose(): void;
}

const CC = 0xb0;
const PROGRAM_CHANGE = 0xc0;

export function createMidiControl({ mapping, bus, send, noSendFrom = ["midi"] }: MidiControlOptions): MidiControl {
  const compiled = compileMapping(mapping, bus);
  const { byCc, byParam, program } = compiled;
  /** Last controller value moved in either direction, so an unchanged value is not sent again. */
  const last = new Map<number, number>();
  /** Bank selected per channel by an incoming Bank Select; applied by the next Program Change. */
  const bank = new Map<number, number>();
  let sentBank = -1;

  function sendCc(channel: number, cc: number, value: number) {
    send?.([CC | channel, cc, value]);
  }

  function output(id: string, value: number) {
    if (program && id === program.param) {
      const b = Math.floor(value / program.bankSize);
      if (b !== sentBank) { sendCc(program.channel, program.bankCc, b); sentBank = b; }
      send?.([PROGRAM_CHANGE | program.channel, value % program.bankSize]);
    }
    const bind = byParam.get(id);
    if (!bind) return;
    const v = valueToMidi(bind.info, value, bind.invert);
    const key = ccKey(bind.channel, bind.cc);
    if (last.get(key) === v) return;
    last.set(key, v);
    sendCc(bind.channel, bind.cc, v);
  }

  const unsubscribe = send
    ? bus.subscribe((id, value, source) => {
        if (noSendFrom.includes(source)) {
          // keep the dedupe table honest about what the controller is showing
          const bind = byParam.get(id);
          if (bind) last.set(ccKey(bind.channel, bind.cc), valueToMidi(bind.info, value, bind.invert));
          return;
        }
        output(id, value);
      })
    : () => {};

  return {
    compiled,
    handle(data) {
      const status = data[0];
      if (!(status >= 0x80 && status < 0xf0)) return;
      const channel = status & 0x0f;
      const type = status & 0xf0;
      if (type === CC) {
        const cc = data[1] & 0x7f;
        const value = data[2] & 0x7f;
        if (program && channel === program.channel && cc === program.bankCc) bank.set(channel, value);
        const bind = byCc.get(ccKey(channel, cc));
        if (!bind) return;
        last.set(ccKey(channel, cc), value);
        bus.set(bind.id, midiToValue(bind.info, value, bind.invert), "midi");
      } else if (type === PROGRAM_CHANGE && program && channel === program.channel) {
        const n = (bank.get(channel) ?? 0) * program.bankSize + (data[1] & 0x7f);
        if (n <= program.info.max) bus.set(program.param, n, "midi");
      }
    },
    sendAll() {
      last.clear();
      sentBank = -1;
      for (const id of byParam.keys()) output(id, bus.get(id));
      if (program) output(program.param, bus.get(program.param));
    },
    dispose: unsubscribe,
  };
}
