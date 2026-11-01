# Signal path

This page shows the route a sound takes, from a step on the grid to your speakers. It helps when you're wondering *why*
something sounds the way it does: why a muted track's echoes stop, or why a punch effect grabs the whole mix.

## One track

Every track follows the same route. There are eight of them.

```
   SOUND                     the track's drum or synth voice, shaped by its knobs
     │
     ▼
   DIST                      ACID and FM only (the DIST slider; off at 0)
     │
     ▼
   LEVEL · MUTE · SOLO       the fader and the M and S buttons
     │
     ├── DLY knob ───▶ [ DELAY ]   this track's own echo ─────────────────┐
     │                                                                    │
     ├── REV knob ───▶ [ REVERB ]  this track's own room ─────────────────┤
     │                                                                    │
     ├── PUNCH FX button ───▶ [ PUNCH FX ]  the shared performance ───────┤
     │   (on by default)       section (see below)                        │
     │                                                                    │
     ▼                                                                    │
   straight on to the mix  ◀──────────────────────────────────────────────┘
```

The echo and the room are **returns**: they carry only the effect (the wet sound), and they join the dry sound at the mix.

## The whole machine

```
   TRACK 1  ──┐
   TRACK 2  ──┤
   TRACK 3  ──┤
   TRACK 4  ──┼──▶  MIX  ──▶  LIMITER  ──▶  OUTPUT
   TRACK 5  ──┤       ▲
   TRACK 6  ──┤       │
   TRACK 7  ──┤    ┌──┴─────────────────────────────────────────────┐
   TRACK 8  ──┘    │ PUNCH FX  ◀── the PUNCH FX send of every track │
                   └────────────────────────────────────────────────┘
```

Behind the scenes, each track's delay and reverb also feed the mix. The **limiter** at the end keeps the total from
clipping, so a loud build won't distort your output.

## Inside the Punch FX section

Everything you hold on the punch pads passes through this chain, in this order. Most of the time it is wide open and
silent, so the mix passes through untouched.

```
   from the tracks
        │
        ▼
   FILTER ▸ DRIVE ▸ CRUSH ▸ PHASE ▸ FLANGE ▸ ECHO ▸ ROOM
     ▲                                          ▲      ▲
     │                                          │      │
   FILTER and SWEEP                       DUB and ROLL   VERB
        │
        ▼
      to the mix
```

Some pads share a stage: **FILTER** and **SWEEP** both work the filter, and **DUB** and **ROLL** both work the echo.

## What this means for your mix

- **Mute and level come first.** The fader sits *before* the delay and reverb, so a muted track's echoes and room go
  quiet with it, and a track turned all the way down sends nothing to them.
- **DIST comes before the echo and room too.** A distorted synth goes into its delay and reverb distorted.
- **Punch FX hear the track's dry sound.** The punch send leaves after level, mute and solo, so the effect works on the
  track as you set it in the mix. The track's own echo and room are *not* fed through the punch section: they
  carry on to the mix by their own route.
- **Takeover or throw.** A *takeover* pad (FILTER, DRIVE, CRUSH, PHASE, SWEEP, FLANGE) cuts the normal route of every
  track that takes part and sends everything through the effect instead. A *throw* pad (DUB, ROLL, VERB) leaves the mix
  playing and sends a part of each track into the effect.
- **Keep a track out of the punch.** Switch off a track's **PUNCH FX** button and it skips the section entirely: it
  isn't thrown into echoes and isn't cut by a takeover, so it plays on dry.
- **Delay and reverb are per track.** The Track FX panel changes the echo time and room size for the selected track only.
  The Punch FX have their own, separate echo and room.

Back to the [guide](01-getting-started.md) · [Reference](09-reference.md).
