// Where a parameter change came from. A change carries its origin so a listener can decide what to do
// with it (MIDI output, for one, never sends back what MIDI input just set) without guessing from timing.
//
//   ui          a person using the app's own controls (the default for anything not tagged)
//   midi        an incoming MIDI message
//   host        the plugin host (VST parameter / automation lane)
//   automation  app-side automation playback
//   internal    the app moving its own state: pattern changes by the chain or a cue, loading a project
//
// The origin is ambient for the duration of one synchronous store write (`withSource`), so the
// existing actions need no extra argument and no second state is kept.
export type ParamSource = "ui" | "midi" | "host" | "automation" | "internal";

let active: ParamSource = "ui";

export const currentSource = (): ParamSource => active;

export function withSource<T>(source: ParamSource, fn: () => T): T {
  const prev = active;
  active = source;
  try {
    return fn();
  } finally {
    active = prev;
  }
}
