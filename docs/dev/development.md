# Development

## Setup

```bash
git clone <this repo> Pulse8
git clone https://github.com/lwojas/webdsp webdsp      # sibling directory
cd webdsp && npm ci && cd ../Pulse8
npm install
npm run dev                                            # http://localhost:5175 (next free port if taken)
```

`package.json` depends on `"webdsp": "file:../webdsp"`, so webdsp must be a sibling checkout. Its `prepare` script builds
it (tsup) during `npm install`, which is why it needs its own `npm ci` first. To depend on a published copy instead,
change the dependency to `github:lwojas/webdsp`.

Node 22 is what CI uses.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` then `vite build` to `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm test` | Vitest, once |
| `npm run vst:build` | Build the optional `Pulse8.vst3` (see [VST3 build](vst.md)) |
| `npm run vst:serve` | Production build served on port 5175, for a plugin pointed at local code |
| `npm run vst:e2e` | Headless end-to-end test of the plugin's host path, no DAW |

TypeScript is `strict` with `noUnusedLocals` and `noUnusedParameters`; the build fails on both.

### The Vite configuration

`vite.config.ts` excludes `webdsp`, `webdsp/worklet-url` and `webdsp/sequencing` from dependency pre-bundling. webdsp
resolves its AudioWorklet module with `new URL('./engine-processor.js', import.meta.url)`, and pre-bundling would move
the module and break that lookup. `server.fs.allow: [".."]` lets the dev server read the linked sibling.

## Tests

`test/engine.test.ts`, `test/midi.test.ts`, `test/hoststate.test.ts` and `test/nativeseq.test.ts`, Vitest, Node environment, no audio, no DOM. They cover the pure logic:

| Area | Examples |
|---|---|
| Control mapping | normalised ↔ units round trip; defaults and presets inside range |
| Punch FX | transparent at rest, takeover rules, sweep level maths |
| Sends | per-track independence; delay taper and divisions |
| Patterns | randomiser stays in range and in scale |
| Scales | membership, presets, normalising bad input |
| Arpeggiator | direction order, grid timing, triplet drift, sanitising |
| MIDI | mapping validation, value conversion both ways, channels, echo suppression, banks, clock follower, song position |
| Plugin host | host-state save/restore; the song compiled to a native sequence |

What is **not** tested automatically: the sound itself, the scheduler against a real audio clock, and the React
components. Check those by ear and by eye (`npm run dev`), at phone width and wide.

When a change touches one of the invariants below, add the test that pins it.

## Invariants worth protecting

- `audio.ts` is the only importer of webdsp's runtime.
- `state.ts`, `spec.ts`, `mangler.ts`, `arp.ts`, `scale.ts`, `song.ts` and `midi/clock.ts` stay free of React and audio.
- The playhead and key highlights do not go through React or the store.
- CC numbers appear only in `midi/mapping.ts`; channels are 1–16 everywhere except on the wire (`midi/control.ts`).
- Parameter ids, punch ids and saved-array positions are permanent. Append; never reorder.
- Old projects load. Every change of saved shape comes with a migration.
- Every browser-storage access is wrapped in try/catch.

## Performance

- One `data-play` attribute flip per step on the old and new cell; about 20 attribute writes, no React render.
- Animation is `transform`/`opacity` only. No blurred shadows or filters on step cells, knob arcs or sliders.
- The scheduler runs from a Web Worker timer, so UI work cannot delay it.
- `Groovebox` caches the last value it sent for every parameter; do not bypass the caches with direct runtime calls.
- Selectors return primitives or stable references.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` (or by hand):

1. Check out Pulse8 and `lwojas/webdsp` side by side.
2. `npm ci` webdsp, then Pulse8 (which runs webdsp's `prepare`).
3. `npm test`, then `tsc --noEmit && vite build --base=/<repo-name>/`.
4. Upload `dist/` and deploy.

A failing test or type error stops the deploy. The `--base` is the repository name, because Pages serves the site from
`/<repo>/`.

## Known limits

- Bus gains and sends are not schedulable in webdsp, so punch *routing* is applied from a 10 ms audio-clock ticker
  (a few ms of jitter, inaudible at 16th-note resolution). Effect and instrument changes at pattern boundaries are
  sample-accurate. A webdsp "schedulable bus params" feature would remove the ticker.
- FX writes are one punch per step per lane (step-quantised), three lanes per pattern.
- Sound constants and presets are a first pass, set by measurement rather than by ear. Expect them to be tuned.
- MIDI input is control only (CC, program change, clock). There is no MIDI note input or output.
- Web MIDI availability depends on the browser.

## Related documents

- [Architecture](architecture.md) · [Audio graph](audio-graph.md) · [Timing](timing.md) · [State](state-and-persistence.md)
  · [Extending](extending.md) · [MIDI](midi.md)
- `concept/DESIGN/` — the visual design tokens and reference mock-up.
- webdsp's own `ARCHITECTURE.md` and `docs/` — the engine Pulse.8 is built on.
