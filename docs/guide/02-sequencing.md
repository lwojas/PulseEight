# Sequencing

Each pattern is a grid of **16 to 64 steps**. A step is a 16th note. Every track has its own row.

## Pages and length

The step pads show 16 steps at a time. Pages are labelled `1-16`, `17-32`, `33-48`, `49-64`.

- **Length (`LEN`)** cycles 16 → 32 → 48 → 64. When it grows, the new bars are filled with a copy of the page you are
  looking at, so a longer pattern starts out as a loop of what you already have.
- Tapping a page beyond the current length extends the pattern to reach it.
- **FOLLOW** makes the page track the playhead while the pattern plays.
- On a keyboard, `[` and `]` change page.

## Drum tracks

| Gesture | Result |
|---|---|
| **Tap** a pad | Toggles the hit. A new hit sounds immediately. |
| **Hold** a pad | **Accent**: a harder hit (full velocity instead of 70%). Holding an empty pad places an accented hit; holding an accented hit removes the accent. |

Tapping a track in the track strip plays it once (when stopped), so you can audition a sound without touching the pattern.

## Acid and FM tracks

Melodic steps carry a note, an accent flag and a slide flag.

| Gesture | Result |
|---|---|
| **Tap an empty step** | Places a note on the step and selects it. A fresh step starts on the track's default note; the note is yours to change. |
| **Tap an unselected note** | Selects it for editing. |
| **Tap the selected note** | Removes it. |
| **Hold a step** | Places and selects it without removing anything. |

With a step selected, play the on-screen keys to set its note. The editor beside the pads shows the step number and
two switches:

- **ACCENT**: a harder note. On the acid bass an accent is brighter and grittier as well as louder, in proportion to the **BITE** knob: the classic acid accent.
- **SLIDE**: glides into this note from the previous step's note without retriggering. Slide needs the previous step
  to be on; a slide on its own is an ordinary note.

Notes sustain for 62% of a step by default. Select a melodic step and use the **GATE** buttons above the pads (DEF 62% of a step, 1/4 a bar, or a whole bar) to set its length. A slide holds the previous note all the way into the next.

**OCT** shifts the whole track up or down by octaves. The ◀ ▶ buttons beside the keys move the keyboard's view.

### Playable range

| Track | Range | Default new note |
|---|---|---|
| ACID | C1 – B3 | C1 |
| FM | C2 – B4 | C3 |

### Key and scale

Open **☰ → Key & Scale** to set a root and a scale (14 scales from Major and Minor to Blues and Whole Tone), or pick a
**genre preset** (Acid, Deep House, Detroit Techno, Liquid DnB, Synthwave, UK Garage and more).

The key shapes **note entry only**: the keyboards show just the notes in the scale, and **RND** only writes notes in
the scale. It never rewrites or restricts notes already in a pattern, so you can change the key at any time without
damaging anything. Leave it on *Chromatic* for every note.

**Key highlight** (☰ → Display) lights the keys as the sequencer and arpeggiator play them.

## Arpeggiator

The ACID and FM tracks each have an arpeggiator. Hold one or more keys and it plays them as a sequence, locked to the
project tempo and the sequencer's clock. It runs whether or not the transport is playing.

| Setting | Options |
|---|---|
| **Power** | Per track. The ARP button on the track toggles it. |
| **Rate** | 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32 |
| **Direction** | Up, Down, Up/Down, Random |
| **Octaves** | 1 – 4 |
| **Velocity** | How hard every arp note plays |
| **Gate** | How much of each note length is held |

With the arp on, sequenced steps feed it too: each step is held into the arp for its **GATE**, so DEF arpeggiates that one note (its octaves, if set) for a step, and 1/4 or BAR keeps it going. Steps whose gates overlap are held together, so long gates on several steps build a chord for the arp to walk.

Open the full panel with the arpeggiator button on a melodic track. Settings are saved with the project.

## Quick pattern tools

| Button | Does |
|---|---|
| **RND** | Writes a fresh pattern for the selected track. Drums get a density map per instrument; melodic tracks get notes from the project scale, with accents and slides. |
| **CLR** | Clears the selected track's steps in this pattern (confirm with a second tap). |
| **GATE** | Melodic tracks: note length of the selected step. |

Selecting a track in the rail plays it once when stopped. Mute and solo live in the rail (wide screens) and the Mix tab.

Next: [Sound design](03-sound.md).
