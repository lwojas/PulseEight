# Sound design

Every track has a small set of knobs, at most six. Each knob only covers the range that sounds good, so wherever you turn
it, it sounds musical. There are no menus to dig through.

Select a track and open **SOUND** (on a larger screen, it's the instrument band along the top).

## Kits and presets

- **Drums** have four **KITS** that load all six drum tracks at once: `909 CLASSIC`, `808 BOOM`, `TECHNO HARD` and `DUB DRY`.
- **ACID** has five presets: `ACID 303`, `SQUELCH`, `SQUARE`, `PUNCH` and `SUB PUSH`.
- **FM** has five presets: `FM BASS`, `HOLLOW LEAD`, `BELL PLUCK`, `METAL STAB` and `SUB GROWL`.

The names describe a *style of sound*, but the sounds are Pulse.8's own. A preset only moves the knobs to a starting
position, so you can load one and carry on turning.

## Sound belongs to the pattern

Sound, level, delay and reverb settings are saved **with each pattern**, not with the project as a whole. Pattern 1 can be
a hard techno kit and pattern 2 a dub kit with a different acid sound. If you switch pattern while the beat plays, the
sound changes exactly on the bar line. See [Patterns & songs](06-patterns-and-songs.md).

## LFOs

An LFO is a slow wobble that moves a knob for you. Each track has three. Press **LFO** under the INSERT FX controls to open
them. For each one, choose:

- **Target**: what it moves. Any of the track's knobs, the delay or reverb send, or (on ACID and FM) the distortion.
- **Wave**: sine, triangle, square or saw.
- **Rate**: how fast it moves, from very slow to quick. With **SYNC** on, the rate is a note length at your tempo instead,
  so the wobble stays in time.
- **Depth**: how far it moves the knob. The wobble swings around where the knob is set, so at 100% it sweeps half the knob's
  range either side. A negative depth flips it upside down.

If a step has a TWEAK on the same knob, the tweak wins for that step. LFO settings are saved with each pattern. LFOs work in
the browser version; they don't play inside the VST3 plugin yet.

## Sidechain

Sidechain ducks a track's volume whenever another track plays, the classic way to make a bass get out of the way of the kick.
Press **SC** next to the LFO button to open it, then:

- **DUCK**: switches it on. Pick the track to duck to in **TO** (it starts on the first track, the kick).
- **Amount**: how deep the dip is. Low is a gentle nudge, high is a deep pump.
- **Release**: how long the track takes to come back up after each hit.

Everything else is set for you. The track follows the actual sound of the source track. The source is heard after its fader and
mute, so a muted kick ducks nothing, and turning it up ducks harder. The track's delay and reverb sends duck with it. A track
cannot be ducked by one that is ducked by it (those choices are greyed out). Sidechain settings are saved with each pattern.

## Drum controls

| Drum | Knob | Range (starting value) |
|---|---|---|
| **KICK** | TUNE | 35 – 80 Hz (50): the pitch the kick settles on |
| | SWEEP | 0.4 – 3.6 octaves (2.5): how far above that pitch the kick starts before dropping |
| | DECAY | 120 ms – 1.1 s (450 ms): how long the kick rings |
| | PUNCH | how loud the click at the start is |
| | DRIVE | distortion |
| **SNARE** | TUNE | 140 – 300 Hz (185): the pitch of the body |
| | DECAY | 80 – 500 ms (220 ms) |
| | SNAP | the crack at the start: how loud and how bright |
| | RATTLE | the mix of snare rattle against the tonal body |
| **CL HAT** (closed hat) | PITCH | ±6 semitones |
| | DECAY | 20 – 180 ms (60 ms) |
| | METAL | how metallic and clangy it sounds |
| | BRIGHT | brightness |
| **OP HAT** (open hat) | PITCH | ±6 semitones |
| | DECAY | 200 ms – 1.1 s (450 ms) |
| | METAL, BRIGHT | as above |
| **CLAP** | TUNE | 800 – 2400 Hz (1300) |
| | DECAY | 100 – 600 ms (250 ms) |
| | SPREAD | the gap between the little claps that make up the burst |
| | SNAP | how sharp the claps are |
| **PERC** (a tuned tom) | TUNE | 80 – 360 Hz (120) |
| | SWEEP | 0 – 1.6 octaves (0.6): how far the pitch drops |
| | DECAY | 120 – 900 ms (450 ms) |
| | BODY | the drum-skin ring and the stick click |
| | DAMP | muffling: a shorter, darker sound |

## ACID

A single-note bass synth with a resonant filter that snaps open on every note.

| Knob | What it does |
|---|---|
| **FILTER** | How open the filter is, from dark to bright (90 Hz – 1 kHz) |
| **ENV MOD** | How far each note flings the filter open |
| **DECAY** | How long the filter takes to close again, 60 ms – 1.1 s |
| **RES** | Resonance. High settings squelch and even whistle |
| **BITE** | How much bite and brightness a note starts with, and how much an accent changes the tone. At 0, an accent is only louder |
| **WAVE** | Round and subby at 0, rich and buzzy at 100% |

Under the knobs, a **DIST** slider drives a distortion between the synth and the fader, so the delay and reverb hear it too. It's the same effect as the DRIVE punch, but built into the track. At 0 it's off, and turning it up adds grit while the volume is kept steady. Like the knobs, it can be changed per step in TWEAK mode and is saved with each pattern. The FM track has the same slider.

The filter opens the instant a note starts and then closes smoothly. Accent and slide, set per step, do the rest. **WAVE**
blends between a soft sine with a deep sub-bass underneath and a bright, buzzy saw, so the low end is still there as the
filter closes.

## FM

A two-part FM synth, good for bells, plucks and glassy tones.

| Knob | What it does |
|---|---|
| **COLOR** | Eight steps that change the character of the sound: `SUB`, `FULL`, `HOLLOW`, `THIRDS`, `THIN`, `FIFTHS`, `METAL`, `BELL` |
| **DEPTH** | How rich the sound is, from a pure tone to a bright, harmonic one |
| **BITE** | An extra burst of brightness at the start of each note that fades away |
| **TONE** | How dark or bright the sound is: dark at 0, fully open at 100% |
| **DECAY** | 60 ms – 1.2 s |

COLOR moves in steps rather than smoothly. That's deliberate: each step keeps the sound in tune with itself, whereas
smooth changes would mostly sound out of tune. DEPTH, BITE and TONE then shape the sound within each color.

Next: [Mixing & track FX](04-mixing-and-track-fx.md).
