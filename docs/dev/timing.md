# Timing & scheduling

Pulse.8 uses a conventional **lookahead scheduler**: a steady timer wakes every 10 ms, and everything due in the next
120 ms is handed to the audio engine with an exact start time. The audio thread plays it on the sample.

## The clock

| Constant | Value | Meaning |
|---|---|---|
| `TICK_MS` | 10 ms | Timer period |
| `LOOKAHEAD` | 120 ms | How far ahead notes are scheduled |
| step | `15 / bpm` s | One 16th note |

The timer is a **Web Worker** `setInterval` (`ticker.ts`). Unlike a main-thread timer, it is not delayed by React
renders or throttled in a background tab. It falls back to the main thread where Workers are unavailable.

## One step (`Controller.scheduleStep`)

For the step at `gridTime`:

1. **Swing.** Odd steps shift later by `(swing − 0.5) × 2 × stepDur`. Swing is stored as 0.5 – 0.75.
2. **Notes.** For each track with the step on:
   - drums: `gb.note(track, { time, velocity: acc ? 1 : 0.7, chokeGroup })`
   - melodic: `pitch = note − rootMidi + 12 × oct`; duration `0.62 × stepDur`, or until the start of the next step
     (+15 ms) when the next step is a slide; `tie` when this step slides and the previous is on.
3. **Arpeggiators.** `scheduleArps` asks each active arp for the notes that fall in this step window.
4. **Written FX.** Unless a punch is being held (which wins), `scheduleLaneStep` layers every lane's punch at this
   step (`layeredTarget`), sends the chain values as scheduled ramps, and applies routing at `t`.
5. Advance `gridTime`, `step`, `stepCount`. At the pattern end, `advancePattern` decides what comes next.

## Per-track last step (polymeter)

A track may loop before the pattern ends (`TrackPattern.last`). The pattern clock is unchanged; each step also carries a `run`, the steps
since the current pattern began playing, which is *not* reset when the same pattern repeats. A track shorter than the pattern plays
step `run mod last` (`trackStepAt`), so it keeps its own loop through the repeats and drifts against the others. `run` restarts when the
pattern changes, a cue lands, or a chain moves on to another pattern (a chain of one pattern is one run). That is all the live
scheduler does: no cycle is ever built, however the lengths combine.

In a plugin host the same thing is expressed as loops (`nativeseq.ts`): when a layout is one pattern repeating for good, each polymetric
track is left out of the pattern's cycle and sent as a `Sequence` loop of its own length (`trackLoop`), which the host repeats against the
DAW position. Swing moves odd steps of the grid, so a track of odd length is a loop of two laps. Any other layout plays each pattern once per
cycle, so a shorter track just wraps inside it, and a cue transition is laid out event by event. This needs a host that reports
`sequenceLoops` (webdsp's `Sequence.loops`); without it the page sequences as in a browser.

## Pattern boundaries

At the wrap, `advancePattern`:

- a **cue** wins: switch to the cued pattern. If the chain is on and contains it, the chain position follows.
- otherwise, with the **chain on**, step to the next chain entry (wrapping).
- otherwise stay.

On a change, `applySound(next, time)` schedules every changed instrument parameter at the boundary, and the mix and punch
routing are re-applied at that time. Sound changes are therefore sample-accurate and tied to the bar line.

## What the user sees

The scheduler runs ahead of the speakers, so the state it produces is not yet audible. Each step is queued as a
`StepEvent`. `publishAudible(now)` releases the events whose time has arrived, which is when they are *heard*, and only
then updates:

- the **playhead** (`setAudible` → direct DOM write, see below)
- lit piano keys (`keyhl.ts`)
- the store, for the few things that change rarely: `playPattern`, `chainPos`, `pattern`, `cue`, `page` (when FOLLOW is
  on). These writes are tagged `internal`.
- **FX writing and erasing**, which act on the step that is audible.

### The playhead never touches React

`playhead.ts` holds a map from step index to the DOM elements of every cell for it. Each step sets one `data-play`
attribute on the old and new step and updates the step readout and the page progress bar directly: about twenty
attribute writes and zero React renders. The per-step position is not in the store at all. CSS animation uses
`transform` and `opacity` only; there are no blurred shadows or filters on cells, knobs or sliders.

## Holding a punch

`punchDown` records `punchSince = audio time`. Every tick, `sweepHeldPunch` computes `sweepLevel(base, bpm, elapsed,
id)` and pushes the chain to the new level. With WRITE armed, the level at each step's start is recorded into
the lane chosen for the hold (`pickWriteLane`: the first empty lane, or wipe all three and use the first) as steps
become audible. `punchUp` returns the chain to the written lanes' layered value, or to rest.
A released VERB keeps the reverb return open for `VERB_TAIL` (2.5 s).

## Stopped-transport arpeggiator

With the transport stopped, held keys start a **free grid** (`arpFreeTime`, `arpFreeStep`) of the same step length,
read from the same tempo, so the arpeggiator sounds identical whether or not the sequencer is playing.

## External clock

`midi/clock.ts` turns 24 PPQN pulses into steps (6 pulses per 16th, one SPP unit) and tempo (mean over a beat, rounded to
0.1, hysteresis 0.15). The scheduler is **not replaced**: `controller.play({ songStep, time })` starts it aligned to the
clock, and `followPhase(songStep, time)` nudges `gridTime` by 25% of the error per step (a small phase-locked loop,
bounded to half a step). It runs 50 ms behind the sender (`CLOCK_LATENCY`). If pulses stop for 1 s the transport stops.
Details: [MIDI](midi.md).

## In a plugin host

Inside the VST3 build the lookahead scheduler described above is not the clock: the DAW's transport is, and the plugin plays the song
itself from a native sequence (`nativeseq.ts`) built with the same step compile. The page follows the DAW's position to draw the
playhead and record FX. See [VST3 build](vst.md#playing-in-the-daw). The scheduler still runs when the DAW is stopped (PLAY works as in
a browser) and for held-key arps.
