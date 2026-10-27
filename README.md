# Pulse.8

A small groovebox on the [webdsp](../webdsp) engine: 6 drums + acid bass + FM tone, 16-step
sequencing paged up to 64, patterns + chaining, factory presets, and a shared FX Mangler with
Pocket-Operator-style punch-in FX writing. Mobile first; on wide screens everything is on one page.

```bash
npm install     # webdsp is linked from ../webdsp (file:), switch to github:lwojas/webdsp to publish
npm run dev     # http://localhost:5175 (next free port if taken)
npm test        # pure-logic tests
```

## Playing it
- **Tap START.** The demo groove plays at once.
- **Steps:** drums toggle on tap, **hold = accent**. Acid/FM: tap an empty step to place a note and open the key editor
  (note, ACCENT, SLIDE, OCT); tap the selected step again to remove it. Slide = 303 glide into the note.
- **Pages:** `1-16 … 49-64`. Tapping a page past the pattern length extends the pattern. FOLLOW tracks the playhead.
- **Sound:** pick a track, turn up to 5 macro knobs (double-tap resets), or load a kit/preset.
- **FX Mangler:** every track has an FX send. Hold a punch pad (FILTER, DRIVE, CRUSH, PHASE take over the whole mix;
  DUB, ROLL throw echoes). Arm **WRITE**, play, and hold pads to punch them into the steps; **ERASE** (hold) clears
  as the playhead passes, tapping an FX cell clears one step, **FX PLAY** toggles playback, **CLR FX** wipes the lane.
- **Patterns:** 16 slots. While playing a tap *cues* the pattern for the next loop. COPY, CLEAR, and a simple CHAIN
  (EDIT, tap slots, CHAIN ON). Everything autosaves to localStorage.
- Desktop keys: `Space` play/stop, `1-8` track, `[` `]` page.

## Layout
```
src/engine/   spec.ts (tracks + macro controls)  state.ts  store.ts  presets.ts  mangler.ts
              audio.ts (the only AudioRuntime user)  controller.ts (clock, chain, write)  actions.ts  persist.ts
src/ui/       controls.tsx (Knob, Slider, press)  Sequencer.tsx  Panels.tsx  Header.tsx
```
No dependency on webseq or webtracker. webdsp is used unchanged (instruments Kick/Snare/HiHat/Clap/Tom/Bass/Fm,
effects Filter/Saturation/Bitcrusher/Phaser/DubDelay, bus sends, `scheduleParams`).

## Performance notes
- **The playhead never touches React.** Step cells register their DOM element with `engine/playhead.ts`; each step flips
  one `data-play` attribute on the old and new step and updates the step readout and page progress bar directly
  (about 20 attribute writes per step, zero React renders). The per-step position is not in the store at all.
- Animation is `transform`/`opacity` only (page progress, slider fills, the pattern-cue blink). There are no blurred
  shadows or filters on step cells, knob arcs or sliders.
- The scheduler runs from a Web Worker timer, so UI work can't delay it.

## Known limits
- Bus gains/sends are not schedulable in webdsp, so punch routing is applied from a 10 ms audio-clock ticker
  (a few ms of jitter, inaudible at 16th-note resolution). Effect and instrument changes at pattern switches are
  sample-accurate. A webdsp "schedulable bus params" feature would remove the ticker.
- FX writes are one punch per step (step-quantised, like the PO).
- Sound constants and presets are first-pass by measurement, not by ear.
