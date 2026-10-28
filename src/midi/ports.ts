// Web MIDI ports: which inputs and outputs exist, which ones are in use, a stream of incoming messages
// and a way to send. Generic. `requestMIDIAccess` is overridable, as in webtracker, so tests (and a
// plugin shim) can supply their own.
//
// Where the browser or WebView has no Web MIDI (Safari, WKWebView) the status is "unsupported" and
// nothing else happens. In the webvst plugin the page sees one virtual input, the DAW's MIDI, and no
// outputs.

export interface PortInfo {
  id: string;
  name: string;
}

export type MidiStatus = "off" | "starting" | "ready" | "unsupported" | "denied";

export interface PortsSnapshot {
  status: MidiStatus;
  inputs: PortInfo[];
  outputs: PortInfo[];
}

export interface PortChoice {
  /** "all", or a port id; outputs also accept "none". */
  input: string;
  output: string;
}

export type MessageHandler = (data: Uint8Array, timeStamp: number) => void;

type Access = {
  inputs: Map<string, MIDIInput>;
  outputs: Map<string, MIDIOutput>;
  addEventListener(type: "statechange", fn: () => void): void;
  removeEventListener(type: "statechange", fn: () => void): void;
};

export interface MidiPorts {
  start(): Promise<void>;
  stop(): void;
  choose(choice: PortChoice): void;
  send(bytes: number[]): void;
  onMessage(fn: MessageHandler): () => void;
  /** Fires when ports appear or go, so a new output can be brought up to date. */
  onPortsChanged(fn: () => void): () => void;
  subscribe(fn: () => void): () => void;
  snapshot(): PortsSnapshot;
}

export function createPorts({
  requestMIDIAccess = typeof navigator !== "undefined" ? navigator.requestMIDIAccess?.bind(navigator) : undefined,
}: { requestMIDIAccess?: (() => Promise<unknown>) | undefined } = {}): MidiPorts {
  let access: Access | null = null;
  let snap: PortsSnapshot = { status: "off", inputs: [], outputs: [] };
  let choice: PortChoice = { input: "all", output: "all" };
  const wired = new Set<MIDIInput>();
  const handlers = new Set<MessageHandler>();
  const subs = new Set<() => void>();
  const portListeners = new Set<() => void>();
  let generation = 0;

  const publish = (patch: Partial<PortsSnapshot>) => {
    snap = { ...snap, ...patch };
    subs.forEach((f) => f());
  };

  const onMessage = (e: Event) => {
    const m = e as MIDIMessageEvent;
    if (m.data) handlers.forEach((h) => h(m.data!, m.timeStamp));
  };

  function refresh() {
    if (!access) return;
    const inputs = [...access.inputs.values()];
    const outputs = [...access.outputs.values()];
    const wanted = new Set(inputs.filter((p) => p.state !== "disconnected" && (choice.input === "all" || choice.input === p.id)));
    for (const p of [...wired]) {
      if (!wanted.has(p)) { p.removeEventListener("midimessage", onMessage); wired.delete(p); }
    }
    for (const p of wanted) {
      if (!wired.has(p)) { p.addEventListener("midimessage", onMessage); wired.add(p); }
    }
    publish({
      inputs: inputs.map((p) => ({ id: p.id, name: p.name ?? p.id })),
      outputs: outputs.map((p) => ({ id: p.id, name: p.name ?? p.id })),
    });
    portListeners.forEach((f) => f());
  }

  return {
    async start() {
      if (access) return;
      if (!requestMIDIAccess) return publish({ status: "unsupported" });
      const mine = ++generation;
      publish({ status: "starting" });
      try {
        const a = (await requestMIDIAccess()) as Access;
        if (mine !== generation) return;
        access = a;
        access.addEventListener("statechange", refresh);
        publish({ status: "ready" });
        refresh();
      } catch {
        if (mine === generation) publish({ status: "denied" });
      }
    },
    stop() {
      generation++;
      for (const p of wired) p.removeEventListener("midimessage", onMessage);
      wired.clear();
      access?.removeEventListener("statechange", refresh);
      access = null;
      publish({ status: "off", inputs: [], outputs: [] });
    },
    choose(next) {
      choice = next;
      refresh();
    },
    send(bytes) {
      if (!access || choice.output === "none") return;
      for (const o of access.outputs.values()) {
        if (o.state === "disconnected") continue;
        if (choice.output === "all" || choice.output === o.id) o.send(bytes);
      }
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    onPortsChanged(fn) {
      portListeners.add(fn);
      return () => portListeners.delete(fn);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    snapshot: () => snap,
  };
}
