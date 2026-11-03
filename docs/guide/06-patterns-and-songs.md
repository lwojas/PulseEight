# Patterns & songs

## Patterns

Pulse.8 has **64 patterns**. A pattern holds everything about one section of your music:

- the steps for all eight tracks, 16 – 64 steps long
- every track's sound, level, delay and reverb
- the Punch FX settings and any effects you've recorded

Because the sound is saved with the pattern, switching pattern can change the whole sound of your beat.

On a larger screen, the pattern bar shows 16 patterns at a time (1–16, 17–32, 33–48, 49–64). On a phone, open the **PTN**
tab, which lists patterns 1–32; **MORE** shows the rest.

### Switching patterns

- **When stopped:** tapping a slot selects it straight away.
- **When playing:** tapping a slot **cues** it. The header shows `PTN → 05`, and the switch happens at the end of the
  current loop, right on the beat. Tapping the pattern that's already playing cancels the cue.

### Tools

| Button | What it does |
|---|---|
| **COPY** | Tap COPY, then tap a slot: the current pattern is copied there, replacing whatever was in it. Tap the current slot to cancel. |
| **CLR PTN** | Empties the current pattern (tap twice). |

## Chains

A **chain** plays patterns one after another, so you can build a whole song. Each row of the chain says *play this pattern
this many times, then move on*:

```
01  01  INTRO           ×2
02  02  GROOVE + BUILD  ×4
03  05                  ×2
04  03  MAIN            ×8
```

1. Tap **EDIT** under CHAIN.
2. Tap pattern slots in the order you want them. Each tap adds a row that plays once. A chain holds up to 64 rows and
   256 passes in all, and the same pattern can appear in more than one row.
3. Set how many times each row plays with **−** and **+** (1 – 99), and give it a name if you like (up to 16 characters;
   the name belongs to the row, not the pattern).
4. Tap **DONE**, then switch the chain **ON**.

Tap a row's number to select it. A selected row shows **▲ ▼** to move it and **✕ REMOVE**. While you are in EDIT with a row
selected, tapping a pattern slot swaps that row's pattern instead of adding one; tap the row's number again to go back to
adding. **CLR CHAIN** empties the chain (tap twice: the first tap asks SURE?).

With the chain on, playback starts at the first row and loops round the whole chain. While it plays, the row being heard
is marked and shows which repeat it is on (`2/4`). Changing a row's repeats or order while playing carries on without
stopping. If you cue a pattern that's in the chain, the chain carries on from the first row that holds it.

If a track in a pattern has a shorter last step (see [Sequencing](02-sequencing.md)), it keeps its own loop through a row's
repeats, as it does when you loop a pattern by hand, and starts over when the pattern changes.

The chain, and whether it's switched on, is saved with your project. Projects saved before repeats existed open as they
were: a pattern listed several times in a row becomes one row with that many repeats.

## Building a track

1. **Pattern 1:** your main groove.
2. **COPY** it to pattern 2. Take out the kick and let the FM line lead: a breakdown.
3. **COPY** the main groove to pattern 3. Load the **TECHNO HARD** kit and record a **ROLL** into the last bar: a build.
4. Chain them: `1 ×4`, `2 ×2`, `3 ×1`, `1 ×4`.

Next: [Projects & storage](07-projects.md).
