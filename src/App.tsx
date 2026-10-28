import { useEffect } from "react";
import { controller } from "./engine/controller";
import { getState, setState, useStore } from "./engine/store";
import type { Tab } from "./engine/state";
import { Header } from "./ui/Header";
import { ManglerPanel, TrackFxPanel, MixerPanel, PatternsPanel, PunchBar, SoundPanel } from "./ui/Panels";
import { SequencerPanel } from "./ui/Sequencer";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "seq", label: "SEQ" },
  { id: "sound", label: "SOUND" },
  { id: "mix", label: "MIX" },
  { id: "fx", label: "FX" },
  { id: "ptn", label: "PTN" },
];

function StartGate() {
  const audio = useStore((s) => s.audio);
  const error = useStore((s) => s.audioError);
  if (audio === "ready") return null;
  const start = async () => {
    await controller.start();
    if (getState().audio === "ready") controller.play();
  };
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="logo big">PULSE<span>.8</span></div>
        <p className="silk">DRUMS · ACID BASS · FM · FX MANGLER</p>
        <button type="button" className="btn play gate-btn" onClick={start} disabled={audio === "starting"} autoFocus>
          {audio === "starting" ? "STARTING…" : "▶ TAP TO START"}
        </button>
        {audio === "error" && <p className="error" role="alert">Audio could not start: {error}</p>}
      </div>
    </div>
  );
}

export function App() {
  const tab = useStore((s) => s.tab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if (e.code === "Space" && target.tagName !== "BUTTON") {
        e.preventDefault();
        controller.togglePlay();
      } else if (/^[1-8]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        setState({ focus: Number(e.key) - 1, selStep: -1 });
        controller.audition(Number(e.key) - 1);
      } else if (e.key === "[" || e.key === "]") {
        const len = getState().patterns[getState().pattern].length / 16;
        setState((s) => ({ page: (s.page + (e.key === "]" ? 1 : len - 1)) % len }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" data-tab={tab}>
      <Header />
      <main className="layout">
        <div className="band">
          <section className="panel sound-panel" aria-label="Sound"><SoundPanel /></section>
          <section className="panel trackfx-panel" aria-label="Track FX"><TrackFxPanel /></section>
          <section className="panel fx-panel" aria-label="Punch FX"><ManglerPanel /></section>
        </div>
        <div className="col col-a">
          <section className="panel seq" aria-label="Sequencer">
            <SequencerPanel />
            <PunchBar />
          </section>
        </div>
        <div className="col col-c">
          <section className="panel mix-panel" aria-label="Mixer"><MixerPanel /></section>
        </div>
        <section className="panel ptn-panel" aria-label="Patterns"><PatternsPanel /></section>
      </main>
      <nav className="tabs" aria-label="Screens">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tab" data-active={tab === t.id} aria-pressed={tab === t.id} onClick={() => setState({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </nav>
      <StartGate />
    </div>
  );
}
