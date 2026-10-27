// Transport bar: logo, play/stop, tempo and swing, the current pattern.
import { useRef, type CSSProperties } from "react";
import { controller } from "../engine/controller";
import { setState, useStore } from "../engine/store";
import { Knob } from "./controls";
import { PatternBar } from "./Panels";
import { ProjectMenu } from "./ProjectMenu";
import { usePlayheadEffect } from "./usePlayhead";

/** The step counter: updated by the playhead directly, never through React. */
function StepReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  const length = useStore((s) => s.patterns[s.pattern].length);
  usePlayheadEffect((v) => {
    if (ref.current) ref.current.textContent = v >= 0 ? String(v + 1).padStart(2, "0") : "--";
  });
  return (
    <b>
      <span ref={ref}>--</span>
      <small>/{length}</small>
    </b>
  );
}

export function Header() {
  const playing = useStore((s) => s.playing);
  const bpm = useStore((s) => s.bpm);
  const swing = useStore((s) => s.swing);
  const pattern = useStore((s) => s.pattern);
  const cue = useStore((s) => s.cue);
  const nudge = (d: number) => setState({ bpm: Math.min(200, Math.max(60, Math.round((bpm + d) * 10) / 10)) });
  return (
    <header className="topbar">
      <div className="transport">
      <div className="logo">PULSE<span>.8</span></div>
      <button
        type="button" className="btn play" data-active={playing} aria-pressed={playing}
        onClick={() => controller.togglePlay()}
      >
        <span aria-hidden="true">{playing ? "■" : "▶"}</span>
        <span className="lbl">{playing ? "STOP" : "PLAY"}</span>
      </button>
      <div className="oled" aria-label="Tempo">
        <button type="button" className="oled-btn" aria-label="Slower" onClick={() => nudge(-1)}>−</button>
        <div className="oled-main">
          <span className="silk">BPM</span>
          <b>{bpm.toFixed(1)}</b>
        </div>
        <button type="button" className="oled-btn" aria-label="Faster" onClick={() => nudge(1)}>+</button>
      </div>
      <button type="button" className="oled ptn" aria-label="Pattern, tap to open the pattern list" onClick={() => setState({ tab: "ptn" })}>
        <div className="oled-main">
          <span className="silk">PTN{cue !== null ? " → " + String(cue + 1).padStart(2, "0") : ""}</span>
          <b>{String(pattern + 1).padStart(2, "0")}</b>
        </div>
        <div className="oled-main">
          <span className="silk">STEP</span>
          <StepReadout />
        </div>
      </button>
      <div className="swing" style={{ "--acc": "var(--tone)" } as CSSProperties}>
        <Knob
          label="SWING" value={(swing - 0.5) / 0.25} def={0} accent="var(--tone)"
          readout={`${Math.round(swing * 100)}%`} onChange={(v) => setState({ swing: 0.5 + v * 0.25 })}
        />
      </div>
      <ProjectMenu />
      </div>
      <PatternBar />
    </header>
  );
}
