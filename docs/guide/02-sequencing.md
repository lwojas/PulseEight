# Sequencing

Each pattern is a grid of **16 to 64 steps**. One step is a 16th note, and every track has its own row.

## Pages and length

The step pads show 16 steps at a time. The pages are labelled `1-16`, `17-32`, `33-48` and `49-64`.

- **Length (`LEN`)** steps through 16 → 32 → 48 → 64. When the pattern gets longer, the new bars are filled with a copy
  of the page you're looking at, so a longer pattern starts out as a repeat of what you already have.
- Tapping a page beyond the current length stretches the pattern to reach it. Changing the length this way (or with
  **LEN**) also resets every track's **LAST STEP** to the new length.
- **FOLLOW** keeps the page in step with the playhead while the pattern plays.
- On a computer keyboard, `[` and `]` change page.

## Drum tracks

| What you do | What happens |
|---|---|
| **Tap** a pad | Switches the hit on or off. A new hit sounds straight away. |
| **Hold** a pad (or **Shift**-click it) | Selects the step without changing it. |
| **ACCENT** button | With a step selected, makes that hit an accent (a harder hit), or takes the accent off. |

Tapping a track in the track strip plays it once while the beat is stopped, so you can listen to a sound without
changing the pattern.

## Acid and FM tracks

Every step on these tracks holds a note, and can also be an accent or a slide.

| What you do | What happens |
|---|---|
| **Tap an empty step** | Adds a note and selects it. A new step starts on the track's default note, which you can change. |
| **Tap a note that isn't selected** | Selects it so you can edit it. |
| **Tap the selected note** | Removes it. |
| **Hold a step** (or **Shift**-click) | Adds and selects it without removing anything. (Shift-click only selects.) |

With a step selected, play the on-screen keys to choose its note. The editor beside the pads shows the step number and
two switches:

- **ACCENT**: a harder note. On the acid bass, an accent is also brighter and grittier, depending on the **BITE** knob.
  That's the classic acid sound.
- **SLIDE**: glides into this note from the note on the step before it, without hitting it again. The previous step has
  to have a note for the slide to work; on its own, a slide just sounds like a normal note.

By default a note lasts for 62% of a step. To change that, select a melodic step and use the **GATE** buttons above the
pads (1, 2 or 3 steps, a quarter bar, a half bar or a whole bar). Tap the active one again to go back to the default. On
a phone, a single **GATE** button opens these choices. A slide holds the first note all the way into the next.

**OCT** moves the whole track up or down by octaves. The ◀ ▶ buttons beside the keys scroll the keyboard.

### Recording notes as you play

Press **REC** in the play controls and start the beat. Now play the on-screen keys (or a MIDI keyboard) and each note is
written onto the nearest step as you play it. How long you hold the key sets the note's length (its **GATE**). Press **REC**
again to stop recording. Recording is a live performance tool, so it's switched off each time you reload the page.

### Playable range

| Track | Range | Default new note |
|---|---|---|
| ACID | C1 – B3 | C1 |
| FM | C2 – B4 | C3 |



### Key and scale

Open **☰ → Key & Scale** to choose a root note and a scale (14 to pick from, from Major and Minor to Blues and Whole
Tone). You can also choose a **genre preset**, such as Acid, Deep House, Detroit Techno, Liquid DnB, Synthwave or UK
Garage.

The key only affects **notes you add from now on**. The keyboards show just the notes in the scale, and **RND** only
writes notes from the scale. Notes already in your pattern are never changed or removed, so you can switch key whenever
you like without breaking anything. Leave it on *Chromatic* to have every note available.

**Key highlight** (☰ → Display) lights up the keys as the sequencer and arpeggiator play them.

## Arpeggiator

The ACID and FM tracks each have an arpeggiator. Hold down one or more keys and it plays them one after another
as a pattern, in time with your tempo. It works whether or not the beat is playing.

| Setting | Choices |
|---|---|
| **Power** | On or off for each track. The ARP button on the track switches it. |
| **Rate** | 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32 |
| **Direction** | Up, Down, Up/Down, Random |
| **Octaves** | 1 – 4 |
| **Velocity** | How hard every arpeggio note plays |
| **Gate** | How long each note is held |

With the arpeggiator on, the notes in your sequence feed it too. Each step is held for as long as its **GATE**, so by
default one note is arpeggiated across its octaves for a step, and a longer gate keeps it going. When the gates of
several steps overlap, those notes are held together, so long gates on a few steps make a chord for the arpeggiator to
play through.

Press the arpeggiator button on a melodic track to open its full settings. They're saved with your project.

## Quick pattern tools

| Button | What it does |
|---|---|
| **TOOLS** | Opens the track's tools menu: **RND**, **CLR TRACK** and **LAST STEP**. |
| **RND** | Writes a new random pattern for the selected track. Drums get a sensible spread of hits for each instrument; melodic tracks get notes from your scale, with accents and slides. |
| **CLR TRACK** | Clears the selected track's steps in this pattern (tap twice to confirm). |
| **LAST STEP** | Sets the step where the selected track jumps back to the start. It counts across all the bars, so 27 means step 27 of 32, whichever bar you're on. Every track has its own, so a shorter track keeps looping inside a longer pattern and the tracks slowly drift against each other, a classic way to get evolving rhythms. Steps after the last step stay in the pattern (shown dimmed) and play again if you raise it. Changing the pattern length resets every track's last step. In a chain, each pattern starts its tracks from the beginning; the drifting only carries on while a single pattern repeats. |
| **GATE** | On melodic tracks, sets the note length of the selected step. |

Selecting a track plays it once when the beat is stopped. Mute and solo are on the track strip (on larger screens) and in
the Mix tab.

## Changing single steps (TWEAK)

The sound knobs set the **overall** sound of a track. TWEAK lets individual steps sound different from it.

1. Press **TWEAK** (under the sound knobs). Tapping a step now only *selects* it, even if it's empty. Nothing is added
   or removed.
2. Turn a sound knob. Only that one setting is changed, and only on the selected step. The knob turns pink and the step
   gets a pink dot. The knobs always show what the selected step is using.
3. Select another step and do the same. **CLR STEP** removes the selected step's tweaks without touching the step itself
   or the overall sound.
4. Press **TWEAK** again to leave. Your tweaks stay, and the knobs go back to changing the overall sound, which affects
   every step that has no tweak for that setting.

The DLY and REV knobs and the DIST slider can be tweaked per step just like the sound knobs. On a phone, the **TWEAK** key next to GATE in
the sequencer switches TWEAK on and off without leaving the sequencer.

If you use a MIDI controller, its knobs follow the screen. In TWEAK mode with a step selected, a mapped sound knob or
send changes that step's tweak. A knob belonging to a different track still changes that track's overall sound. Tweaks
also play in the VST3 plugin version. Volume, mute, solo and the arpeggiator can't be tweaked per step.

Next: [Sound design](03-sound.md).
