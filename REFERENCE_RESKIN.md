# Reference groovebox: reskin and clone guide

For developers and coding agents starting a **new groovebox product** from this repository.

## Purpose

Pulse.8 is the validated reference groovebox: sequencer, parameter locks, mixer and sends, Punch FX, patterns and song
chain, MIDI, persistence and a tested VST3 build, around eight webdsp instruments. Clone it, keep that
infrastructure, and replace the product layer. The aim is that the first 70–80% of a new product comes from here
without fighting the architecture.

This is a **starting point, not a framework contract.** There is no plugin system or config DSL, and none is planned.
Product choices live in a few plain TypeScript files; everything else is ordinary code you can edit.

Read [docs/dev/architecture.md](docs/dev/architecture.md) for the layering and [docs/dev/extending.md](docs/dev/extending.md)
for step-by-step recipes. This file is the map between them and the act of cloning.

## What to change first

In this order. Run `npm test && npm run build` after each step.

1. **Product identity: `src/product.ts`.** Name, logo halves, and `id`. The `id` prefixes the IndexedDB name,
   localStorage keys, the project-file stamp and extension, and the host-state stamp. Pick it now: changing it later
   orphans saves. Then update `<title>` in `index.html`, `name`/`description` in `package.json`, and the user-facing
   text in `README.md` and `docs/`. Update the hard-coded `"pulse8"` in `test/product.test.ts` and `test/hoststate.test.ts`.
2. **Theme: `src/index.css`.** Colours, fonts and sizes are CSS custom properties in `:root` (`--bg`, `--drum`, `--bass`,
   `--tone`, `--fx`, `--write`, `--font-*`, sizes). Change those first. Update `theme-color` in `index.html` and the
   Google Fonts `<link>` if you change typefaces. Layout rules below `:root` should rarely need to change.
3. **Assets.** There are none beyond fonts and inline SVG icons (`ProjectMenu.tsx`, `Panels.tsx`). `concept/DESIGN/` is
   the design reference for this product; replace or delete it.
4. **Track lineup: `TRACKS` in `src/engine/spec.ts`.** One row per track: name, webdsp `kind`, role, accent, macro
   knobs, fixed engine parameters, `gainDb`, and the starting `mix` (level, delay send, reverb send). Everything else
   iterates this array.
5. **Instruments.** Swapping what a track plays is a `TRACKS` row (`kind`, `controls`, `fixed`) plus its sound
   knobs in `src/midi/mapping.ts` and its presets in `src/engine/presets.ts`. See the checklist below.
6. **Presets and default content.** `src/engine/presets.ts` (kits, synth presets), `demoPattern()` in `state.ts` (the
   groove at first start), `bpm` and the other fields in `initialState()`, `scale.ts` (genre presets), `mangler.ts`
   (Punch FX catalogue).
7. **Labels.** Panel titles and button text are JSX strings in `src/ui/`. Search for the uppercase label. Track names
   come from `TRACKS`; control labels from each `ControlSpec`.
8. **Product-specific divergence.** Only now add or remove features. See [When to diverge](#when-to-diverge).
9. **Plugin build.** `vst/CMakeLists.txt` (target and product names, `PULSE8_*` variables, `PULSE8_DEFAULT_URL`),
   `WEBVST_APP_ID` must equal `PRODUCT.id`, the `vst:*` scripts in `package.json`, `.github/workflows/deploy.yml`
   (checkout path, Pages URL). Rename `vst/test/pulse8.e2e.ts` to match.

### Swapping or adding an instrument: the checklist

Track count is `TRACKS.length`; the engine, mixer, params, sequencer UI and persistence iterate it. The places that
hold per-track *data* indexed by track are exactly these:

| File | What | Notes |
|---|---|---|
| `engine/spec.ts` | The `TrackSpec` row | Includes `mix` defaults. Also the `BASS_TRACK` / `TONE_TRACK` constants. |
| `midi/mapping.ts` | `SOUND_KEYS` row (knob keys, in order), `SOUND_BY_KEY` | Track count and melodic tracks are derived from `TRACKS`. A test fails if `SOUND_KEYS` drifts from the spec. |
| `engine/presets.ts` | `Kit.drums` entry per drum track; synth preset lists; `presetsFor` | Kits are indexed by drum track id. |
| `engine/state.ts` | `demoPattern()`, the `density` table in `randomizeTrack` | Missing density rows fall back to a default. |
| `engine/persist.ts` | `parseProject` | Saves are indexed by track; changing the lineup invalidates old saves. A new product has no old saves, so **delete the legacy migrations** (the bass ENV MOD fix-up and `migrate`) rather than maintaining them. |

Role (`drum` | `bass` | `tone`) decides drum-pad versus piano-roll UI, arpeggiator availability, choke and note range.
Behaviour is selected by `role`, not by instrument identity, anywhere outside the table above.

`BASS_TRACK`, `TONE_TRACK` and `presetsFor` are the remaining places that name specific tracks. They are used for the
demo groove, the initial focus and the preset lists. If your lineup has no bass or tone track, retarget them (they are
a handful of references; the compiler will list them).

## Architecture map

Real paths in this repository. Each is labelled **reuse** (infrastructure), **product** (expect to replace) or **mixed**.

| Area | Where | |
|---|---|---|
| Entry and shell | `index.html`, `src/main.tsx`, `src/App.tsx` | mixed. Shell layout and tabs; keys `1`–`N` follow `NUM_TRACKS`. |
| Product identity | `src/product.ts` | product |
| Track lineup, macro knobs | `src/engine/spec.ts` | **product** |
| State model, defaults, demo groove | `src/engine/state.ts` | mixed. Types and edits reuse; `demoPattern`, `initialState` values product. |
| Store | `src/engine/store.ts` | reuse |
| User actions | `src/engine/actions.ts` | reuse |
| Sequencing and timing | `controller.ts`, `stepcompile.ts`, `ticker.ts`, `song.ts`, `arp.ts` | reuse |
| Parameter locks, recording | `plock.ts`, `record.ts` | reuse |
| Audio graph, mixer, sends, punch bus | `audio.ts`, `trackfx.ts` | reuse. `audio.ts` builds buses and an instrument per `TRACKS` row. |
| Punch FX | `mangler.ts` | mixed. Catalogue is product content; the chain is infrastructure. |
| Presets | `presets.ts` | **product** |
| Scales | `scale.ts` | reuse (genre presets are content) |
| Persistence | `persist.ts`, `db.ts` | reuse (identity from `product.ts`) |
| Parameter registry | `params.ts` | reuse. Ids `track.N.*` are the external contract for MIDI and DAW automation. |
| MIDI | `midi/mapping.ts` (data), `control.ts`, `clock.ts`, `ports.ts`, `setup.ts` | mapping is product data; the rest reuse |
| VST / host | `hostplay.ts`, `nativeseq.ts`, `persist.ts` host snapshot, `vst/` | reuse; see [docs/dev/vst.md](docs/dev/vst.md) |
| UI | `src/ui/` | mixed. `controls.tsx`, `Modal.tsx` reuse; `Panels.tsx`, `Sequencer.tsx` reuse with product labels |
| Styling | `src/index.css` | product (tokens at the top) |
| Tests | `test/` | reuse; update the lineup-specific expectations |

## Safe extension points

| To… | Edit | Recipe |
|---|---|---|
| Add or replace an instrument | `TRACKS` row, `SOUND_KEYS`, presets | [extending.md → Add a track](docs/dev/extending.md#add-a-track) |
| Add a macro knob | `ControlSpec` in `spec.ts`, `SOUND_KEYS` | [Add a macro knob](docs/dev/extending.md#add-a-macro-knob-to-a-track) |
| Change track names, accents, gain, starting mix | `TRACKS` row | |
| Change the number of tracks | `TRACKS`, plus the table above | Keep `id` equal to the array index |
| Change presets or kits | `presets.ts` | [Add a factory kit or preset](docs/dev/extending.md#add-a-factory-kit-or-preset) |
| Change default content | `demoPattern()`, `initialState()` | |
| Change the Punch FX set | `PUNCHES` in `mangler.ts` | [Add a Punch FX](docs/dev/extending.md#add-a-punch-fx) |
| Change MIDI assignments | `midi/mapping.ts` | [Change the MIDI map](docs/dev/extending.md#change-the-midi-map) |
| Change look | `:root` tokens in `index.css` | |
| Persist new state | `state.ts`, `persist.ts` | [Persist a new piece of project state](docs/dev/extending.md#persist-a-new-piece-of-project-state) |
| Add a control and action | `actions.ts`, a component | [Add an action and a control](docs/dev/extending.md#add-an-action-and-a-control) |
| Add product behaviour | A new action plus component, or a new module under `src/engine/` that observes the store | |

## Things not to modify unnecessarily

These are validated together, including against a real DAW. Reuse them as they are.

- **Timing and scheduling**: `controller.ts` (lookahead scheduler), `ticker.ts`, `stepcompile.ts`. See [timing.md](docs/dev/timing.md).
- **Audio integration**: `audio.ts` is the only user of webdsp's `AudioRuntime`, with change-only parameter writes and scheduled ramps.
- **Parameter locks**: `plock.ts` and its handling in `stepcompile.ts`, `nativeseq.ts` and `params.ts`.
- **Mixer, sends, routing**: `audio.ts`, `trackfx.ts`.
- **MIDI engine**: `control.ts`, `clock.ts`, `ports.ts`, `setup.ts`. Edit `mapping.ts`, not these.
- **VST path**: `hostplay.ts`, `nativeseq.ts`, host-state functions in `persist.ts`, `vst/CMakeLists.txt` structure. Rename things; don't redesign.
- **Parameter ids** in `params.ts`: shipped ids are bound to DAW automation lanes and MIDI maps.
- **The store contract**: the engine does not know the UI exists; the UI does not touch audio.

## When to diverge

Do it when the product needs it. If a product has a different interaction model (no step grid, different pattern
structure, a different voice architecture), change the core and accept the cost. Don't bend that product to match this
one. The cost of divergence is that you own the tests and the VST implications of the changed piece, which is a good
reason to diverge deliberately and in one place.

Some things were left as plain, product-shaped code on purpose, because turning them into configuration would be more
complicated than the thing itself. Expect to edit them directly:

- **Track roles are three fixed values** (`drum | bass | tone`) with the UI, arpeggiator and note-range behaviour keyed on them. A fourth kind of track (sampler, chord voice) means new UI and probably a new role.
- **Fixed track-count assumptions elsewhere**: the UI is laid out for around eight tracks (rail, mixer, phone layout) and the `1`–`9` shortcuts. More tracks means layout work, not just a `TRACKS` row.
- **Preset lists per instrument** are separate exports selected by `presetsFor`, not attached to a `TrackSpec`.
- **`randomizeTrack`** density table and `demoPattern` are tuned to this lineup.
- **Per-track CC layout** (channel per track, same CC numbers on every channel) is a mapping decision in `mapping.ts`, not an engine constraint; replace it freely.
- **CSS accent classes** `--drum`/`--bass`/`--tone` are named after roles. Rename if you like; `TrackSpec.accent` is typed to them.
- **The Punch FX chain** is a fixed set of slots; the catalogue on top is data, the slots are not.
- **Legacy persistence migrations** are Pulse.8's history; delete them in a new product.

## Agent instructions

If you are a coding agent working in a clone of this repository, read this file before making changes.

> Prefer configuration, composition and replacement over modification of generic infrastructure. First determine
> whether the requested change is product-specific or architectural. Avoid refactoring stable systems unless the change
> clearly improves reuse without materially increasing complexity.

Concretely:

1. Classify the request: **identity / skin / lineup / content** (edit the files in [What to change first](#what-to-change-first)) or **behaviour** (add an action, component or engine module).
2. Do not edit the files under [Things not to modify](#things-not-to-modify-unnecessarily) to satisfy a product request. If one genuinely blocks it, state why and make the smallest change.
3. Branch on `role`, never on a track id or instrument name, in generic code. If a behaviour belongs to one instrument, put it in that instrument's `TrackSpec` or the UI component for it.
4. Don't introduce a registry, plugin interface or config layer. A table in `spec.ts` or `presets.ts` is the established pattern.
5. Keep existing parameter ids, saved shapes and the test suite passing; where saved data changes in a new product, update the tests rather than adding migrations.
6. Run `npm test` and `npm run build` after each step. The VST end-to-end suite (`npm run vst:e2e`) needs webvst and webdsp checkouts and a native toolchain; run it if you touched the host path.

## Pre-flight check for a new product

```text
[ ] src/product.ts edited; index.html title and theme-color match
[ ] CMake WEBVST_APP_ID equals PRODUCT.id; deploy workflow and default URL updated
[ ] :root tokens in index.css replaced
[ ] TRACKS lineup replaced (mix defaults included); id === index
[ ] SOUND_KEYS, presets, demoPattern, randomizeTrack density match the lineup
[ ] Legacy migrations in persist.ts removed
[ ] Tests and docs updated for the new names; npm test && npm run build pass
```
