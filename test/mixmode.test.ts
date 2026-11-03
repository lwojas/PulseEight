import { beforeEach, describe, expect, it } from "vitest";
import { setLevel, setMixMode, toggleMute, toggleSolo } from "../src/engine/actions";
import { levelOf, initialState, muteOf, soloOf } from "../src/engine/state";
import { getState, replaceState, setState } from "../src/engine/store";

const here = () => getState().patterns[getState().pattern];

describe("mix mode", () => {
  beforeEach(() => replaceState(initialState()));

  it("SONG: faders, mutes and solos belong to the pattern", () => {
    toggleMute(0);
    toggleSolo(1);
    setLevel(2, 0.3);
    setState({ pattern: 1 });
    expect(muteOf(getState(), here(), 0)).toBe(false);
    expect(soloOf(getState(), here(), 1)).toBe(false);
    expect(levelOf(getState(), here(), 2)).not.toBe(0.3);
    setState({ pattern: 0 });
    expect(muteOf(getState(), here(), 0)).toBe(true);
    expect(soloOf(getState(), here(), 1)).toBe(true);
    expect(levelOf(getState(), here(), 2)).toBe(0.3);
  });

  it("SONG: unmuting leaves the pattern as a fresh one", () => {
    toggleMute(0);
    toggleMute(0);
    expect(here().tracks[0].mute).toBeUndefined();
  });

  it("PERFORM: faders, mutes and solos ride across pattern switches", () => {
    setMixMode("perform");
    toggleMute(0);
    toggleSolo(1);
    setLevel(2, 0.3);
    setState({ pattern: 1 });
    expect(muteOf(getState(), here(), 0)).toBe(true);
    expect(soloOf(getState(), here(), 1)).toBe(true);
    expect(levelOf(getState(), here(), 2)).toBe(0.3);
    expect(here().tracks[2].level).not.toBe(0.3); // the pattern's own fader is untouched
  });

  it("entering PERFORM starts from the current pattern's mix", () => {
    setLevel(3, 0.4);
    toggleMute(5);
    setMixMode("perform");
    expect(levelOf(getState(), here(), 3)).toBe(0.4);
    expect(muteOf(getState(), here(), 5)).toBe(true);
  });
});
