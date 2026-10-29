# Extending Pulse.8

Recipes for the changes people actually make. Each lists every file you touch and the tests that will tell you if you
missed one. Run `npm test` and `npm run build` (which type-checks) after each.

- [Add a macro knob to a track](#add-a-macro-knob-to-a-track)
- [Add a track](#add-a-track)
- [Add a factory kit or preset](#add-a-factory-kit-or-preset)
- [Add a Punch FX](#add-a-punch-fx)
- [Add a scale or genre preset](#add-a-scale-or-genre-preset)
- [Add an arpeggiator rate or direction](#add-an-arpeggiator-rate-or-direction)
- [Add an externally controllable parameter](#add-an-externally-controllable-parameter)
- [Change the MIDI map](#change-the-midi-map)
- [Persist a new piece of project state](#persist-a-new-piece-of-project-state)
- [Add an action and a control](#add-an-action-and-a-control)

---

## Add a macro knob to a track

A knob is a `ControlSpec` in `engine/spec.ts`.

```ts
exp("cutoff", "FILTER", BassParam.Cutoff, 60, 2500, 250, "Hz"),   // exponential taper
lin("envmod", "ENV MOD", BassParam.EnvMod, 0, 1, 0.6),             // linear, shown as %
```

1. **`spec.ts`** — add `lin(...)` or `exp(...)` to the track's `controls`. Choose a *narrow* range: the whole travel
   should be musical. A stepped control uses the object form with `steps: [...]`.
2. **Persisted data.** Saved `sound` arrays are indexed by control position. Adding a control **changes the length**,
   which `valid()` rejects. Add a fix-up in `persist.ts → parseProject` that gives affected tracks their default sound
   (the ENV MOD fix-up is the model). **Append new controls last** wherever possible.
3. **`presets.ts`** — unspecified controls fall back to their default, so existing presets still work. Set the new value
   in the presets where it matters.
4. **`midi/mapping.ts`** — add the key to `SOUND_KEYS` for that track. The CC is assigned by position
   (70–75), or by name in `SOUND_BY_KEY`. A track is limited to six knobs.
5. UI: nothing. Panels render from `spec.controls`.

Tests: `engine.test.ts` ("keeps every default and preset inside its range") and `midi.test.ts` ("maps every sound knob of
every track") fail if you miss steps 1, 3 or 4. A third test caps a track at **5 macro knobs (6 for the bass)**: that is a
design guard for the macro surface, so raise it deliberately, not to make a test pass.

---

## Add a track

Tracks are rows in `TRACKS`; the rest of the app iterates it. This is the largest change, because the saved shape is
indexed by track.

1. **`spec.ts`** — add the `TrackSpec`: `id` (must equal its index), `name`, `short`, `engine` description, `role`
   (`drum | bass | tone`), the webdsp `kind`, `accent`, `controls`, `fixed` parameters, `gainDb`, and for melodic tracks
   `rootMidi`, `noteLo`, `noteHi`, `defaultNote`. Optionally a `chokeGroup`.
2. **Per-track defaults** are the `mix` field on the same `TrackSpec` (`level`, `delay`, `reverb`); there are no
   parallel arrays to extend.
3. **`presets.ts`** — a drum track needs an entry in every `Kit.drums` array (kits index by drum track id). A synth
   needs a preset list and a case in `presetsFor`.
4. **`state.ts`** — `randomizeTrack` has a density table for drums; give the new one a row. Add it to `demoPattern` if
   you want it to sound at first start.
5. **`midi/mapping.ts`** — a row in `SOUND_KEYS` (track count and melodic tracks come from `TRACKS`).
6. **Persistence.** `valid()` requires `tracks.length === NUM_TRACKS`, so every existing project would be rejected.
   Write a migration that appends a fresh track to older patterns and add a test with an old-shaped project.
7. **Keyboard shortcuts** `1`–`9` follow `NUM_TRACKS` (`App.tsx`); there is no key for a tenth track.
8. **Audio** — `audio.ts` builds buses and an instrument per `TRACKS` entry automatically. Check the voice limit
   (`maxVoices` in `Groovebox.create`).

`BASS_TRACK` and `TONE_TRACK` in `spec.ts` are named constants used by the demo, presets and randomiser; they are not
part of the iteration.

---

## Add a factory kit or preset

All in `presets.ts`, in readable units:

```ts
{ name: "ELECTRO", drums: [
  { tune: 52, sweep: 2.0, decay: 0.35, punch: 0.6, drive: 0.4 },   // kick
  ...
]}
```

A kit gives one object per drum track id (0–5); a synth preset gives one object of control keys. Missing keys use
defaults. The test "keeps every default and preset inside its sweet-spot range" checks the values.

---

## Add a Punch FX

A Punch FX is an entry in `PUNCHES` (`engine/mangler.ts`) and, if it needs a new effect, one new audio slot.

**Using the existing chain** (filter, saturation, crush, phaser, flanger, dub echo, reverb): add one object.

```ts
{
  id: 10,                                  // next free id. Ids are stored in saved FX lanes: never reuse or renumber
  label: "GATE", hint: "STUTTER GATE",
  takeover: true,                          // cut the dry mix and send everything through the chain
  boost: 1,                                // throw level at full (non-takeover only)
  param: { label: "RATE", def: 0.5, format: (n) => `${n.toFixed(2)}` },
  values: (p, l) => ({ ...overrides }),    // p = character knob, l = sweep level 0..1
}
```

`values` returns only the keys it changes; the rest rest. A takeover must include `...OWN` so the wet-only returns step
aside. Keep `l = 0` transparent: the effect must fade in from nothing. The pads, the knob panel, the FX lane and the
written-lane scheduling are all generated from `PUNCHES`; no UI change is needed. `defaultMangler()` sizes the
per-pattern `param` array from the catalogue, and `manglerTarget` falls back to `param.def` for patterns saved before
the pad existed.

**Adding a new effect to the chain:**

1. `mangler.ts` — extend `ManglerKey`, `FxSlot`, `MANGLER_PARAMS` (key → slot + `NodeParam`) and `baseValues()` (a
   *transparent* resting value).
2. `audio.ts` — add the slot to the list in the `Groovebox` constructor (this fixes its position in the chain).
3. If it is a pad with a new `PING_PONG` behaviour, add its id to that set.

Tests: "offers the new catalogue with one parameter each" pins the list of pad labels, so **update that list** when you add a pad; "sweeps in: level 0 is transparent" and the takeover test cover the rest.

Tip: to hear `values` without a browser, evaluate `manglerTarget(base, id, lvl)` and inspect the numbers, as the tests do.

---

## Add a scale or genre preset

`scale.ts`: a `SCALES` entry (`id`, `label`, `intervals` from the root, ascending from 0) or a `SCALE_PRESETS` entry
(`root` 0–11, `scale` id). Scale ids are saved in projects; `normalizeScale` falls back to chromatic for unknown ones,
so removing a scale is safe and renaming it is not.

---

## Add an arpeggiator rate or direction

`arp.ts` is self-contained.

- **Rate:** append to `ARP_RATES` as a length in 16th steps. **Append only**: `ArpSettings.rate` is a saved index.
- **Direction:** extend `ArpDirection` and `ARP_DIRECTIONS`, then add a case to `arpIndex`.

`normalizeArp` clamps stale values on load. The UI builds its choices from these arrays.

---

## Add an externally controllable parameter

Parameters are the contract with MIDI, plugin hosts and automation. `engine/params.ts → build()`:

```ts
defs.push({
  id: "swing", label: "Swing", kind: "norm", min: 0, max: 1, def: 0,
  get: (s) => (s.swing - 0.5) / 0.25,
  set: (v) => setState({ swing: 0.5 + v * 0.25 }),
});
```

- `kind` is `norm` (0..1), `int` (whole numbers, optional `labels`) or `bool`.
- `get` reads `AppState`. `set` **must go through the same action the UI uses**, so the UI follows by itself.
- **Ids are permanent once shipped.** They are the external contract: DAW automation lanes are bound to them.
- If `set` changes state other than `patterns`, `mutes`, `solos`, `pattern` or `arp`, extend the early-return in
  `onParamChange` so the change is reported.

Then give it a CC in `midi/mapping.ts` (next recipe). `paramManifest()` lists it for a host automatically.

---

## Change the MIDI map

Edit `midi/mapping.ts`. It is data, and the engine validates it.

```ts
parameters["track.1.volume"] = { cc: 7, channel: 1 };
parameters["track.7.sound.cutoff"] = { cc: 74, channel: 7, invert: false };
```

Pattern selection is not a CC; it is the `program` entry (Bank Select + Program Change). A mapping entry is
`{ cc, channel?, invert?, label? }`. `channel` is 1–16 and defaults to `defaultChannel`. Unknown
parameter ids, bad channels and doubled CCs are reported as warnings rather than failing (`compileMapping`), and the test
"compiles against the real parameters with no warnings" keeps the shipped map clean.

---

## Persist a new piece of project state

Say you add `s.metronome`.

1. `state.ts` — add to `AppState` and `initialState()`.
2. `persist.ts` — add to `Saved` (optional, since old saves lack it), to `snapshot()`, to the `persisted` list in
   `autosave()`, and to `parseProject`, defaulting when absent and clamping when present.
3. Never make `valid()` stricter without a migration.

If it is performance state (not part of the music), do not persist it; put it in `AppState` only.

---

## Add an action and a control

1. Put the edit in `actions.ts`. It takes plain arguments, calls `editPattern` or `setState`, and may call
   `controller.audition(...)` for immediate feedback. No React.
2. In the component, call the action from the handler and read state with `useStore((s) => …)`. Pick selectors that
   return primitives so only this component re-renders.
3. Use `Knob`/`Slider` from `ui/controls.tsx` for a continuous value (they give double-tap reset and keyboard nudge), and `Stepper` (the BPM readout between − and +) for a small integer or decimal value.
4. Do not read `getState()` during render, and do not call the controller to change state.
5. If the change must reach the audio engine, you normally need nothing: the controller observes `patterns`, `mutes`,
   `solos` and `pattern`, and `applySound`/`applyMix` push what changed. New *kinds* of audio parameter belong in
   `audio.ts`.
