// The project in a plugin host's session (persist.ts): restore on open, publish on edit. The host is a fake of webdsp's
// HostStateBridge installed where the plugin's shim puts it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostStateSnapshot } from "webdsp";
import { autosave, fromHostSnapshot, HOST_ANSWER_TIMEOUT_MS, HOST_PUBLISH_DEBOUNCE_MS, restoreFromHost, toHostSnapshot } from "../src/engine/persist";
import { editPattern, getState, setState } from "../src/engine/store";
import { initialState } from "../src/engine/state";

class FakeHost {
  published: HostStateSnapshot[] = [];
  private listeners: Array<(s: HostStateSnapshot | null) => void> = [];
  publish = (s: HostStateSnapshot) => void this.published.push(s);
  clear = () => {};
  onRestore = (fn: (s: HostStateSnapshot | null) => void) => {
    this.listeners.push(fn);
    return () => {};
  };
  answer(s: HostStateSnapshot | null) {
    this.listeners.forEach((fn) => fn(s));
  }
}

const install = (host: FakeHost) => ((globalThis as { __webdspHost?: unknown }).__webdspHost = { state: host });
const reset = () => setState({ ...initialState() });
const edit = () => editPattern((p) => void (p.tracks[0].steps[3].on = !p.tracks[0].steps[3].on), 0);

beforeAll(() => {
  // timers are looked up per call so the fake ones installed by each test are the ones used
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: () => {},
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
});
beforeEach(() => {
  vi.useFakeTimers();
  reset();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { __webdspHost?: unknown }).__webdspHost;
});

/** A snapshot of a project that differs from the default (a tempo nobody would pick by accident). */
function savedSnapshot(bpm = 97.5): HostStateSnapshot {
  setState({ bpm, projectName: "From the DAW" });
  const snap = toHostSnapshot();
  reset();
  return snap;
}

describe("host snapshot", () => {
  it("round-trips the project, stamped with the app", () => {
    const snap = savedSnapshot();
    expect(snap.app).toBe("pulse8");
    const project = fromHostSnapshot(snap)!;
    expect(project.bpm).toBe(97.5);
    expect(project.projectName).toBe("From the DAW");
    expect(project.patterns).toHaveLength(64);
  });
  it("is small: untouched patterns are not written out", () => {
    expect(toHostSnapshot().data.length).toBeLessThan(200_000);
  });
  it("refuses another app's state, an unknown format and garbage, without throwing", () => {
    const snap = savedSnapshot();
    expect(fromHostSnapshot({ ...snap, app: "webseq" })).toBeNull();
    expect(fromHostSnapshot({ ...snap, format: 99 })).toBeNull();
    expect(fromHostSnapshot({ ...snap, data: "{nope" })).toBeNull();
    expect(fromHostSnapshot({ ...snap, data: "{}" })).toBeNull();
  });
});

describe("restoreFromHost", () => {
  it("installs the saved session before resolving", async () => {
    const host = new FakeHost();
    const snap = savedSnapshot();
    const done = restoreFromHost(host, () => {});
    host.answer(snap);
    await done;
    expect(getState().bpm).toBe(97.5);
  });
  it("keeps the default project when the host has nothing saved (null)", async () => {
    const host = new FakeHost();
    const done = restoreFromHost(host, () => {});
    host.answer(null);
    await done;
    expect(getState().bpm).toBe(initialState().bpm);
  });
  it("starts fresh on a snapshot it cannot read", async () => {
    const host = new FakeHost();
    const snap = savedSnapshot();
    const done = restoreFromHost(host, () => {});
    host.answer({ ...snap, app: "webtracker" });
    await done;
    expect(getState().bpm).toBe(initialState().bpm);
  });
  it("gives up waiting for a host that never answers (an older plugin)", async () => {
    const host = new FakeHost();
    const done = restoreFromHost(host, () => {});
    vi.advanceTimersByTime(HOST_ANSWER_TIMEOUT_MS + 1);
    await done;
    expect(getState().bpm).toBe(initialState().bpm);
  });
  it("ignores a first answer that arrives after the timeout once the project was edited", async () => {
    const host = new FakeHost();
    const snap = savedSnapshot();
    const done = restoreFromHost(host, () => {});
    vi.advanceTimersByTime(HOST_ANSWER_TIMEOUT_MS + 1);
    await done;
    edit();
    const edited = getState().patterns;
    host.answer(snap);
    expect(getState().patterns).toBe(edited);
    expect(getState().bpm).toBe(initialState().bpm);
  });
  it("installs a late answer if nothing was edited, and a later session revert after stopping playback", async () => {
    const host = new FakeHost();
    const stop = vi.fn();
    const [first, revert] = [savedSnapshot(101), savedSnapshot(88)];
    const done = restoreFromHost(host, stop);
    vi.advanceTimersByTime(HOST_ANSWER_TIMEOUT_MS + 1);
    await done;
    host.answer(first);
    expect(getState().bpm).toBe(101);
    expect(stop).not.toHaveBeenCalled(); // the first answer: nothing was playing yet
    host.answer(revert);
    expect(getState().bpm).toBe(88);
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("installs a snapshot delivered again only once", async () => {
    const host = new FakeHost();
    const stop = vi.fn();
    const snap = savedSnapshot();
    const done = restoreFromHost(host, stop);
    host.answer(snap);
    await done;
    setState({ bpm: 120 }); // an edit; a duplicate delivery (a re-subscribe) must not undo it
    host.answer(snap);
    expect(getState().bpm).toBe(120);
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("publishing to the host", () => {
  it("publishes edits after a short debounce, not the untouched project, and not non-project changes", () => {
    const host = new FakeHost();
    install(host);
    autosave();
    setState({ tab: "mix", selStep: 4 }); // performance state is not part of the project
    vi.advanceTimersByTime(HOST_PUBLISH_DEBOUNCE_MS * 2);
    expect(host.published).toHaveLength(0);

    edit();
    edit();
    vi.advanceTimersByTime(HOST_PUBLISH_DEBOUNCE_MS - 1);
    expect(host.published).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(host.published).toHaveLength(1); // one publish for the burst
    expect(fromHostSnapshot(host.published[0])).not.toBeNull();
  });
});
