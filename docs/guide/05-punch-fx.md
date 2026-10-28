# Punch FX

Punch FX are the performance heart of Pulse.8. Nine effects live on one shared effect section. You hold a pad, the
effect **sweeps in** while you hold it, and you let go to bring it back out. Arm **WRITE** and the move is recorded
into the pattern, including how far the sweep had gone at every step.

## The pads

| Pad | Effect | Type | Character knob |
|---|---|---|---|
| **FILTER** | Closing low-pass with resonance | takeover | DEPTH |
| **DRIVE** | Tape-style saturation | takeover | DRIVE |
| **CRUSH** | Bit and sample-rate reduction | takeover | CRUSH |
| **PHASE** | Sweeping phaser | takeover | RATE (0.4 – 3 Hz) |
| **DUB** | Echo throw | throw | TIME (`1/16` … `1/8T`) |
| **ROLL** | 1/16 feedback roll | throw | FEEDBACK |
| **SWEEP** | Filter sweep, closing or opening | takeover | SHAPE |
| **FLANGE** | Jet flanger | takeover | RATE (0.1 – 1.2 Hz) |
| **VERB** | Reverb throw | throw | SIZE |

**Takeover** effects take over the mix. While held, every track's dry output is cut and the whole mix goes through the
effect, so nothing leaks around it. **Throw** effects (DUB, ROLL, VERB) leave the mix running and lift each track's
send into the effect, so what is playing is flung into an echo or a room.

Each pad has **one character knob**, shown in the Punch FX panel for the pad you last pressed. The setting is per
pattern and is saved. Turn it before you press, or while you hold.

### SWEEP shapes

| Shape | Does |
|---|---|
| **CLOSE** | Filter closes from open to dark |
| **CLOSE RES** | The same, with a resonant peak riding the sweep |
| **OPEN** | Filter opens from dark to bright |
| **OPEN RES** | The same, with a resonant peak |

SWEEP is the one pad that keeps moving while you hold it: it swings back and forth for as long as the pad is down.

## Sweep in

A held effect does not snap on. It rises from nothing to full over the **SWEEP IN** time:

| Setting | Time to full |
|---|---|
| **NOW** | Instant |
| **1 BT** | One beat |
| **2 BT** | Two beats (default) |
| **1 BAR** | One bar |

The time is in beats at the project tempo, so it scales with BPM. Longer times are for builds, NOW is for stabs.

A released **VERB** keeps ringing for about two and a half seconds, so its tail is not cut off.

## Writing FX

Press **WRITE** (the red dot). While the transport is playing and WRITE is armed, whatever pad you hold is recorded
into one of the pattern's **three FX lanes**. Tabs above the pads switch the sequencer between **STEPS** and **FX1**, **FX2**, **FX3**, each showing just that lane
(a tab is outlined when its lane holds something).

- Each hold is one take. It goes into the **first empty lane**, and the lanes play back **together**, layered on the
  one effect section. When all three lanes are taken, the next take wipes them all and starts again in lane 1.
- One effect per step per lane. A lane stores the pad and **how far into its sweep it was**, and playback replays the
  movement as smooth ramps scheduled on the audio clock, not as an on/off switch.
- A pad pressed late in a step is aimed at the next step.
- A pad you are holding always wins over what is written.
- **ERASE** (hold it) clears every lane as the playhead passes over it.
- Tap a cell of a lane to clear just that step. A lane's **CLR** wipes that lane (tap twice); **CLR** beside WRITE wipes all three.
- **FX ON** switches playback of the written lanes on and off without losing them.
- Two lanes that use the same part of the chain (say FILTER and SWEEP) fight over it: the higher lane wins.

FX writing is step-quantised: an effect is *selected* on a step boundary, and its level is smooth in between.

## Tips

- Set **SWEEP IN** to **1 BAR**, hold **FILTER** from the start of a pattern, and release on the downbeat of the next:
  a build and a drop.
- **ROLL** with the feedback up, held for a bar and released, turns whatever is playing into a stuttering echo.
- Write a **DUB** throw on the last step of a pattern so it echoes into the next.
- FX are per pattern, so a chain can carry different written moves in each pattern. See
  [Patterns & songs](06-patterns-and-songs.md).

Next: [Patterns & songs](06-patterns-and-songs.md).
