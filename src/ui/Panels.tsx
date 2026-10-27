// Sound, mixer, FX mangler and pattern panels.
import { type CSSProperties } from "react";
import {
  clearChain, clearPattern, loadKit, loadSynthPreset, removeChainEntry, setLevel, setMangler, setSend, setSound,
  toggleMute, toggleSolo,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { DUB_DIVISIONS, PUNCHES } from "../engine/mangler";
import { KITS, presetsFor } from "../engine/presets";
import { defaultSound, formatControl, TRACKS, unitsToNorm } from "../engine/spec";
import { DEFAULT_LEVELS, DEFAULT_SENDS } from "../engine/state";
import { setState, useStore } from "../engine/store";
import { Knob, Slider } from "./controls";
import { ConfirmButton } from "./Sequencer";

const accentStyle = (track: number): CSSProperties => ({ "--acc": `var(${TRACKS[track].accent})` }) as CSSProperties;

// --- sound -------------------------------------------------------------------------------------

function TrackStrip() {
  const focus = useStore((s) => s.focus);
  return (
    <div className="track-strip phone-only" role="tablist" aria-label="Track">
      {TRACKS.map((t) => (
        <button
          key={t.id} type="button" role="tab" aria-selected={focus === t.id} className="strip-btn" data-active={focus === t.id}
          style={accentStyle(t.id)} onClick={() => setState({ focus: t.id, selStep: -1 })}
        >
          {t.short}
        </button>
      ))}
    </div>
  );
}

function PresetChips({ track }: { track: number }) {
  const current = useStore((s) => s.patterns[s.pattern].tracks[track].preset);
  const spec = TRACKS[track];
  if (spec.role === "drum") {
    return (
      <div className="chips" role="group" aria-label="Drum kit">
        <span className="silk">KIT</span>
        {KITS.map((k, i) => (
          <button key={k.name} type="button" className="chip" data-active={current === k.name} onClick={() => loadKit(i)}>
            {k.name}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="chips" role="group" aria-label="Preset">
      <span className="silk">PRESET</span>
      {presetsFor(track).map((p, i) => (
        <button key={p.name} type="button" className="chip" data-active={current === p.name} onClick={() => loadSynthPreset(track, i)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function SoundPanel() {
  const track = useStore((s) => s.focus);
  const sound = useStore((s) => s.patterns[s.pattern].tracks[track].sound);
  const playing = useStore((s) => s.playing);
  const spec = TRACKS[track];
  const defaults = defaultSound(spec);
  return (
    <div className="sound" style={accentStyle(track)}>
      <TrackStrip />
      <header className="panel-title">
        <span className="dot" />
        <h2>{spec.name}</h2>
        <span className="silk">{spec.engine}</span>
      </header>
      <PresetChips track={track} />
      <div className="knobs" style={{ "--n": spec.controls.length } as CSSProperties}>
        {spec.controls.map((c, i) => (
          <Knob
            key={`${track}-${c.key}`}
            label={c.label}
            value={sound[i]}
            def={defaults[i] ?? unitsToNorm(c, c.def)}
            steps={c.steps?.length}
            readout={formatControl(c, sound[i])}
            onChange={(v) => setSound(track, i, v)}
            onTouch={() => { if (!playing) controller.audition(track); }}
          />
        ))}
      </div>
    </div>
  );
}

// --- mixer ---------------------------------------------------------------------------------------

function MixRow({ track }: { track: number }) {
  const spec = TRACKS[track];
  const level = useStore((s) => s.patterns[s.pattern].tracks[track].level);
  const send = useStore((s) => s.patterns[s.pattern].tracks[track].send);
  const mute = useStore((s) => s.mutes[track]);
  const solo = useStore((s) => s.solos[track]);
  return (
    <div className="mix-row" style={accentStyle(track)} data-dim={mute}>
      <button type="button" className="mix-name" onClick={() => setState({ focus: track, selStep: -1 })}>{spec.name}</button>
      <Slider label="LVL" value={level} def={DEFAULT_LEVELS[track]} onChange={(v) => setLevel(track, v)} />
      <Slider label="FX" value={send} def={DEFAULT_SENDS[track]} accent="var(--fx)" onChange={(v) => setSend(track, v)} />
      <button type="button" className="btn sm" data-active={mute} aria-pressed={mute} aria-label={`Mute ${spec.name}`} onClick={() => toggleMute(track)}>M</button>
      <button type="button" className="btn sm solo" data-active={solo} aria-pressed={solo} aria-label={`Solo ${spec.name}`} onClick={() => toggleSolo(track)}>S</button>
    </div>
  );
}

export function MixerPanel() {
  return (
    <div className="mixer">
      <header className="panel-title">
        <span className="dot" />
        <h2>MIXER</h2>
        <span className="silk">LEVEL · SEND TO FX MANGLER</span>
      </header>
      {TRACKS.map((t) => <MixRow key={t.id} track={t.id} />)}
    </div>
  );
}

// --- FX mangler ----------------------------------------------------------------------------------

export function PunchPad({ id, compact }: { id: number; compact?: boolean }) {
  const def = PUNCHES.find((p) => p.id === id)!;
  const held = useStore((s) => s.punch === id);
  return (
    <button
      type="button"
      className="punch"
      data-compact={compact}
      data-held={held}
      aria-pressed={held}
      aria-label={`${def.label}: ${def.hint}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        controller.punchDown(id);
      }}
      onPointerUp={() => { if (held) controller.punchUp(); }}
      onPointerCancel={() => { if (held) controller.punchUp(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <b>{def.label}</b>
      {!compact && <small>{def.hint}</small>}
    </button>
  );
}

export function WriteControls() {
  const write = useStore((s) => s.write);
  const fxPlay = useStore((s) => s.fxPlay);
  const erase = useStore((s) => s.erase);
  return (
    <div className="write-controls">
      <button type="button" className="btn write" data-active={write} aria-pressed={write} onClick={() => setState({ write: !write })}>
        <span className="rec-dot" /> WRITE
      </button>
      <button
        type="button" className="btn erase" data-active={erase} aria-pressed={erase}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setState({ erase: true }); }}
        onPointerUp={() => setState({ erase: false })}
        onPointerCancel={() => setState({ erase: false })}
      >
        ERASE
      </button>
      <button type="button" className="btn" data-active={fxPlay} aria-pressed={fxPlay} onClick={() => setState({ fxPlay: !fxPlay })}>
        FX ON
      </button>
      <ConfirmButton label="CLR" className="btn" onConfirm={() => controller.clearFxAll()} />
    </div>
  );
}

/** A compact punch row for the sequencer screen on small displays. */
export function PunchBar() {
  return (
    <div className="punchbar">
      <WriteControls />
      <div className="punch-row">{PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} compact />)}</div>
    </div>
  );
}

export function ManglerPanel() {
  const m = useStore((s) => s.patterns[s.pattern].mangler);
  const write = useStore((s) => s.write);
  return (
    <div className="mangler" style={{ "--acc": "var(--fx)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>FX MANGLER</h2>
        <span className="silk">SHARED RETURN · PUNCH-IN</span>
      </header>
      <div className="knobs mangler-knobs">
        <Knob label="ECHO" value={m.fb} def={0.5} readout={`${Math.round(m.fb * 100)}%`} onChange={(v) => setMangler({ fb: v })} />
        <Knob label="TONE" value={m.tone} def={0.55} readout={`${Math.round(m.tone * 100)}%`} onChange={(v) => setMangler({ tone: v })} />
        <Knob label="PUNCH AMT" value={m.amt} def={0.6} readout={`${Math.round(m.amt * 100)}%`} onChange={(v) => setMangler({ amt: v })} />
      </div>
      <div className="mangler-mid">
      <div className="chips" role="group" aria-label="Echo time">
        <span className="silk">ECHO TIME</span>
        {DUB_DIVISIONS.map((d, i) => (
          <button key={d.label} type="button" className="chip" data-active={m.div === i} onClick={() => setMangler({ div: i })}>{d.label}</button>
        ))}
      </div>
      <WriteControls />
      </div>
      <div className="punch-grid" data-write={write}>
        {PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} />)}
      </div>
      <p className="hint silk">{write ? "WRITE ARMED · PLAY, THEN HOLD A PAD TO PUNCH IT INTO THE PATTERN" : "HOLD A PAD TO PERFORM · ARM WRITE TO RECORD IT"}</p>
    </div>
  );
}

// --- patterns ------------------------------------------------------------------------------------

function Slot({ index }: { index: number }) {
  const active = useStore((s) => s.pattern === index);
  const playing = useStore((s) => s.playing && s.playPattern === index);
  const cued = useStore((s) => s.cue === index);
  const filled = useStore((s) => s.patterns[index].tracks.some((t) => t.steps.some((st) => st.on)));
  const chainIdx = useStore((s) => s.chain.indexOf(index));
  return (
    <button
      type="button" className="slot" data-active={active} data-playing={playing} data-cue={cued} data-filled={filled}
      aria-label={`Pattern ${index + 1}${filled ? "" : " (empty)"}`} aria-pressed={active}
      onClick={() => controller.selectPattern(index)}
    >
      {String(index + 1).padStart(2, "0")}
      {chainIdx >= 0 && <i className="slot-chain">{chainIdx + 1}</i>}
    </button>
  );
}

function PatternTools() {
  const chain = useStore((s) => s.chain);
  const chainOn = useStore((s) => s.chainOn);
  const chainEdit = useStore((s) => s.chainEdit);
  const copyArm = useStore((s) => s.copyArm);
  return (
    <div className="ptn-tools">
      <button type="button" className="btn sm" data-active={copyArm} aria-pressed={copyArm} onClick={() => setState({ copyArm: !copyArm, chainEdit: false })}>
        {copyArm ? "TAP SLOT" : "COPY"}
      </button>
      <ConfirmButton label="CLEAR" onConfirm={clearPattern} />
      <span className="silk tools-label">CHAIN</span>
      <button type="button" className="btn sm" data-active={chainEdit} aria-pressed={chainEdit} onClick={() => setState({ chainEdit: !chainEdit, copyArm: false })}>
        {chainEdit ? "DONE" : "EDIT"}
      </button>
      <button type="button" className="btn sm" data-active={chainOn} aria-pressed={chainOn} disabled={chain.length === 0} onClick={() => setState({ chainOn: !chainOn })}>
        {chainOn ? "ON" : "OFF"}
      </button>
      <button type="button" className="btn sm" onClick={clearChain} disabled={chain.length === 0} aria-label="Clear chain">CLR</button>
    </div>
  );
}

function ChainChips() {
  const chain = useStore((s) => s.chain);
  const chainOn = useStore((s) => s.chainOn);
  const chainEdit = useStore((s) => s.chainEdit);
  const chainPos = useStore((s) => s.chainPos);
  const playing = useStore((s) => s.playing);
  return (
    <div className="chain" aria-label="Chain">
      {chain.length === 0 && <span className="silk">{chainEdit ? "TAP SLOTS TO ADD" : "EDIT, THEN TAP SLOTS"}</span>}
      {chain.map((p, i) => (
        <button
          key={i} type="button" className="chain-chip" data-now={chainOn && playing && chainPos === i}
          aria-label={`Chain position ${i + 1}: pattern ${p + 1}, tap to remove`} onClick={() => removeChainEntry(i)}
        >
          {String(p + 1).padStart(2, "0")}
        </button>
      ))}
    </div>
  );
}

/** Pattern tab on phones. */
export function PatternsPanel() {
  const playing = useStore((s) => s.playing);
  return (
    <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PATTERNS</h2>
        <span className="silk">{playing ? "TAP TO CUE" : "TAP TO SELECT"}</span>
      </header>
      <div className="slots">{Array.from({ length: 16 }, (_, i) => <Slot key={i} index={i} />)}</div>
      <PatternTools />
      <ChainChips />
    </div>
  );
}

/** Pattern navigation on wide screens: a single row under the transport. */
export function PatternBar() {
  const playing = useStore((s) => s.playing);
  return (
    <div className="patternbar" role="group" aria-label="Patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <span className="silk bar-label">{playing ? "PTN · CUE" : "PTN"}</span>
      <div className="slots">{Array.from({ length: 16 }, (_, i) => <Slot key={i} index={i} />)}</div>
      <PatternTools />
      <ChainChips />
    </div>
  );
}
