# Architecture

Pulse.8 is a TypeScript application: React for the interface, a plain-TypeScript engine for everything that matters
musically, and [webdsp](https://github.com/lwojas/webdsp) for sound. The one rule that shapes everything else:

> **The engine does not know the UI exists. The UI does not know the audio exists.** Both talk to a single immutable
> state object.

## Layers

```
 ┌───────────────────────────── src/ui ─────────────────────────────┐
 │  React components. Read state with useStore(selector).           │
 │  Change state by calling actions. Never touch audio.             │
 └───────────────┬───────────────────────────────────────▲──────────┘
                 │ actions.ts                            │ useStore
 ┌───────────────▼───────────────────────────────────────┴──────────┐
 │  src/engine/store.ts: one immutable AppState                     │
 │  getState · setState · observe(next, prev) · editPattern         │
 └──────┬──────────────────┬────────────────────┬───────────────────┘
        │ observe          │ observe            │ observe
 ┌──────▼─────────┐ ┌──────▼─────────┐ ┌────────▼─────────┐
 │ controller.ts  │ │ persist.ts     │ │ params.ts        │
 │ clock, steps,  │ │ autosave to    │ │ stable ids, over │
 │ chain, punch   │ │ IndexedDB      │ │ the same state   │
 └──────┬─────────┘ └────────────────┘ └────────┬─────────┘
        │ drives                                │ used by
 ┌──────▼─────────┐                    ┌────────▼─────────┐
 │ audio.ts       │                    │ src/midi         │
 │ the only user  │                    │ CC · PC · clock  │
 │ of webdsp      │                    │ in and out       │
 └────────────────┘                    └──────────────────┘
```

### Why it is built this way

- **One source of truth.** `AppState` is the project plus the performance state. There is no second copy in a
  component, in the audio layer, or in MIDI.
- **Pure where it can be.** `state.ts`, `spec.ts`, `mangler.ts`, `arp.ts`, `scale.ts`, `trackfx.ts`, `presets.ts`,
  `song.ts` and `midi/clock.ts` import neither React nor webdsp's runtime. They are unit-tested directly.
- **One audio module.** `audio.ts` is the only file that calls webdsp's `AudioRuntime`. Retargeting the sound engine
  means changing that file and the parameter ids in `spec.ts`.
- **One MIDI contract.** CC numbers exist in `midi/mapping.ts` and nowhere else.

## Module map

### `src/engine/`

| File | Responsibility |
|---|---|
| `../product.ts` | Product identity: name, logo, and the `id` that prefixes every storage key and file stamp. Start a clone here (see [REFERENCE_RESKIN.md](../../REFERENCE_RESKIN.md)). |
| `spec.ts` | **The track definitions.** Which webdsp instrument backs each role, which parameters are exposed as macro controls, over what range and taper. Normalised ↔ engine-unit conversion and readout formatting. Note naming. |
| `state.ts` | `AppState`, `Pattern`, `TrackPattern` (with its optional `last` step, `trackLast` / `trackStepAt`), `Step`; constructors; the demo groove; the pure pattern edits (`randomizeTrack`, `clearTrackSteps`). |
| `store.ts` | The store. `setState`, `observe`, `editPattern`, the `useStore` hook. |
| `actions.ts` | User-level edits. UI components and `params.ts` call these. They edit the store and audition. |
| `stepcompile.ts`, `nativeseq.ts`, `hostplay.ts` | One step's notes, shared by the live scheduler and the native sequence; the song as a webdsp `Sequence` for a plugin host; following the DAW's transport. See [VST3 build](vst.md). |
| `plock.ts` | Parameter locks: per-step overrides of a track's sound controls and sends (`Step.parameterLocks`), resolved against the pattern's base values. Pure. |
| `record.ts` | Realtime note recording: pure helpers that map a key press to the nearest step (`recordStep`) and a held time to a gate (`gateForHeld`). |
| `controller.ts` | The groovebox controller: transport, the lookahead scheduler, pattern switching and chaining, the punch-in and write logic, the arpeggiator hosts. Owns the `Groovebox`. |
| `audio.ts` | `Groovebox`: builds and drives the webdsp graph. Mixer, sends, the punch bus, scheduled parameter ramps. |
| `mangler.ts` | The Punch FX catalogue: what every pad does to the shared effect chain at a given amount and sweep level. Pure data and functions. |
| `trackfx.ts` | Per-track delay and reverb send models and their mappings. |
| `arp.ts` | The arpeggiator. Instrument-agnostic. Notes in, timed events out. |
| `scale.ts` | Keys, scales, genre presets. |
| `presets.ts` | Factory kits and synth presets, authored in readable engine units. |
| `persist.ts`, `db.ts` | Autosave, named saves, export/import, migrations. `db.ts` is the only IndexedDB code. |
| `params.ts` | The registry of externally controllable parameters, by stable id, with change notification. |
| `source.ts` | The ambient *origin* tag for a change (`ui`, `midi`, `host`, `automation`, `internal`). |
| `song.ts` | Maps a linear song position onto the chain or the current pattern. |
| `playhead.ts`, `keyhl.ts` | Direct-to-DOM playhead (per track: a track with a last step lights its own step) and piano-key highlights, bypassing React. |
| `ticker.ts` | A Web Worker timer that drives the scheduler. |

### `src/midi/`

| File | Responsibility |
|---|---|
| `mapping.ts` | **The map.** CC → parameter id. Data only. |
| `control.ts` | Generic MIDI control engine: mapping + a `ParamBus` in, messages out and back. Knows nothing about Pulse.8. |
| `clock.ts` | Pure MIDI clock / Start / Stop / Continue / SPP follower. |
| `ports.ts` | Web MIDI port management. |
| `setup.ts` | The only MIDI file that imports the app: connects the above to the parameters and the transport. |

### `src/ui/`

`Header`, `Sequencer`, `Panels`, `ProjectMenu`, `ArpControl`, `Modal`, `controls` (Knob, Slider, press handling),
plus small hooks. `src/index.css` is the whole stylesheet.

## Data flow, by example

**A tap on a drum pad.** `Sequencer.tsx` → `tapStep` (`actions.ts`) → `editPattern` clones the pattern and calls
`setState`. Observers run: the controller sees `patterns` changed and syncs the audio graph; `persist` marks the project
dirty; `params` notifies MIDI output. React re-renders only the components whose selector result changed.

**A MIDI CC.** `ports.ts` → `setup.ts` → `control.ts` converts 0–127 to the parameter's domain and calls
`setParam("track.7.sound.cutoff", v, "midi")` → `withSource("midi", …)` → the same action the knob uses → the
store. The origin tag lets MIDI output skip echoing it back.

**A step plays.** The worker tick → `controller.tick()` schedules audio ~120 ms ahead → later, when that step becomes
*audible*, `publishAudible` moves the playhead (direct DOM) and updates the store only for things that change rarely.
See [Timing & scheduling](timing.md).

## Design principles in the code

- **Controls are stored normalised (0..1).** Ranges are tuned in `spec.ts`; saved patterns survive retuning.
- **Ranges are narrower than the engine's, on purpose.** The whole knob travel should sound good.
- **Sound belongs to the pattern.** Pattern switching is a state change the audio layer applies at the loop boundary.
- **Performance state is not saved.** Mute, solo, arming and the visible screen are not in `Saved`.
- **Caches everywhere on the audio side.** `Groovebox` remembers the last value it sent for every parameter and sends
  only changes.

## Interface design

The visual language lives in `concept/DESIGN/` (`DESIGN.md` tokens and a reference mock-up). `src/index.css` implements
it: dark surfaces, three accent colours (`--drum`, `--bass`, `--tone`) and `--fx`, tabular mono readouts.

Layout is CSS-only, by media query: phone (tabs, below 1100 px wide) and desktop (one page, 1100 px and up, with narrower
overrides below 1300 and 1500 px). Desktop also has a short-window block (`min-width: 1100px` and `max-height: 820px`, with a
tighter step at 680 px): the band is the tallest fixed-height row, so it is compacted there to keep the sequencer keyboard on
screen. A DAW's default plugin window is about 1100×700, so check that size (and 1100×640) after any change to the band
panels. Heights come from the `--cell-h`/`--keys-h` tokens at the top of the file.
