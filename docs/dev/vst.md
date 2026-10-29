# VST3 build (optional, local only)

Pulse.8 can be built as a VST3 instrument. It is **opt-in and local**: nothing in `npm run build`, `npm test` or the GitHub
workflow touches it, and the result is a `Pulse8.vst3` bundle you copy into a plug-ins folder yourself.

The plugin is not a port. It is the [webvst](https://github.com/lwojas/webvst) host (a JUCE WebView that fakes Web Audio for
the page and runs webdsp's native engine on the DAW's audio thread) with Pulse.8 as its client. The page is the same
code that runs in a browser; the plugin loads it by URL. In a DAW the page is the **editor**: the song plays natively, on
the audio thread, against the DAW's transport (see "Playing in the DAW"). webvst's own
[architecture](https://github.com/lwojas/webvst/blob/main/docs/ARCHITECTURE.md) explains the bridge; this page covers only what Pulse.8 adds.

## Build

Prerequisites (macOS): Xcode command line tools, CMake 3.22+, and `webvst` and `webdsp` checked out **beside** Pulse8
(webdsp already has to be, see `package.json`).

```bash
git clone https://github.com/lwojas/webvst ../webvst     # once, next to ../webdsp
npm run vst:build                                        # vst/build/Pulse8_artefacts/VST3/Pulse8.vst3
cp -R vst/build/Pulse8_artefacts/VST3/Pulse8.vst3 ~/Library/Audio/Plug-Ins/VST3/
```

- `vst/CMakeLists.txt` declares one plugin from webvst's sources (nothing is copied into this repo): plugin ID `Pls8`,
  state stamp `pulse8`, ad-hoc signed after the build (enough to load here; Ableton Live refuses a broken seal, see webvst).
- JUCE is fetched on the first configure (a few minutes), or reused from `../webvst/build/_deps/juce-src` when webvst has been
  built. Override the checkouts with `-DPULSE8_WEBVST_DIR=…` / `-DPULSE8_WEBDSP_DIR=…`
  (`cmake -S vst -B vst/build -D…`).
- The DAW caches plugins: replace the bundle with the host closed, then rescan.
- Build against the same webdsp the page uses (the sibling checkout); after updating it, rebuild the plugin. The protocol is
  additive, so an older plugin still runs a newer page, with a console warning. **Native playback needs protocol 4** (bus targets in
  scheduled params, the `fixedPitch` MIDI route): against an older plugin the page falls back to sequencing itself, as in a
  browser, and the DAW's transport is not followed.

## Serving the page

The plugin loads Pulse.8 from a URL, by default the hosted app, <https://lwojas.github.io/PulseEight/> (deployed by the GitHub
workflow on every push to `main`). The plugin therefore needs network access, and runs whatever is deployed: native playback needs the
deployed page to be at least the commit that added it. To develop against local code, start a server and point the plugin at it:

```bash
npm run dev          # development, hot reload, http://localhost:5175
npm run vst:serve    # the production build, no HMR: steadier for actually using it
```

Set `WEBVST_URL_PULSE8` (or `WEBVST_URL`) to `http://localhost:5175/` in the DAW's environment, or rebuild with
`-DPULSE8_DEFAULT_URL=http://localhost:5175/` (a value cached in an existing `vst/build` wins over the default, so pass it explicitly
when switching). With the URL unreachable the editor is empty. Bundling the built page into the plugin (so it needs no network) is
webvst's "ship the clients inside the plugin" work ([RELEASE.md](https://github.com/lwojas/webvst/blob/main/docs/RELEASE.md)); it is not done there yet.

## Playing in the DAW

Everything below is gated on the host (`hasEmbeddedHost()`, `getHostState()`, `getHostFiles()`, and for playback
`capabilities.nativeSequence` with protocol 4); in a browser the app behaves exactly as before.

| | In a browser | In the plugin |
|---|---|---|
| Start gate | tap to start (audio needs a gesture) | engine starts at boot, no gesture; the gate never shows |
| Transport | the page's own (lookahead scheduler) | **the DAW's**: play, stop, locate, loop and tempo; the page's PLAY button works only while the DAW is stopped |
| Sequencing | the page schedules notes ahead | **the plugin plays the song** (`runtime.setSequence`): sample-accurate, with the window closed, in an offline bounce |
| Tempo | project BPM | the DAW's while it plays (shown, not editable); the project's BPM is untouched |
| Notes from the DAW | Web MIDI to the page | a **MIDI route**: played natively on the audio thread, with the window closed |
| Autosave | IndexedDB, 500 ms | **not used**; published to the DAW session, 300 ms |
| Export / import | download link, file input | the host's native save/open dialogs (WKWebView has neither) |
| Named saves | IndexedDB | unchanged (shared by all instances, which is fine for explicit saves) |

**Cost in a browser: none at run time.** The native code paths are gated on the host and never construct anything in a browser, the
audio worklet is untouched, and the sequence compiler and host follower (`hostplay.ts`, `nativeseq.ts`, 8 kB) are a separate chunk loaded only
inside a plugin. The shared refactors (`stepcompile.ts`, the pure write functions in `audio.ts`) cost about 5 µs per mixer apply and 3 µs
per sound apply; the page bundle is 2.5 kB gzip larger.

### The song as a native sequence (`nativeseq.ts`, `hostplay.ts`)

The plugin repeats one cycle of events against the DAW's position. The page builds that cycle, and sends it again (after a 60 ms
pause, and only if it differs) whenever the song changes. It is not a second compiler: notes come from the same `StepCompiler`
(`stepcompile.ts`) that the live scheduler uses, at a fixed 120 bpm turned into beats, and the mixer, sound and FX values come from
the same pure functions (`audio.ts`: `mixWrites`, `soundWrites`, `trackFxWrites`, `manglerWrites`) that the live engine applies. So what
the host plays is what the page would have scheduled; the e2e test below checks it against the real engine.

**What plays when.** A *layout* is a list of patterns (the chain, or the one pattern looping) and an *origin* beat. Song position at
DAW beat `P` is `(P - origin) mod cycle`, so a DAW that starts at bar 1 plays the song from its start and a locate lands where the song
is (as a MIDI Song Position Pointer does). A start, stop, locate or loop wrap resets the layout to the project's own (origin 0).

**What is baked into the sequence:**
- notes: drums, bass, FM, and the arpeggiator rendered from the sequencer's notes (the RND direction is seeded so a loop repeats;
  arps restart each song loop);
- the per-pattern state **that differs between the layout's patterns**: sound, faders, mutes and solos, delay and reverb sends, track
  FX. Written at each pattern's start and at every bar, so a locate into the middle of a pattern is repaired within a bar. State that is
  the same everywhere is left to the page's immediate writes, so a single looping pattern carries none. These are mixer writes
  (`{ bus }` targets: webdsp protocol 4), which is what lets a pattern's mix change on the audio clock;
- the written FX lanes: per step, the punch chain's values (ramping across the step, as the live scheduler does) and the punch
  section's sends, each put back to rest on the first step without it.

**Cueing a pattern** changes the layout at the next pattern boundary, at least 350 ms ahead. The host swaps sequences at an arbitrary
block, so the swap is one *transition sequence* holding the old pattern's remaining steps and the new layout, in a cycle that is a
whole number of the new layout's cycles; the page sends the steady new sequence a quarter beat after the boundary. The test
checks that the new pattern's first hit lands exactly on the boundary.

**What stays with the page (needs the window open):** a punch the player holds (it is performed live; the lanes are left out of the
sequence while it is held, as the live scheduler lets a held punch win), live keyboard arpeggios (aligned to the DAW's 16th grid
while it plays), the playhead and key lights (derived from the DAW's position), and recording a punch into a lane (WRITE).

### MIDI from the DAW

The plugin offers the DAW's MIDI to the page as a Web MIDI input ("WebVST DAW MIDI"), which Pulse.8 turns on at boot, with the
keyboard playing the focused track. When the host can route (`capabilities.midiRouting`), the page declares what a key plays
(`midi/setup.ts`), and the host plays it itself, sample-accurately, with the window closed:

| Focused track | Route | Notes |
|---|---|---|
| a drum | instrument, `fixedPitch` | every key plays the drum at its own pitch (a pad), as the page's audition does |
| a synth, arp off, no step selected | instrument, pitched, held until key-up | `unityNote = root - 12 × (keyboard octave + track octave)`, the page's own mapping |
| a synth with the arp on, or a step selected | none | the page: the arp and step entry need it |

The route follows the focus, the arp and the keyboard settings; while one is declared the page does not audition the same note. The
route does not apply the keyboard range filter the page does, and plays at the MIDI velocity (the page auditions at 0.9).

### Project recovery: closing and reopening the window

A plugin window can be closed at any moment, and closing destroys the page and its pending writes; reopening loads a fresh
page. The project must therefore live in the DAW session, which the plugin keeps in memory and saves with the session even
with the editor closed. webvst/webseq learnt these rules the hard way; `persist.ts` ("the project in a plugin host's
session") follows them and `test/hoststate.test.ts` pins them:

1. **The host's session is the source of truth.** The IndexedDB autosave slot is per WebView profile, so it is shared by every
   instance of the plugin: two Pulse8 instances would overwrite each other. It is skipped entirely when hosted.
2. **Wait for the answer before the first render, and never publish before it.** The host answers `onRestore` once with a
   snapshot or `null` ("nothing saved"). Publishing the default demo project earlier would overwrite the saved session. The
   first render waits (`restoreFromHost`), and edits are observed only after it. Nothing is published until the project
   actually changes, so a pristine instance leaves the session empty.
3. **`null` is not an error.** It means a new session: keep the demo project.
4. **An older plugin never answers.** Give up after 2.5 s and run on the default. If its answer does come later, install it
   only if nothing was edited meanwhile.
5. **Publish on a short debounce (300 ms) and flush on `pagehide` / hidden.** The window may close right after an edit.
6. **A snapshot that is not ours or unreadable starts fresh**, never wedges startup. The snapshot is stamped
   `app: "pulse8"`, `format: 2` (`HOST_FORMAT`; bump it, and keep reading the old one, if the shape changes). The data is the
   export file's JSON with each track's trailing blank steps dropped (`compactPattern`; a 16-step pattern is a quarter of its former size, and
   the snapshot crosses the plugin bridge on every window open, close and edit), so every load goes through `parseProject` and its migrations.
7. **The same snapshot is installed once.** A resubscribe is handed the answer again; re-installing would undo edits. A
   *different* later snapshot (the DAW reverting the session) is installed, after stopping playback.
8. **Large text goes as base64** from the plugin to the page (JUCE's event escaping is quadratic); the shim does that, nothing
   to do here. Untouched patterns are written as `null` (`sparse`), which keeps a typical snapshot to a few tens of KB.

Reopening the editor starts a fresh engine (webvst's "staged engine swap" is not done there), so the song is silent until the page
has started and sent the sequence: about a second after the window opens. The project itself is back at once.

## Tests

- `npm test`: unit tests, including `test/nativeseq.test.ts` (the sequence compiler: beats, swing, ties, arps, per-pattern state,
  lanes, layouts, the cue transition) and `test/hoststate.test.ts` (session restore and publish).
- `npm run vst:e2e`: **headless end to end**, no DAW. Builds `vst/build/.../Pulse8Harness` (the plugin's real `EngineHost` behind
  stdin/stdout) and runs `vst/test/pulse8.e2e.ts`, which drives Pulse.8's own page code (Groovebox, controller, MIDI) through webvst's
  page shim against it, with a DAW simulated in real time, and measures the audio it renders: hits land on the DAW's timeline within
  4 ms; playback continues with the window closed; a locate stays in phase; a chain applies each pattern's mix; a cue swaps exactly
  on the boundary; a mute is live; a written filter lane closes and reopens the chain; DAW MIDI plays once, on its own frame, as a
  fixed-pitch drum or a held synth note; the arp and step entry give the route back to the page. About 45 s. Skipped when the harness
  is not built.

## Known limits

- **A DAW stop leaves the FX where they were.** The DAW stops the voices; it does not reset parameters. With the window open the page
  puts the punch chain back; with it closed, a stop in the middle of a written lane leaves that punch on until the next play passes the
  lane's end (or the window opens).
- **A locate into a pattern that follows another repairs its mix and sound within a bar**, not at once, when the window is closed.
- **Playing, the DAW decides the tempo and Pulse.8's BPM is not used.** Swing is the project's.
- **Not baked:** a held punch and live keyboard arpeggios need the window; the arp restarts each song loop.
- A route does not filter notes outside a synth's range, and plays at MIDI velocity.
- Reopening the editor starts a fresh engine: a moment of silence until the page has sent the song again.
- No hardware MIDI controllers in a macOS plugin WebView (WKWebView has no Web MIDI); no MIDI output. Pulse.8's MIDI mapping works
  on the DAW's MIDI (CCs, program changes) while the window is open.
- VST3, macOS, ad-hoc signed. Verified headless (above) against the real engine; not yet loaded in REAPER or Live, so do that first.

## Parameter locks in the native sequence

`nativeseq.ts` bakes a step's `parameterLocks` (see `engine/plock.ts`) as `param` events at the step's swung beat: sound controls to the
instrument, sends to the track bus (protocol 4 bus targets). The next step writes a parameter the step before had locked back to its base
(a lock on a cycle's last step is undone on the loop). Where a lock lands on a beat that a per-bar state write also covers, the lock
wins. It is the same rule as the live scheduler (`Groovebox.scheduleLocks`), and `lockWrite` builds both. When the DAW stops, the page
forgets what the engine holds (`forgetLocks`) and re-sends the base sound.
