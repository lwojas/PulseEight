# MIDI and external control

The player's view (which CC does what, how to switch it on) is in the [MIDI guide](../guide/08-midi.md). This page is the design.

```
 UI / actions ─┐                         ┌─ midi/control.ts  ◄─ midi/mapping.ts (CC numbers live ONLY here)
 AppState      ├─ engine/params.ts ──────┤   (generic: ids + mapping + a ParamBus)
 (the truth)   ┘   ids, kinds, ranges,   ├─ midi/clock.ts    Clock/Start/Stop/Continue/SPP follower (pure)
                   origin per change     └─ (future) VST host parameters, automation
 midi/ports.ts   Web MIDI ports      midi/setup.ts   the only MIDI file that imports the app
```

- **Parameters** (`engine/params.ts`): stable ids (`track.1.volume`, `track.8.sound.color`, `pattern.select`) over the
  existing store. Each reads AppState and writes through the same actions the UI calls. No second state.
- **Origin** (`engine/source.ts`): `ui | midi | host | automation | internal`, ambient for one synchronous store write.
  `setParam(id, v, source)` tags the write; the store observer reports every changed parameter with that origin.
  Untagged writes are `ui`; the scheduler's pattern changes are `internal`.
- **Mapping** (`midi/mapping.ts`): `{ defaultChannel, parameters: { id: { cc, channel?, invert? } }, program }`.

## Channels
The mapping uses 1-16 (as on a controller). Bytes on the wire use 0-15; the
conversion is in `midi/control.ts` only. webtracker stores 0-15 in its model and shows 1-16; here the file a person edits
is the one that speaks 1-16. A parameter without `channel` inherits `defaultChannel`.

## Initial map
One channel per track (1 KICK … 8 FM), same CCs on each:

| CC | Parameter | CC | Parameter |
|---|---|---|---|
| 7 | volume | 20 | mute (0-63 off, 64-127 on; out 0/127) |
| 12 | delay send | 21 | solo |
| 91 | reverb send | 22 | arpeggiator (ACID, FM) |
| 70-75 | the track's knobs in app order | 74 / 71 | ACID filter / resonance (70 env mod, 72 decay, 73 bite, 75 wave) |

Stepped knobs (FM COLOR) split 0-127 into equal bands. CC 10 is unassigned: the app has no pan.
Patterns: **Bank Select (CC 0) + Program Change** on the default channel, 4 banks x 16 = 64 patterns. While playing the pattern
is cued for the next loop (as tapping a slot does). Volume, sends and knobs edit the pattern on screen, as the UI does. Sends and knobs are lockable (`engine/plock.ts`): in P-LOCK mode, with a step selected on the focused track, they read and write that step's parameter lock instead of the base, and a selection change is reported as a value change.

## Keyboard (MIDI settings: KEYBOARD, KEY OCTAVE)
`midi/setup.ts` only. Ports listen to every input and tag each message with its port id; `setup.ts` filters: control (CC, program,
clock) from `input`, notes from `keyboard` (`off | all | id`). Notes are taken before the CC engine, on any channel, and routed to `focus`:
drum = `audition`; melodic = `arpDown/arpUp` if the arp is on and no step is selected, `setStepNote` if a step is selected, else
`audition`. Notes shift by `keyboardOctave` and are ignored outside `noteLo..noteHi` (folding into range made a 2-octave keybed repeat
one octave). Held arp notes are released when the keyboard or MIDI is turned off.

## Echo
Changes carry their origin. Output skips `midi`. The engine also remembers the last 7-bit value per controller, so an
unchanged value is not resent. Known: a Program Change cues; the pattern then changes later by the scheduler (`internal`)
and the new program is sent back. That is information, not a loop (the same pattern is a no-op).

## Clock and song position (MIDI settings: FOLLOW MIDI CLOCK)
`midi/clock.ts` is pure: pulses carry the time they arrived. 24 PPQN, 6 pulses per 16th (= one SPP unit). Start = next pulse is
position 0; Continue resumes from SPP or where Stop left; SPP while running restarts on the next pulse. Tempo is the mean over a
beat, rounded to 0.1, hysteresis 0.15, clamped 60-200 and written to `bpm`. The existing lookahead scheduler is not replaced:
`controller.play({songStep, time})` starts it aligned to the clock and `followPhase` nudges its grid 25% of the error at each step
(a small PLL). It plays `CLOCK_LATENCY` (50 ms) behind the sender. SPP maps through `engine/song.ts`: the chain when on,
otherwise the current pattern looping. If pulses stop for 1 s the transport stops. The app does not send clock.

## Provenance
The port layer follows the shape of the author's earlier webtracker MIDI code. Reused: overridable `requestMIDIAccess`, listen on all connected inputs with statechange, the "input is a stream, consumer is
one contract" shape, no `midi-core` dependency, status/channel parsing. Not reused: the Push device layer, note-input contract,
`setTimeout` note scheduling (no notes are sent here), and its (absent) CC feedback handling.

## Plugin build (assumptions)
1. **DAW MIDI already works** through the shim's virtual "WebVST DAW MIDI" input, CCs and program changes included (the shim
   delivers channel messages to the page). The mapping applies unchanged. System real-time and SPP are not forwarded and are
   not needed: use the host transport.
2. **No MIDI out in the shim.** Output to a DAW (CC feedback) needs the native MIDI bridge webvst lists as not done.
3. **DAW control, better than the shim:** use real VST parameters, not CCs. `paramManifest()` is pure data (id, label, kind,
   range, default, labels). Generate it to JSON at build time and have the plugin register fixed `AudioProcessorParameter`s from
   it (JUCE needs them at construction; ids are stable, so sessions keep their automation). Page to host: parameter changed;
   host to page: `setParam(id, v, "host")`. `host`-origin changes must not be sent back to the host. Needs a small webdsp
   bridge command pair; nothing in the app changes.
4. **Host transport** is wired, but not through the MIDI clock follower: a plugin that can play a native sequence plays the song
   itself against the DAW's transport (`engine/hostplay.ts`, [VST3 build](vst.md)), so there is nothing to follow. The clock follower
   stays for hardware clocks in a browser.
5. `hasEmbeddedHost()` turns MIDI on at boot in the plugin, with the keyboard playing the focused track. When the host can route
   (`capabilities.midiRouting`) the page declares a MIDI route and the host plays those notes natively (`midi/setup.ts`).

## Open design questions (plugin build)
- Per-pattern parameters (volume, sends, knobs): a DAW needs one value per parameter. Decide whether host parameters mean "the
  pattern playing now" (current behaviour) or become project-level. Automation of a per-pattern value is surprising otherwise.
- The mapping is generated by a short loop, not a literal table, to stay in step with the 8 tracks; a literal is easy to produce if wanted.
- No pan parameter exists; add DSP and a param when wanted, then give it CC 10.
