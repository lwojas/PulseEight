# Mixing & track FX

## Level, mute, solo

Every track has a **level** fader, a **M**ute and a **S**olo button, on the **MIX** tab or the slim mixer column on a
wide screen.

- **Level** is a gentle taper (quadratic): the bottom of the fader is fine control, and about 95% is unity. Each
  engine also has a built-in trim, so the default levels are balanced when you start.
- **Mute** silences a track. **Solo** silences everything that is not soloed; several tracks can be soloed together.
- Mute and solo are **performance state**: they are not saved with the project and reset when you reload.
- The fader and mute sit *before* the track's effect sends. A muted track's delay and reverb go quiet with it, and a
  track at zero level sends nothing.

## Sends

Each track has its own **delay** and **reverb**. They are separate effects per track, so the snare can sit in a short
room while the clap rides a long delay.

Set the send amounts with the `DLY` and `REV` knobs on the **SOUND** panel. Delay mode and time, and reverb size, are on
the **Track FX** panel.

Below the send knobs, the **PUNCH FX** button gates the track's send into the [Punch FX](05-punch-fx.md) section. It is on by
default. Switch it off and that track is ignored by punches: it is neither fed into throw effects nor cut by a takeover, so
it plays on dry. It is separate from the delay and reverb sends, saved per pattern, and MIDI-mappable as `track.N.punchSend`.

### Delay

| Mode | Time |
|---|---|
| **FREE** | A time in milliseconds, 40 – 900 ms on an exponential taper |
| **BEAT** | A division of the project tempo: `1/16`, `1/8`, `1/8.`, `1/4`, `1/8T` |

BEAT mode follows the tempo, including tempo changes and an external MIDI clock. FREE stays at a fixed time. Feedback
and tone are fixed to values that suit the material, so a delay always sits in the mix.

### Reverb

A send plus a **SIZE**. Larger sizes lengthen the decay and open the damping, so a big room is also a brighter one.

### Defaults

New patterns start with sends set for a working mix: every track except the kick has some delay, and the snare, clap,
percussion and FM have some reverb. Double-tap a send knob to return it to its default.

## Track FX versus Punch FX

These are two different things, on purpose.

| | Track FX | Punch FX |
|---|---|---|
| Purpose | Mixing: part of the sound of a track | Performance: something you do to the mix |
| Scope | One track | The whole mix |
| Active | Always, according to the send | Only while you hold a pad, or when written |
| Stored in | The pattern | The pattern (settings and written lane) |

Next: [Punch FX](05-punch-fx.md).
