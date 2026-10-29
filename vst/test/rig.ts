// The end-to-end rig: Pulse.8's own page code running in Node, through webvst's page shim, against the real plugin engine in a child
// process (harness.cpp), with a DAW simulated here: a transport that advances in real time and a MIDI queue. The page cannot tell it
// from the plugin's WebView, so what is measured is what the plugin plays.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SR = 48000;
const BLOCK = 128;
const BLOCKS_PER_STEP = 8; // 1024 frames (21 ms) per round trip, paced at real time

export function harnessBinary(): string | null {
  const root = path.join(here, "../build");
  const found = (dir: string): string | null => {
    if (!fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const r = found(p);
        if (r) return r;
      } else if (e.name === "Pulse8Harness" && (fs.statSync(p).mode & 0o111) !== 0) return p;
    }
    return null;
  };
  return found(root);
}

export interface Rig {
  /** The DAW. Set `playing`, `ppq` (where it is now), `bpm`; `midi` are note messages to deliver at the next render. */
  daw: { playing: boolean; ppq: number; bpm: number; /** The engine frame at which the DAW's current run started (its `ppq` then). */ startFrame: number };
  /** Frames the engine has rendered. */
  frames(): number;
  /** Moves the DAW's playhead to `ppq` (a locate); resolves to the engine frame at which the new position starts. */
  locate(ppq: number): Promise<number>;
  /** Sends a MIDI message at frame `at` of the next render; resolves, once that render starts, to the engine frame it was sent for. */
  midi(bytes: number[], at?: number): Promise<number>;
  /** Stops delivering the page's messages to the plugin and the plugin's events to the page: the editor window closed. */
  closeWindow(): void;
  /** Resolves after `seconds` of simulated (real) time. */
  wait(seconds: number): Promise<void>;
  /** Resolves when the DAW position (ppq) has reached `ppq`. */
  until(ppq: number): Promise<void>;
  /** The left channel rendered so far. */
  audio(): Promise<Float32Array>;
  /** The page's side of the bridge, for tests that want to look at what was sent. */
  sent: Array<Record<string, unknown>>;
  stop(): Promise<void>;
}

export async function startRig(): Promise<Rig> {
  const bin = harnessBinary();
  if (!bin) throw new Error("Pulse8Harness is not built: npm run vst:e2e");
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting: Array<(v: Record<string, unknown>) => void> = [];
  lines.on("line", (l) => {
    if (!l.startsWith("{")) return;
    waiting.shift()?.(JSON.parse(l));
  });
  const ask = (op: Record<string, unknown>) =>
    new Promise<Record<string, any>>((resolve) => {
      waiting.push(resolve);
      child.stdin.write(JSON.stringify(op) + "\n");
    });

  // ---- the page's side: webvst's shim over a fake JUCE backend ----
  const sent: Array<Record<string, unknown>> = [];
  let open = true;
  const listeners: Record<string, (e: unknown) => void> = {};
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.__JUCE__ = {
    backend: {
      emitEvent: (_channel: string, message: Record<string, unknown>) => {
        if (!open) return;
        sent.push(message);
        child.stdin.write(JSON.stringify({ op: "msg", msg: message }) + "\n");
      },
      addEventListener: (channel: string, fn: (e: unknown) => void) => ((listeners[channel] = fn), 1),
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  const webvst = process.env.PULSE8_WEBVST_DIR ?? path.join(here, "../../../webvst");
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(webvst, "src/shim.js"), "utf8"));

  // ---- the DAW ----
  const daw = { playing: false, ppq: 0, bpm: 120, startFrame: 0 };
  let wasPlaying = false;
  let pendingLocate: { ppq: number; resolve: (frame: number) => void } | null = null;
  const midiQueue: Array<{ frame: number; bytes: number[]; resolve: (frame: number) => void }> = [];
  let frames = 0;
  let running = true;
  const pump = (async () => {
    while (running) {
      const t0 = performance.now();
      // what this render is sent with: the test may change the DAW while the round trip is in flight
      if (pendingLocate) {
        daw.ppq = pendingLocate.ppq;
        pendingLocate.resolve(frames);
        pendingLocate = null;
      }
      const sentPlaying = daw.playing;
      const sentPpq = daw.ppq;
      if (sentPlaying && !wasPlaying) daw.startFrame = frames;
      wasPlaying = sentPlaying;
      const midi = midiQueue.splice(0).map((m) => {
        m.resolve(frames + m.frame);
        return { frame: m.frame, bytes: m.bytes };
      });
      const reply = await ask({ op: "render", blocks: BLOCKS_PER_STEP, playing: sentPlaying, ppq: sentPpq, bpm: daw.bpm, midi });
      frames = reply.frames as number;
      // advance the DAW's position by what was rendered, unless the test moved it meanwhile (a locate)
      if (sentPlaying && daw.ppq === sentPpq && daw.playing) daw.ppq = sentPpq + ((BLOCKS_PER_STEP * BLOCK) / SR) * (daw.bpm / 60);
      if (open) for (const e of reply.events as unknown[]) listeners.webvst?.(e);
      await new Promise((r) => setTimeout(r, Math.max(0, (BLOCKS_PER_STEP * BLOCK * 1000) / SR - (performance.now() - t0))));
    }
  })();

  const wait = (seconds: number) => new Promise<void>((r) => setTimeout(r, seconds * 1000));
  return {
    daw,
    frames: () => frames,
    locate: (ppq) => new Promise<number>((resolve) => { pendingLocate = { ppq, resolve }; }),
    midi: (bytes, at = 300) => new Promise<number>((resolve) => midiQueue.push({ frame: at, bytes, resolve })),
    closeWindow: () => { open = false; },
    wait,
    until: async (ppq) => {
      while (daw.ppq < ppq) await wait(0.01);
    },
    audio: async () => {
      const file = path.join(os.tmpdir(), `pulse8-e2e-${process.pid}.f32`);
      // between renders: the pump is mid-round-trip only briefly, so ask through the same queue
      await ask({ op: "dump", path: file });
      const buf = fs.readFileSync(file);
      fs.unlinkSync(file);
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    },
    sent,
    stop: async () => {
      running = false;
      await pump;
      child.stdin.end();
      child.kill();
    },
  };
}

/** Frames at which a sound begins: the 5 ms level crosses `threshold` upwards after having been below it (a hit's own tail must have died
 * away first). A bass-heavy hit ripples inside any shorter window, and a rise-ratio rule depends on how its attack lines up with the
 * analysis grid; a crossing does not. Each onset is refined to the first frame reaching a tenth of the hit's local peak. */
export function onsets(x: Float32Array, opts: { threshold?: number } = {}): number[] {
  const { threshold = 0.02 } = opts;
  const win = 240;
  const hop = 48;
  const env: number[] = [];
  for (let i = 0; i + win <= x.length; i += hop) {
    let s = 0;
    for (let j = 0; j < win; j++) s += x[i + j] * x[i + j];
    env.push(Math.sqrt(s / win));
  }
  const out: number[] = [];
  let armed = true;
  for (let b = 0; b < env.length; b++) {
    if (env[b] < threshold * 0.5) armed = true;
    if (armed && env[b] > threshold) {
      armed = false;
      let peak = 0;
      for (let j = 0; j < win * 3 && b * hop + j < x.length; j++) peak = Math.max(peak, Math.abs(x[b * hop + j]));
      let k = -win;
      while (b * hop + k < x.length && Math.abs(x[Math.max(0, b * hop + k)]) < peak * 0.1) k++;
      out.push(Math.max(0, b * hop + k));
    }
  }
  return out;
}

export function rmsBetween(x: Float32Array, from: number, to: number): number {
  let s = 0;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(x.length, Math.floor(to));
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
