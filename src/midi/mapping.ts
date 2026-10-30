// Pulse.8's external control contract: which MIDI controller moves which parameter. This is the only
// file that contains CC numbers. Edit it freely; nothing else needs to change. Parameter ids come from
// engine/params.ts, and the engine that applies this (midi/control.ts) is generic.
//
// Channels are 1-16. A parameter without `channel` uses `defaultChannel`.
//
// Layout: one channel per track (the usual multitimbral hardware layout), the same CC numbers on
// every channel. Pattern selection is Bank Select + Program Change on the default channel.
//
//   CC   7  volume                 CC  91  reverb send        CC 70-75  the track's sound knobs, in
//   CC  12  delay send             CC  20  mute (64+ = on)               the order shown in the app
//   CC  21  solo                   CC  22  arpeggiator on     (acid bass: 74 filter, 71 resonance)
//   CC  77  distortion (acid bass only)
//
// There is no pan: the app has none. CC 10 is left free for it.
import { BASS_TRACK, NUM_TRACKS, TRACKS } from "../engine/spec";
import type { MidiMapping } from "./control";

const TRACK_COUNT = NUM_TRACKS;
/** Sound knob CCs by position on the track (Sound Controller 1-6). */
const SOUND_CCS = [70, 71, 72, 73, 74, 75];

/** Tracks whose knobs follow the General MIDI sound-controller meanings instead of position. */
const SOUND_BY_KEY: Record<number, Record<string, number>> = {
  // ACID: filter = brightness (74), resonance (71), the rest in order
  6: { cutoff: 74, reso: 71, envmod: 70, decay: 72, bite: 73, wave: 75 },
};

/** Sound knob keys per track, as listed in engine/spec.ts. Kept here as plain data so the file reads as
 * a table; `test/midi.test.ts` fails if it drifts from the spec. */
const SOUND_KEYS: string[][] = [
  ["tune", "sweep", "decay", "punch", "drive"], // KICK
  ["tune", "decay", "snap", "noise"], // SNARE
  ["tune", "decay", "metal", "tone"], // CL HAT
  ["tune", "decay", "metal", "tone"], // OP HAT
  ["tune", "decay", "spread", "snap"], // CLAP
  ["tune", "drop", "decay", "body", "damp"], // PERC
  ["cutoff", "envmod", "decay", "reso", "bite", "wave"], // ACID
  ["color", "depth", "bite", "tone", "decay"], // FM
];
const MELODIC = TRACKS.filter((t) => t.role !== "drum").map((t) => t.id);

function build(): MidiMapping["parameters"] {
  const parameters: MidiMapping["parameters"] = {};
  for (let t = 0; t < TRACK_COUNT; t++) {
    const channel = t + 1;
    const id = (name: string) => `track.${t + 1}.${name}`;
    parameters[id("volume")] = { cc: 7, channel };
    parameters[id("mute")] = { cc: 20, channel };
    parameters[id("solo")] = { cc: 21, channel };
    parameters[id("delaySend")] = { cc: 12, channel };
    parameters[id("reverbSend")] = { cc: 91, channel };
    if (MELODIC.includes(t)) parameters[id("arp")] = { cc: 22, channel };
    if (t === BASS_TRACK) parameters[id("distortion")] = { cc: 77, channel };
    SOUND_KEYS[t].forEach((key, i) => {
      parameters[id(`sound.${key}`)] = { cc: SOUND_BY_KEY[t]?.[key] ?? SOUND_CCS[i], channel };
    });
  }
  return parameters;
}

export const midiMapping: MidiMapping = {
  defaultChannel: 1,
  parameters: build(),
  // 64 patterns = 4 banks of 16. Bank Select (CC 0) picks the bank, Program Change 0-15 the pattern.
  program: { param: "pattern.select", bankSize: 16, bankCc: 0 },
};
