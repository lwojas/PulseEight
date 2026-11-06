# Punch FX

Punch FX are what make Pulse.8 fun to perform with. There are nine effects, all sharing one effects section. Hold a pad
and the effect **fades in** while you hold it; let go and it fades back out. Press **REC FX** and your move is recorded
into the pattern, including how far the effect had built up at every step.

## The pads

| Pad | Effect | Type | Main knob |
|---|---|---|---|
| **FILTER** | A filter that closes, with resonance | takeover | DEPTH |
| **DRIVE** | Warm, tape-style distortion | takeover | DRIVE |
| **CRUSH** | Lo-fi crunch (bit and sample-rate reduction) | takeover | CRUSH |
| **PHASE** | A swirling phaser | takeover | RATE (0.4 – 3 Hz) |
| **DUB** | An echo throw | throw | TIME (`1/16` … `1/8T`) |
| **ROLL** | A fast 1/16 repeating echo | throw | FEEDBACK |
| **SWEEP** | A filter sweep, closing or opening | takeover | SHAPE |
| **FLANGE** | A jet-plane flanger | takeover | RATE (0.1 – 1.2 Hz) |
| **VERB** | A reverb throw | throw | SIZE |

**Takeover** effects take over the mix. While you hold the pad, the normal sound of every track is cut and the whole mix
plays through the effect, so nothing sneaks past it. **Throw** effects (DUB, ROLL, VERB) leave the mix playing and send
a part of each track into the effect, so whatever is playing gets flung into an echo or a big room.

Each pad has **one main knob**, shown in the Punch FX panel for the pad you pressed last. Its setting is saved with the
pattern. Turn it before you press the pad, or while you hold it.

## Macros and the LFO

Beside the main knob each pad has **two macros**. Each moves several parts of the effect together along one musical
dimension. At 50 % (DRIVE's BLEND: 100 %) the effect sounds as it always has, so turning a macro is a change from there.

| Pad | Macro 1 | Macro 2 |
|---|---|---|
| FILTER | CUT: where the filter ends up | RESO: the whistle |
| DRIVE | GRIT: drive, with the output trim following | BLEND: how much driven signal is mixed in |
| CRUSH | BITS: how few bits | RATE: how far the sample rate drops |
| PHASE | DEPTH: notch depth and amount | COLOR: feedback and notch centre |
| DUB | SPACE: send level and how long it repeats | TONE: dark to bright repeats |
| ROLL | WET: how hard it is thrown in | TONE: dark to bright repeats |
| SWEEP | RANGE: how dark the sweep gets | RESO: the resonant peak |
| FLANGE | DEPTH: swing and amount | FEEDBACK: the ring, and a longer delay with it |
| VERB | WET: how hard it is thrown in | TONE: dark to bright tail |

The **LFO** button opens one LFO for the pad you pressed last. Point it at **MACRO 1** or **MACRO 2** and it moves that
macro around where you set it. It works like the track LFOs (wave, SYNC, rate, depth) and starts on a 4-bar cycle. It runs
on the beat, not on the steps, so a one-bar pattern keeps repeating while the effect slowly changes over 2, 4 or more bars.
You hear it while the effect is on: while you hold the pad, or while a recorded lane has it playing. Punching works as ever.

The macros are saved with the pattern and can be played from a MIDI controller (see [MIDI](08-midi.md)). Recorded lanes
that the DAW plugin plays by itself use the macro settings but not the LFO.

### SWEEP shapes

| Shape | What it does |
|---|---|
| **CLOSE** | The filter closes from open to dark |
| **CLOSE RES** | The same, with a resonant whistle riding along |
| **OPEN** | The filter opens from dark to bright |
| **OPEN RES** | The same, with a resonant whistle |

SWEEP is the one pad that keeps moving while you hold it, swinging back and forth for as long as your finger is down.

## Fading in

A held effect doesn't jump straight on. It builds from nothing to full over the **RAMP** time:

| Setting | Time to reach full |
|---|---|
| **NOW** | Instant |
| **1 BEAT** | One beat |
| **2 BEATS** | Two beats (the starting setting) |
| **1 BAR** | One bar |

These times follow your tempo, so they speed up and slow down with the BPM. Use longer times for builds and NOW for
quick stabs.

When you let go of **VERB**, it keeps ringing out for about two and a half seconds so the tail isn't cut off.

## Recording effects

Press **REC FX** (the red dot). While the beat is playing and REC FX is on, whichever pad you hold is recorded into one
of the pattern's **three FX lanes**. The tabs above the pads switch the sequencer between **STEPS** and **LANE 1**,
**LANE 2** and **LANE 3**, each showing only that lane. A tab has an outline when its lane has something recorded.

- Each time you hold a pad, that's one take. It goes into the **first empty lane**, and all the lanes play back **together**,
  layered on the same effects section. When all three lanes are full, the next take wipes them all and starts again in
  lane 1.
- Each lane can hold one effect per step. It remembers the pad and **how far the effect had built up**, and plays back the
  whole movement as a smooth fade rather than a simple on and off.
- If you press a pad late in a step, it's placed on the next step.
- A pad you're holding always overrides what's recorded.
- **ERASE** (hold it down) clears every lane as the playhead passes over it.
- Tap a cell in a lane to clear just that step. **CLR LANE** wipes a whole lane (tap twice); **CLR FX**, beside REC FX,
  wipes all three.
- The **ON / OFF** button beside ERASE switches the recorded effects on or off without losing them. It shows the current
  state.
- If two lanes use the same part of the effect (say FILTER and SWEEP), they compete for it and the higher lane wins.

Recorded effects line up with the steps: each effect switches on at a step, and its level moves smoothly in between.

## Tips

- Set **RAMP** to **1 BAR**, hold **FILTER** from the start of a pattern, and let go on the first beat of the next one.
  That's a build and a drop.
- Hold **ROLL** for a bar with the feedback turned up, then release it, to turn whatever's playing into a stuttering echo.
- Record a **DUB** throw on the last step of a pattern so it echoes into the next one.
- Effects are saved per pattern, so each pattern in a chain can have different recorded moves. See
  [Patterns & songs](06-patterns-and-songs.md).

Next: [Patterns & songs](06-patterns-and-songs.md).
