# Audio graph

`engine/audio.ts` builds the whole signal path from webdsp primitives: instruments, buses, bus sends and effects. There
are no custom DSP nodes in Pulse.8.

## Topology

A webdsp bus has **one main route and one send**. Each track therefore needs a short chain of three buses, each adding
one tap:

```
instrument ─▶ A ─main─▶ B ─main─▶ C ─main─▶ master ─▶ limiter
              │         │         │
              │         │         └─send─▶ PUNCH bus ─▶ master
              │         └─send─▶ REVERB_t  (wet only)
              └─send─▶ DELAY_t   (wet only)
```

| Bus | Holds | Sends |
|---|---|---|
| **A** | The fader and mute (`BusGain`) | the track's delay send |
| **B** | | the track's reverb send |
| **C** | The takeover cut (`BusMainGain`) | the punch send |
| **DELAY_t** | Dub Delay (beat mode) → Delay (free mode); one is live, the other has mix 0 | |
| **REVERB_t** | Reverb at mix 1 | |
| **PUNCH** | Filter → Saturation → Bitcrusher → Phaser → Chorus/Flanger → Dub Delay → Reverb | |

The two synths (acid bass, FM) have one more effect: a **distortion insert**, a webdsp Saturation on their bus A (the same effect as the DRIVE punch).
Bus effects run before the bus gain, so the chain is synth ▶ distortion ▶ fader ▶ sends. `TrackPattern.dist` (0..1, synths only,
lockable as `fx.distortion`) maps to three Saturation parameters at once: pre-gain 10..30 dB and output trim −3..−9 dB (the DRIVE punch's own
mapping, so the same percentage sounds the same) and a mix that fades in over the first tenth of the travel. At 0 the mix is 0, which webdsp makes an exact pass-through, so the synth sounds as it
did. Because one lock moves three parameters, `lockWrites` returns a list. No instrument parameter is touched.

Consequences, deliberately:

- The fader/mute is at A, **before** every tap, so mute and level silence the sends too.
- The punch send leaves from C, **after** the sends, so the punch bus hears the faded, un-delayed track.
- During a **takeover** punch, C's main gain is cut to 0 and its send raised to 1: the dry signal is removed and the
  whole mix goes through the punch chain. A **throw** leaves C's main at 1 and raises the send by `boost × level`.
- An unfed bus costs nothing: webdsp sleeps buses with no input, so idle sends are free.

Instruments are created on bus A. Fixed (unexposed) instrument parameters and a per-track gain trim (`gainDb` in the
spec) are applied at creation. Voice limit: 32.

## Level taper

`levelToGain(level) = level² × 1.1`: fine control at the bottom, about unity at 0.95.

## What is schedulable and what is not

| Thing | Mechanism | Accuracy |
|---|---|---|
| Notes | `instrumentNoteOn({ time })` | sample-accurate |
| Instrument parameters at a pattern change | `scheduleParams` | sample-accurate |
| Punch FX chain values in a written lane | `scheduleParams` with `from`/`value`/`ramp` | sample-accurate, ramped |
| Bus gains, sends, main gain | not schedulable in webdsp | applied from the 10 ms audio-clock ticker (`TimedQueue`) |

That last row is the one known compromise: punch *routing* changes land within a few milliseconds of their step. At
sixteenth-note resolution this is inaudible. If webdsp gains schedulable bus parameters, the `TimedQueue` and
`Groovebox.when` can be deleted.

## Caching

`Groovebox` keeps `soundCache`, `busCache`, `fxCache`, `manglerCache` and `scheduled`. `applySound`, `applyMix`,
`applyManglerValues` and `scheduleManglerSegment` send only values that differ. `resetManglerSchedule()` forgets them
on transport start and stop so the next write sends everything.

When a scheduled segment is written, the immediate cache entry for that key is dropped: the engine value is no longer
what the immediate path last wrote.

## The Punch chain

`mangler.ts` holds the data; `audio.ts` applies it.

- `MANGLER_PARAMS` maps each `ManglerKey` (`fCut`, `sDrive`, `pRate`…) to an effect slot and a webdsp `NodeParam`.
- `baseValues()` is the resting, **transparent** state: filter open at 20 kHz, every mix at 0, the dub echo return open,
  reverb out of the path.
- A `PunchDef.values(p, lvl)` returns *overrides* on top of the resting values, where `p` is the character knob and
  `lvl` the 0..1 sweep level. `manglerTarget` merges and returns `{ values, takeover, boost }`.
- Takeover punches must set `dMix: 0, rMix: 0` (`OWN`) so the wet-only returns get out of the way.

`scheduleManglerSegment(from, to, time, dur)` turns a step of the written lane into `ScheduledParam` events: a ramp from
the level at this step to the level at the next when both are the same punch, a step otherwise.

## Limiter

webdsp's master limiter protects the output. Levels are balanced by `gainDb` in the spec, not by compensating in the
mixer.
