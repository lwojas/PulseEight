# Sound design

Every track exposes a focused set of macro knobs, at most six. Each knob covers only the musical part of its engine's
range, so the whole travel of a knob sounds good. There is no menu diving.

Select a track and open **SOUND** (on a wide screen, the instrument band at the top).

## Kits and presets

- **Drums** have four **KITS** that load all six drum tracks at once: `909 CLASSIC`, `808 BOOM`, `TECHNO HARD`,
  `DUB DRY`.
- **ACID** has five presets: `ACID 303`, `SQUELCH`, `SQUARE`, `PUNCH`, `SUB PUSH`.
- **FM** has five presets: `FM BASS`, `HOLLOW LEAD`, `BELL PLUCK`, `METAL STAB`, `SUB GROWL`.

Preset names describe a *style of sound*; the sound is Pulse.8's own. A preset only sets knob positions, so you can
load one and carry on turning.

## Per-pattern sound

Sound, level, delay and reverb settings belong to the **pattern**, not the project. Pattern 1 can be a hard techno kit
and pattern 2 a dub kit with a different acid patch. Switching pattern during playback changes the sound
sample-accurately on the bar line. See [Patterns & songs](06-patterns-and-songs.md).

## Drum controls

| Track | Control | Range (default) |
|---|---|---|
| **KICK** | TUNE | 35 – 80 Hz (50): the pitch the body settles on |
| | SWEEP | 0.4 – 3.6 oct: how far above TUNE the pitch sweep starts (2.5) |
| | DECAY | 120 ms – 1.1 s: body length (450 ms) |
| | PUNCH | level of the attack click |
| | DRIVE | saturation |
| **SNARE** | TUNE | 140 – 300 Hz (185): body pitch |
| | DECAY | 80 – 500 ms (220 ms) |
| | SNAP | opening crack: transient level and noise brightness |
| | RATTLE | balance of noisy rattle against the tonal body |
| **CL HAT** | PITCH | ±6 semitones |
| | DECAY | 20 – 180 ms (60 ms) |
| | METAL | amount of inharmonic, metallic content |
| | BRIGHT | brightness |
| **OP HAT** | PITCH | ±6 semitones |
| | DECAY | 200 ms – 1.1 s (450 ms) |
| | METAL, BRIGHT | as above |
| **CLAP** | TUNE | 800 – 2400 Hz (1300) |
| | DECAY | 100 – 600 ms (250 ms) |
| | SPREAD | time between the hits of the clap's burst cluster |
| | SNAP | sharpness of the bursts |
| **PERC** | TUNE | 80 – 360 Hz (120) |
| | SWEEP | 0 – 1.6 oct pitch drop (0.6) |
| | DECAY | 120 – 900 ms (450 ms) |
| | BODY | membrane overtones and stick tick |
| | DAMP | muffling: shorter ring, darker tone |

## ACID

A monophonic bass voice with a resonant low-pass filter that an envelope snaps open on every note.

| Control | Does |
|---|---|
| **FILTER** | Cutoff, 60 Hz – 2.5 kHz |
| **ENV MOD** | How far each note's envelope opens the filter |
| **DECAY** | How long the filter takes to close, 100 – 900 ms |
| **RES** | Resonance. High values squelch and self-oscillate |
| **BITE** | Onset drive and brightness, and how much velocity (accent) changes the timbre. At 0 an accent is only louder |
| **WAVE** | Round and subby (sine plus sub) at 0, rich saw at 100% |

Under the knobs, a **DIST** slider drives a distortion between the synth and the fader, so the delay and reverb sends hear it too (the FM has the same slider). It is the same saturation as the DRIVE punch, but a permanent part of the voice: 0 is off (the voice is untouched), and more drive adds grit while the output is trimmed to keep the level roughly steady. Like the knobs, it can be locked per step in P-LOCK mode and saved per pattern.

The filter envelope attacks instantly and falls exponentially. Accent and slide, set per step, do the rest. **WAVE** morphs the oscillator: a sine with a sub-oscillator underneath at 0, a bright saw at 100%, so the fundamental stays present as the filter closes.

## FM

A two-operator FM voice.

| Control | Does |
|---|---|
| **COLOR** | Eight stepped operator ratios: `SUB`, `FULL`, `HOLLOW`, `THIRDS`, `THIN`, `FIFTHS`, `METAL`, `BELL` |
| **DEPTH** | Resting FM depth: from a pure sine to a rich spectrum |
| **BITE** | Extra FM depth at the start of each note that decays away: a bright attack |
| **TONE** | A static low-pass relative to the note: dark fundamental at 0, fully open at 100% |
| **DECAY** | 60 ms – 1.2 s |

COLOR is a choice, not a continuum: it sets the modulator-to-carrier ratio, which decides the harmonic character, and DEPTH, BITE and TONE shape it. Stepped ratios keep every setting musical; continuous ratios mostly sound out of tune.

The **DIST** slider under the knobs works as it does on the ACID: see above.

Next: [Mixing & track FX](04-mixing-and-track-fx.md).
