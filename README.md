# Pulse.8

**A groovebox for the browser.** Six drums, an acid bass, an FM voice, nine performance effects you play by hand and
record, and 64 patterns that chain into songs. It opens in one tap, runs on a phone as well as a desktop, and keeps
everything you make.

Pulse.8 is not an emulation of any machine. It draws on the tradition of the classic grooveboxes (step sequencing,
punch-in effects, a squelching bass line, a tight drum kit) and builds its own instrument from it: its own sound
engine, its own workflow, its own interface.

## What you get

- **Eight tracks.** Kick, snare, closed and open hat, clap, perc, **ACID** bass with accent and slide, and a two-operator
  **FM** voice. Every track has a handful of macro knobs tuned so the whole travel sounds good.
- **A sequencer that gets out of the way.** 16 to 64 steps per pattern, tap to place, hold to accent, swing, a scale-aware
  keyboard, and an arpeggiator on the melodic tracks.
- **Punch FX.** Hold a pad and the effect sweeps in: filter, drive, crush, phaser, flanger, dub echo, roll, reverb, filter
  sweep. Arm **WRITE** and the move, with its exact sweep shape, is recorded into the pattern and replayed on the audio clock.
- **Proper mixing.** Level, mute and solo per track, plus an independent delay and reverb per track. Delay locks to the
  tempo or runs free.
- **64 patterns, cueing and chains.** Switch patterns on the bar; the sound of the whole groove can change with them.
  Sound, mix and FX travel with the pattern.
- **Everything is saved.** Autosave, named saves, and export/import as a file.
- **MIDI.** Control every fader and knob from a controller or DAW, with feedback to motorised faders. Bank/program
  change picks patterns. Follow an external MIDI clock.
- **Mobile first.** Five tabs on a phone. On a wide screen the whole instrument is on one page.

## Start

1. Open Pulse.8 and **tap START**. A demo groove is already playing.
2. Mute a track, load a different **KIT**, turn the **ACID** filter, hold **FILTER** on the punch pads.
3. Press **WRITE**, hold a pad through a loop, and listen to your move come back round.

The [User Guide](docs/guide/01-getting-started.md) takes it from there.

## Run it yourself

Pulse.8 is built on [webdsp](https://github.com/lwojas/webdsp), which sits beside it as a sibling checkout.

```bash
git clone https://github.com/lwojas/webdsp ../webdsp && (cd ../webdsp && npm ci)
npm install
npm run dev        # http://localhost:5175
npm test           # the logic test suite
npm run build      # type-check and build to dist/
```

A GitHub Actions workflow tests, builds and publishes to GitHub Pages on every push to `main`.

**Optional: a VST3 plugin**, built locally (not in CI) from the [webvst](https://github.com/lwojas/webvst) host, which
needs a sibling checkout like webdsp. `npm run vst:build` produces `Pulse8.vst3` to copy into your plug-ins folder; the
plugin loads the page from the dev server (`npm run dev`). In the DAW it follows the transport, plays the song on the audio thread
(window open or closed, offline bounce included) and plays DAW MIDI natively. `npm run vst:e2e` checks all of it headless. See
[VST3 build](docs/dev/vst.md).

## Documentation

| | |
|---|---|
| **[User Guide](docs/guide/01-getting-started.md)** | Getting started, sequencing, sound design, mixing, Punch FX, patterns, projects, MIDI, reference |
| **[Developer docs](docs/dev/architecture.md)** | Architecture, audio graph, scheduling, state and persistence, extending, MIDI design, development |
| **[Full index](docs/README.md)** | |

## At a glance

| | |
|---|---|
| Tracks | 8: 6 drums, ACID bass, FM |
| Patterns | 64, each 16 / 32 / 48 / 64 steps |
| Tempo | 60 – 200 BPM, swing 50 – 75% |
| Punch FX | 9, sweepable, writable |
| Track FX | Delay (free or tempo-synced) and reverb on every track |
| Storage | Autosave and named saves in the browser; export/import as `.pulse8.json` |
| Control | MIDI CC, bank/program change, clock follow |
| Stack | TypeScript, React, Vite, webdsp (AudioWorklet) |

## Under the hood

The engine is plain TypeScript with no knowledge of the interface, and the interface has no knowledge of the audio. A
Web Worker clock drives a lookahead scheduler that hands notes to the audio thread with sample-accurate times; the
playhead is drawn directly to the DOM so the UI can never get in the way of the groove. See the
[architecture](docs/dev/architecture.md).
