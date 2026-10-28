// Sound, mixer, FX mangler and pattern panels.
import { useRef, useState, type CSSProperties } from "react";
import {
  clearChain, clearPattern, loadKit, loadSynthPreset, removeChainEntry, setDelay, setLevel, setPunchParam, setReverb,
  setSound, setSweep, toggleMute, toggleSolo,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { PING_PONG, PING_PONG_NOW_STEPS, punchById, PUNCHES, SWEEPS } from "../engine/mangler";
import { KITS, presetsFor } from "../engine/presets";
import { defaultSound, formatControl, TRACKS, unitsToNorm } from "../engine/spec";
import { BANK_SIZE, DEFAULT_LEVELS, MAX_CHAIN, NUM_PATTERNS } from "../engine/state";
import { BEAT_DIVISIONS, DEFAULT_DELAY_SENDS, DEFAULT_REVERB_SENDS, DELAY_MODES, formatFreeDelay } from "../engine/trackfx";
import { setState, useStore } from "../engine/store";
import { Knob, Slider } from "./controls";
import { Modal } from "./Modal";
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
  const dlySend = useStore((s) => s.patterns[s.pattern].tracks[track].dly.send);
  const revSend = useStore((s) => s.patterns[s.pattern].tracks[track].rev.send);
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
      <div className="sends" role="group" aria-label="FX sends">
        <span className="silk">SENDS</span>
        <div className="knobs sends-knobs">
          <Knob
            label="DLY" value={dlySend} def={DEFAULT_DELAY_SENDS[track]} accent="var(--fx)"
            readout={`${Math.round(dlySend * 100)}%`} onChange={(v) => setDelay(track, { send: v })}
          />
          <Knob
            label="REV" value={revSend} def={DEFAULT_REVERB_SENDS[track]} accent="var(--fx)"
            readout={`${Math.round(revSend * 100)}%`} onChange={(v) => setReverb(track, { send: v })}
          />
        </div>
      </div>
    </div>
  );
}

// --- mixer ---------------------------------------------------------------------------------------

function MixRow({ track }: { track: number }) {
  const spec = TRACKS[track];
  const level = useStore((s) => s.patterns[s.pattern].tracks[track].level);
  const mute = useStore((s) => s.mutes[track]);
  const solo = useStore((s) => s.solos[track]);
  return (
    <div className="mix-row" style={accentStyle(track)} data-dim={mute}>
      <button type="button" className="mix-name" onClick={() => setState({ focus: track, selStep: -1 })}>{spec.name}</button>
      <Slider label="LVL" value={level} def={DEFAULT_LEVELS[track]} onChange={(v) => setLevel(track, v)} />
      <span className="mix-ms">
        <button type="button" className="btn sm" data-active={mute} aria-pressed={mute} aria-label={`Mute ${spec.name}`} onClick={() => toggleMute(track)}>M</button>
        <button type="button" className="btn sm solo" data-active={solo} aria-pressed={solo} aria-label={`Solo ${spec.name}`} onClick={() => toggleSolo(track)}>S</button>
      </span>
    </div>
  );
}

export function MixerPanel() {
  return (
    <div className="mixer">
      <header className="panel-title">
        <span className="dot" />
        <h2>MIXER</h2>
        <span className="silk">LEVEL · MUTE · SOLO</span>
      </header>
      {TRACKS.map((t) => <MixRow key={t.id} track={t.id} />)}
    </div>
  );
}

// --- track FX: delay time/mode + reverb size (the sends live in the sound panel) ------------------------------------------------------

export function TrackFxPanel() {
  const track = useStore((s) => s.focus);
  const dly = useStore((s) => s.patterns[s.pattern].tracks[track].dly);
  const rev = useStore((s) => s.patterns[s.pattern].tracks[track].rev);
  const spec = TRACKS[track];
  const beat = dly.mode === 1;
  const divN = BEAT_DIVISIONS.length;
  return (
    <div className="trackfx" style={accentStyle(track)}>
      <header className="panel-title">
        <span className="dot" />
        <h2>TRACK FX</h2>
        <span className="silk">{spec.name} · DELAY / REVERB</span>
      </header>
      <div className="tfx-groups">
        <section className="tfx-group" aria-label="Delay send">
          <div className="tfx-head">
            <span className="silk">DELAY</span>
            <div className="seg" role="group" aria-label="Delay timing mode">
              {DELAY_MODES.map((m, i) => (
                <button key={m} type="button" className="chip" data-active={dly.mode === i} aria-pressed={dly.mode === i} onClick={() => setDelay(track, { mode: i as 0 | 1 })}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="knobs tfx-knobs" style={{ "--n": 1 } as CSSProperties}>
            {beat ? (
              <Knob
                key="beat" label="TIME" value={dly.div / (divN - 1)} def={1 / (divN - 1)} steps={divN} accent="var(--fx)"
                readout={BEAT_DIVISIONS[dly.div].label} onChange={(v) => setDelay(track, { div: Math.round(v * (divN - 1)) })}
              />
            ) : (
              <Knob
                key="free" label="TIME" value={dly.time} def={0.5} accent="var(--fx)"
                readout={formatFreeDelay(dly.time)} onChange={(v) => setDelay(track, { time: v })}
              />
            )}
          </div>
        </section>
        <section className="tfx-group" aria-label="Reverb send">
          <div className="tfx-head"><span className="silk">REVERB</span></div>
          <div className="knobs tfx-knobs" style={{ "--n": 1 } as CSSProperties}>
            <Knob
              label="SIZE" value={rev.size} def={0.5} accent="var(--fx)"
              readout={`${Math.round(rev.size * 100)}%`} onChange={(v) => setReverb(track, { size: v })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// --- punch FX: performed, not mixed --------------------------------------------------------------

export function PunchPad({ id, compact }: { id: number; compact?: boolean }) {
  const def = PUNCHES.find((p) => p.id === id)!;
  const held = useStore((s) => s.punch === id);
  const pingPong = PING_PONG.has(id);
  const sweepSec = useStore(
    (s) => ((SWEEPS[s.patterns[s.pattern].mangler.sweep]?.steps ?? 0) || (pingPong ? PING_PONG_NOW_STEPS : 0)) * (15 / s.bpm),
  );
  const sel = useStore((s) => s.punchSel === id);
  return (
    <button
      type="button"
      className="punch"
      data-compact={compact}
      data-held={held}
      data-pingpong={pingPong || undefined}
      data-sel={sel}
      style={{ "--sweep": `${sweepSec.toFixed(3)}s` } as CSSProperties}
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
  const sel = useStore((s) => s.punchSel);
  const write = useStore((s) => s.write);
  const def = punchById(sel) ?? PUNCHES[0];
  const value = m.param[def.id] ?? def.param.def;
  return (
    <div className="mangler" style={{ "--acc": "var(--fx)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PUNCH FX</h2>
        <span className="silk">PERFORM · {def.label} · {def.hint}</span>
      </header>
      <div className="knobs mangler-knobs">
        <Knob
          key={def.id} label={def.param.label} value={value} def={def.param.def} steps={def.param.steps?.length} accent="var(--fx)"
          readout={def.param.format(value)} onChange={(v) => setPunchParam(def.id, v)}
        />
      </div>
      <div className="mangler-mid">
        <div className="chips" role="group" aria-label="Sweep time">
          <span className="silk">SWEEP IN</span>
          {SWEEPS.map((w, i) => (
            <button key={w.label} type="button" className="chip" data-active={m.sweep === i} aria-pressed={m.sweep === i} onClick={() => setSweep(i)}>{w.label}</button>
          ))}
        </div>
        <WriteControls />
      </div>
      <div className="punch-grid" data-write={write}>
        {PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} />)}
      </div>
      <p className="hint silk">{write ? "WRITE ARMED · PLAY, THEN HOLD A PAD · THE SWEEP IS RECORDED" : "HOLD A PAD TO PERFORM · ARM WRITE TO RECORD THE SWEEP"}</p>
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

function PatternTools({ chainControls = true }: { chainControls?: boolean }) {
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
      {chainControls && (
        <>
          <span className="silk tools-label">CHAIN</span>
          <button type="button" className="btn sm" data-active={chainEdit} aria-pressed={chainEdit} onClick={() => setState({ chainEdit: !chainEdit, copyArm: false })}>
            {chainEdit ? "DONE" : "EDIT"}
          </button>
          <button type="button" className="btn sm" data-active={chainOn} aria-pressed={chainOn} disabled={chain.length === 0} onClick={() => setState({ chainOn: !chainOn })}>
            {chainOn ? "ON" : "OFF"}
          </button>
          <button type="button" className="btn sm" onClick={clearChain} disabled={chain.length === 0} aria-label="Clear chain">CLR</button>
        </>
      )}
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
    <div className="chain" aria-label={`Chain, ${chain.length} of ${MAX_CHAIN}`}>
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

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Pattern tab on phones: all 64 patterns, the tools and the chain. */
export function PatternsPanel() {
  const playing = useStore((s) => s.playing);
  return (
    <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PATTERNS</h2>
        <span className="silk">{playing ? "TAP TO CUE" : "TAP TO SELECT"}</span>
      </header>
      <div className="slots">{range(0, NUM_PATTERNS).map((i) => <Slot key={i} index={i} />)}</div>
      <PatternTools />
      <ChainChips />
    </div>
  );
}

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
);

/** Pattern navigation on wide screens: one bank of 16 under the transport (the bank holding the
 * current pattern), and MORE for the full 64 and the chain. */
export function PatternBar() {
  const playing = useStore((s) => s.playing);
  const bank = useStore((s) => Math.floor(s.pattern / BANK_SIZE));
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setState({ chainEdit: false, copyArm: false });
  };
  return (
    <div className="patternbar" role="group" aria-label="Patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <span className="silk bar-label">{playing ? "PTN · CUE" : "PTN"}</span>
      <div className="slots">{range(bank * BANK_SIZE, BANK_SIZE).map((i) => <Slot key={i} index={i} />)}</div>
      <PatternTools chainControls={false} />
      <button ref={more} type="button" className="btn sm more" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        MORE {CHEVRON}
      </button>
      <Modal open={open} title="Patterns & chain" onClose={close} className="ptn-modal" anchor={{ to: more, placement: "bottom", offset: 6 }}>
        <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
          <div className="slots">{range(0, NUM_PATTERNS).map((i) => <Slot key={i} index={i} />)}</div>
          <PatternTools />
          <ChainChips />
        </div>
      </Modal>
    </div>
  );
}
