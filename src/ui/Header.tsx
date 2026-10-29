// Transport bar: logo, play/stop, tempo and swing, the current pattern.
import { useRef, type CSSProperties } from "react";
import { PRODUCT } from "../product";
import { controller } from "../engine/controller";
import { setState, useStore } from "../engine/store";
import { Knob, Stepper } from "./controls";
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
  const projectBpm = useStore((s) => s.bpm);
  // while a plugin host plays the song the DAW sets the tempo: show it, and do not offer to change it
  const hostBpm = useStore((s) => s.hostBpm);
  const bpm = hostBpm ?? projectBpm;
  const swing = useStore((s) => s.swing);
  const pattern = useStore((s) => s.pattern);
  const cue = useStore((s) => s.cue);
  const rec = useStore((s) => s.rec);
  const nudge = (d: number) => setState({ bpm: Math.min(200, Math.max(60, Math.round((projectBpm + d) * 10) / 10)) });
  return (
    <header className="topbar">
      <div className="transport">
        <div className="logo">{PRODUCT.logo[0]}<span>{PRODUCT.logo[1]}</span></div>
        <button
          type="button" className="btn play" data-active={playing} aria-pressed={playing}
          onClick={() => controller.togglePlay()}
          title={hostBpm !== null ? "The DAW's transport is playing" : undefined}
        >
          <span aria-hidden="true">{playing ? "■" : "▶"}</span>
          <span className="lbl">{playing ? "STOP" : "PLAY"}</span>
        </button>
        <button
          type="button" className="btn rec" data-active={rec} aria-pressed={rec} aria-label="Record notes"
          title="Record notes played on the keyboard onto the steps while playing"
          onClick={() => setState({ rec: !rec })}
        >
          <span className="rec-dot" aria-hidden="true" />
          <span className="lbl">REC</span>
        </button>
        <Stepper
          label="BPM" ariaLabel="Tempo" value={bpm.toFixed(1)} onNudge={nudge}
          decLabel="Slower" incLabel="Faster" decDisabled={hostBpm !== null} incDisabled={hostBpm !== null}
        />
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
