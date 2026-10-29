// A headless plugin for the end-to-end test (vst/test/e2e.test.ts): the real EngineHost (the plugin's audio engine and command
// bridge) driven over stdin/stdout, with a DAW simulated by the caller. One JSON object per line in, one per reply.
//
//   {"op":"msg","msg":{...}}                     a message from the page (a HostCommand or one of the shim's own)
//   {"op":"render","blocks":N,"playing":bool,"ppq":x,"bpm":b,"midi":[{"frame":f,"bytes":[0x90,60,100]}]}
//                                                render N blocks of 128 frames from DAW position `ppq` (advancing at `bpm` while
//                                                playing); MIDI frames count from the start of the render
//                                           ->   {"op":"events","frames":total,"events":[...]}   what the engine sent the page
//   {"op":"dump","path":"..."}                   write the left channel rendered so far as raw float32
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include "EngineHost.h"

int main() {
  juce::ScopedJuceInitialiser_GUI init;
  constexpr int kBlock = 128;
  constexpr double kSr = 48000.0;
  EngineHost host;
  std::vector<juce::var> pending;
  host.setEventSink([&](const juce::var& e) { pending.push_back(e); });
  host.prepare(kSr);
  juce::AudioBuffer<float> buf(2, kBlock);
  std::vector<float> rec;
  std::string line;
  while (std::getline(std::cin, line)) {
    const juce::var v = juce::JSON::parse(juce::String(line));
    const juce::String op = v["op"].toString();
    if (op == "msg") {
      host.handleMessage(v["msg"]);
    } else if (op == "render") {
      const int blocks = static_cast<int>(v["blocks"]);
      const bool playing = static_cast<bool>(v["playing"]);
      const double ppq0 = static_cast<double>(v["ppq"]);
      const double bpm = static_cast<double>(v["bpm"]);
      const juce::var midi = v["midi"];
      for (int b = 0; b < blocks; b++) {
        EngineHost::HostTimeInfo hi;
        hi.valid = true;
        hi.playing = playing;
        hi.bpm = bpm;
        hi.ppq = ppq0 + (playing ? b * kBlock / kSr * bpm / 60.0 : 0.0);
        juce::MidiBuffer mb;
        if (auto* arr = midi.getArray()) {
          for (const auto& m : *arr) {
            const int f = static_cast<int>(m["frame"]);
            if (f < b * kBlock || f >= (b + 1) * kBlock) continue;
            const auto* bytes = m["bytes"].getArray();
            if (!bytes || bytes->size() < 2) continue;
            const juce::MidiMessage msg(static_cast<int>((*bytes)[0]), static_cast<int>((*bytes)[1]), bytes->size() > 2 ? static_cast<int>((*bytes)[2]) : 0);
            mb.addEvent(msg, f - b * kBlock);
          }
        }
        buf.clear();
        host.process(buf, hi, mb);
        rec.insert(rec.end(), buf.getReadPointer(0), buf.getReadPointer(0) + kBlock);
      }
      host.flushEvents();
      juce::Array<juce::var> events;
      for (auto& e : pending) events.add(e);
      pending.clear();
      auto* o = new juce::DynamicObject();
      o->setProperty("op", "events");
      o->setProperty("frames", static_cast<double>(rec.size()));
      o->setProperty("events", juce::var(events));
      std::printf("%s\n", juce::JSON::toString(juce::var(o), true).toRawUTF8());
      std::fflush(stdout);
    } else if (op == "dump") {
      juce::File f(v["path"].toString());
      f.replaceWithData(rec.data(), rec.size() * sizeof(float));
      std::printf("{\"op\":\"dumped\"}\n");
      std::fflush(stdout);
    }
  }
  return 0;
}
