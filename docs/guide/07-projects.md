# Projects & storage

## Autosave

Pulse.8 saves automatically about half a second after you change anything, and again the moment you leave the page.
Reload, close the tab, come back tomorrow: you are where you stopped. Autosave lives in your browser's IndexedDB, so
it is private to that browser on that device.

Saved: all 64 patterns, the chain, tempo, swing, key and scale, arpeggiator settings. Not saved: mute, solo,
WRITE/ERASE arming, the current screen, and other performance state.

## Named saves

- **SAVE** names the project (up to 40 characters). Saving under an existing name replaces it.
- **LOAD** lists your saves with their dates. Tap one to load it; ✕ deletes it. Loading replaces the current project.
- The project name is shown in the header (`UNSAVED` until named).

## Export and import

**☰ → Project file**

- **EXPORT** downloads the project as `<name>.pulse8.json`.
- **IMPORT** loads a file you exported.

Exports are how you back up work, move it to another device, or share it. Projects from earlier versions of Pulse.8 are
upgraded automatically when they load.

## When storage is blocked

Private or incognito windows, and browsers set to refuse site data, do not allow storage. Pulse.8 tells you: the SAVE
button shows a warning, and nothing is autosaved. Open Pulse.8 in a normal window, or use **EXPORT** to keep your work
as a file.

## Display

**☰ → Display** has **Key highlight**, which lights the on-screen keys as notes play. It is remembered per browser.

## Requirements

A current browser with Web Audio (AudioWorklet) and IndexedDB. The first tap starts audio, because browsers require a
gesture before they allow sound. MIDI additionally needs Web MIDI support ([MIDI](08-midi.md)).

Next: [MIDI](08-midi.md).
