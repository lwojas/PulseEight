# Pulse.8

A small groovebox on the [webdsp](../webdsp) engine: 6 drums + acid bass + FM tone, 16-step
sequencing paged up to 64, patterns + chaining, factory presets, and a shared FX Mangler with
Pocket-Operator-style punch-in FX writing (with a recorded sweep). Mobile first; on wide screens everything is on one page.

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
- **Track FX (mixing):** every track has its own **Delay** and **Reverb** send. Delay is **FREE** (a time in ms) or
  **BEAT** (1/16, 1/8, 1/8., 1/4, 1/8T of the project tempo); reverb has a send and a SIZE. Sends sit after the fader,
  so mute/level silence them too.
- **Punch FX (performing):** hold a pad (FILTER, SWEEP, DRIVE, CRUSH, PHASE, FLANGE take over the whole mix; DUB, ROLL,
  VERB throw). The effect **sweeps in** while the pad is held (SWEEP IN: NOW / 1 BT / 2 BT / 1 BAR). The knob is the
  selected FX's one character parameter (SWEEP: CLOSE / CLOSE RES / OPEN / OPEN RES). Arm **WRITE**, play, and hold pads:
  the FX id and its **sweep level per step** are written to the FX lane and replayed as webdsp scheduled ramps.
  **ERASE** (hold) clears as the playhead passes, tapping an FX cell clears one step, **FX ON** toggles playback,
  **CLR** wipes the lane.
- **Patterns:** 16 slots. While playing a tap *cues* the pattern for the next loop. COPY, CLEAR, and a simple CHAIN
  (EDIT, tap slots, CHAIN ON). Everything autosaves to IndexedDB (named saves too).
- Desktop keys: `Space` play/stop, `1-8` track, `[` `]` page.

## Screen composition
- **Wide (1100px+):** transport and pattern navigation across the top (pattern slots, copy, chain). Under it a
  full-width band holds the instrument knobs (left) and the FX Mangler (right). Below that the sequencer takes
  nearly the whole width (track rail with mute/solo, one 16-step row, written-FX lane, a two-octave keyboard for
  the bass and FM tracks; drums get a 2x8 block of big pads) with a slim mixer column beside it.
- **Phone:** the same pieces as five tabs; the sequencer tab is track strip, steps, keyboard and punch pads.
- The first prototype (panel layout with the 8-lane overview) is kept on the `prototype-v1` branch.

## Layout
```
src/engine/   spec.ts (tracks + macro controls)  state.ts  store.ts  presets.ts  mangler.ts
              audio.ts (the only AudioRuntime user)  controller.ts (clock, chain, write)  actions.ts  persist.ts
src/ui/       controls.tsx (Knob, Slider, press)  Sequencer.tsx  Panels.tsx  Header.tsx
```
No dependency on webseq or webtracker. webdsp is used unchanged (instruments Kick/Snare/HiHat/Clap/Tom/Bass/Fm,
effects Filter/Saturation/Bitcrusher/Phaser/ChorusFlanger/DubDelay/Delay/Reverb, bus sends, `scheduleParams`).

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
