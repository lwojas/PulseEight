# Mixing & track FX

## Level, mute and solo

Every track has a **level** fader, a **M**ute button and a **S**olo button. You'll find them on the **MIX** tab, or in the
slim mixer column on larger screens.

- **Level**: the bottom of the fader gives you fine control over quiet levels, and about 95% is the original volume. Each
  instrument also has its own built-in level setting, so everything is nicely balanced when you start.
- **Mute** silences a track. **Solo** silences everything that isn't soloed, and you can solo several tracks together.
- Mute and solo are for playing live. They aren't saved with your project and reset when you reload the page.
- The fader and mute come *before* a track's delay and reverb. A muted track's echoes and reverb fade away with it, and a
  track with its level at zero sends nothing.

## Delay and reverb

Each track has its own **delay** and **reverb**, so the snare can sit in a small room while the clap rides a long echo.

Set how much of each a track gets with the `DLY` and `REV` knobs on the **SOUND** panel. The delay's time and the
reverb's size are on the **Track FX** panel.

Below those knobs, the **PUNCH FX** button decides whether the track takes part in the [Punch FX](05-punch-fx.md). It's
on by default. Switch it off and the track ignores punches completely: it isn't thrown into the echoes, and it isn't cut
out when an effect takes over the mix, so it carries on playing dry. It's separate from the delay and reverb, is saved with
each pattern, and can be controlled from MIDI.

### Delay

| Mode | Time |
|---|---|
| **FREE** | Any time from 40 to 900 milliseconds |
| **SYNC** | A note length at your tempo: `1/16`, `1/8`, `1/8.`, `1/4`, `1/8T` |

SYNC follows the tempo, including tempo changes and an external MIDI clock. FREE stays at the same time whatever the
tempo. The feedback and tone are set for you so the delay always sits well in the mix.

### Reverb

Each track has a send amount and a **SIZE**. Bigger sizes ring for longer and sound brighter, so a big room is also a
brighter one.

### Starting settings

New patterns start with a ready-to-go mix. Every track except the kick has a little delay, and the snare, clap, percussion and FM have some reverb. Double-tap a send knob to put it back to its starting
value.

## Track FX and Punch FX

These are two different things, on purpose.

| | Track FX | Punch FX |
|---|---|---|
| What it's for | Mixing: part of how a track sounds | Performing: something you do to the whole mix |
| Affects | One track | The whole mix |
| When it's on | Always, depending on the send amount | Only while you hold a pad, or when recorded |
| Saved with | The pattern | The pattern (the settings and the recorded effects) |

Next: [Punch FX](05-punch-fx.md).
