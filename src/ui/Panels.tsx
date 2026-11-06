// Sound, mixer, FX mangler and pattern panels.
import { useRef, useState, type CSSProperties } from "react";
import {
  clearChain, clearPattern, clearStepLocks, moveChainEntry, selectChainEntry, setChainLabel, setChainRepeats, loadKit, loadSynthPreset, removeChainEntry, setDelay, setLevel, setLockable, setPlockMode, setPunchMacro, setPunchParam,
  setPunchSend, setReverb, setSoundControl, setSweep, toggleMute, toggleSolo,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { macrosOf, PING_PONG, PING_PONG_NOW_STEPS, punchById, PUNCHES, SWEEPS } from "../engine/mangler";
import { hasLocks, lockStep, soundParam } from "../engine/plock";
import { KITS, presetsFor } from "../engine/presets";
import { defaultSound, hasDistortion, formatControl, TRACKS, unitsToNorm } from "../engine/spec";
import { passAt, passCount } from "../engine/song";
import { BANK_SIZE, defaultLevel, levelOf, MAX_CHAIN, MAX_LABEL, MAX_PASSES, muteOf, NUM_PATTERNS, soloOf } from "../engine/state";
import { BEAT_DIVISIONS, BEAT_ORDER, beatPosition, defaultDelaySend, defaultReverbSend, DELAY_MODES, formatDist, formatFreeDelay } from "../engine/trackfx";
import { getState, setState, useStore } from "../engine/store";
import { Knob, Slider } from "./controls";
import { LfoButton, PunchLfoButton } from "./LfoModal";
import { SidechainButton } from "./SidechainModal";
import { PHONE, useMedia } from "./useMedia";
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

/** A synth's distortion insert (synth ▶ distortion ▶ fader): one amount, lockable like the knobs. Under the knobs, on every layout. */
function DistortionBar({ track, locks }: { track: number; locks: Record<string, number> | undefined }) {
  const base = useStore((s) => s.patterns[s.pattern].tracks[track].dist ?? 0);
  const dist = locks?.["fx.distortion"] ?? base;
  return (
    <div className="dist-bar" role="group" aria-label="Distortion">
      <Slider label="DIST" value={dist} def={0} readout={formatDist(dist)} locked={locks?.["fx.distortion"] !== undefined} onChange={(v) => setLockable(track, "fx.distortion", v)} />
    </div>
  );
}

/** TWEAK mode toggle and CLR STEP (the selected step's locks), under the instrument knobs. */
function PlockBar({ track }: { track: number }) {
  const phone = useMedia(PHONE);
  const on = useStore((s) => s.plock);
  const selStep = useStore((s) => s.selStep);
  const locked = useStore((s) => s.plock && s.selStep >= 0 && hasLocks(s.patterns[s.pattern].tracks[track].steps[s.selStep]));
  return (
    <div className="plock-bar" role="group" aria-label="Step tweaks">
      <button type="button" className="btn sm" data-active={on} aria-pressed={on} onClick={() => setPlockMode(!on)}>TWEAK</button>
      <button type="button" className="btn sm" disabled={!locked} aria-label="Clear the selected step's tweaks" onClick={() => clearStepLocks(track, selStep)}>{phone ? "CLR" : "CLR STEP"}</button>
    </div>
  );
}

export function SoundPanel() {
  const track = useStore((s) => s.focus);
  const baseSound = useStore((s) => s.patterns[s.pattern].tracks[track].sound);
  // In TWEAK mode the knobs show the selected step: its locks over the base. Neither is changed by looking.
  const locks = useStore((s) => lockStep(s, track)?.parameterLocks);
  const plock = useStore((s) => s.plock);
  const sound = baseSound.map((v, i) => locks?.[soundParam(track, i).id] ?? v);
  const playing = useStore((s) => s.playing);
  const baseDly = useStore((s) => s.patterns[s.pattern].tracks[track].dly.send);
  const baseRev = useStore((s) => s.patterns[s.pattern].tracks[track].rev.send);
  const dlySend = locks?.["fx.delaySend"] ?? baseDly;
  const revSend = locks?.["fx.reverbSend"] ?? baseRev;
  const punchSend = useStore((s) => s.patterns[s.pattern].tracks[track].punch !== false);
  const spec = TRACKS[track];
  const defaults = defaultSound(spec);
  return (
    <div className="sound" style={accentStyle(track)} data-plock={plock}>
      <TrackStrip />
      <header className="panel-title">
        <span className="dot" />
        <h2>{spec.name}</h2>
        <span className="silk">{spec.engine}</span>
      </header>
      <PresetChips track={track} />
      <div className="sound-main">
      <div className="knobs" style={{ "--n": spec.controls.length } as CSSProperties}>
        {spec.controls.map((c, i) => (
          <Knob
            key={`${track}-${c.key}`}
            label={c.label}
            value={sound[i]}
            def={defaults[i] ?? unitsToNorm(c, c.def)}
            steps={c.steps?.length}
            readout={formatControl(c, sound[i])}
            locked={locks?.[soundParam(track, i).id] !== undefined}
            onChange={(v) => setSoundControl(track, i, v)}
            onTouch={() => { if (!playing && !plock) controller.audition(track); }}
          />
        ))}
      </div>
      {hasDistortion(track) && <DistortionBar track={track} locks={locks} />}
      </div>
      <div className="plock-row">
        <PlockBar track={track} />
        <div className="lfo-btn fx-btns">
          <LfoButton track={track} />
          <SidechainButton track={track} />
        </div>
      </div>
      <div className="sends" role="group" aria-label="FX sends">
        <span className="silk">SENDS</span>
        <div className="knobs sends-knobs">
          <Knob
            label="DLY" value={dlySend} def={defaultDelaySend(track)} accent="var(--fx)" locked={locks?.["fx.delaySend"] !== undefined}
            readout={`${Math.round(dlySend * 100)}%`} onChange={(v) => setLockable(track, "fx.delaySend", v)}
          />
          <Knob
            label="REV" value={revSend} def={defaultReverbSend(track)} accent="var(--fx)" locked={locks?.["fx.reverbSend"] !== undefined}
            readout={`${Math.round(revSend * 100)}%`} onChange={(v) => setLockable(track, "fx.reverbSend", v)}
          />
        </div>
        <button
          type="button" className="btn sm punch-send" data-active={punchSend} aria-pressed={punchSend}
          aria-label={`Send ${spec.name} to Punch FX`} onClick={() => setPunchSend(track, !punchSend)}
        >
          PUNCH FX
        </button>
      </div>
    </div>
  );
}

// --- mixer ---------------------------------------------------------------------------------------

function MixRow({ track }: { track: number }) {
  const spec = TRACKS[track];
  const level = useStore((s) => levelOf(s, s.patterns[s.pattern], track));
  const mute = useStore((s) => muteOf(s, s.patterns[s.pattern], track));
  const solo = useStore((s) => soloOf(s, s.patterns[s.pattern], track));
  const phone = useMedia(PHONE);
  return (
    <div className="mix-row" style={accentStyle(track)} data-dim={mute}>
      <button type="button" className="mix-name" onClick={() => setState({ focus: track, selStep: -1 })}>{spec.name}</button>
      <Slider label="LVL" vertical={phone} value={level} def={defaultLevel(track)} onChange={(v) => setLevel(track, v)} />
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
  const divN = BEAT_ORDER.length;
  return (
    <div className="trackfx" style={accentStyle(track)}>
      <header className="panel-title">
        <span className="dot" />
        <h2>TRACK FX</h2>
        <span className="silk">{spec.name} · DELAY / REVERB</span>
      </header>
      <div className="tfx-groups">
        <section className="tfx-group" aria-label="Delay send">
          <div className="tfx-head"><span className="silk">DELAY</span></div>
          <div className="knobs tfx-knobs" style={{ "--n": 1 } as CSSProperties}>
            {beat ? (
              <Knob
                key="beat" label="TIME" value={beatPosition(dly.div) / (divN - 1)} def={beatPosition(1) / (divN - 1)} steps={divN} accent="var(--fx)"
                readout={BEAT_DIVISIONS[dly.div].label} onChange={(v) => setDelay(track, { div: BEAT_ORDER[Math.round(v * (divN - 1))] })}
              />
            ) : (
              <Knob
                key="free" label="TIME" value={dly.time} def={0.5} accent="var(--fx)"
                readout={formatFreeDelay(dly.time)} onChange={(v) => setDelay(track, { time: v })}
              />
            )}
          </div>
          <div className="tfx-btns">
            <div className="seg" role="group" aria-label="Delay timing mode">
              {DELAY_MODES.map((m, i) => (
                <button key={m} type="button" className="chip" data-active={dly.mode === i} aria-pressed={dly.mode === i} onClick={() => setDelay(track, { mode: i as 0 | 1 })}>
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button" className="chip" data-active={!!dly.fb} aria-pressed={!!dly.fb} title="Long feedback: the echoes ring on"
              onClick={() => setDelay(track, { fb: dly.fb ? 0 : 1 })}
            >
              LONG
            </button>
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
          <div className="tfx-btns" aria-hidden="true" />
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
      onPointerUp={() => { if (getState().punch === id) controller.punchUp(); }}
      onPointerCancel={() => { if (getState().punch === id) controller.punchUp(); }}
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
        <span className="rec-dot" /> REC FX
      </button>
      <button
        type="button" className="btn erase" data-active={erase} aria-pressed={erase}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setState({ erase: true }); }}
        onPointerUp={() => setState({ erase: false })}
        onPointerCancel={() => setState({ erase: false })}
      >
        ERASE
      </button>
      <button type="button" className="btn swap-label" data-active={fxPlay} aria-pressed={fxPlay} aria-label="Play written FX" onClick={() => setState({ fxPlay: !fxPlay })}>
        <span data-show={fxPlay}>ON</span>
        <span data-show={!fxPlay}>OFF</span>
      </button>
      <ConfirmButton label="CLR FX" short="CLR" className="btn" onConfirm={() => controller.clearFxAll()} />
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
  const macros = macrosOf(m, def.id);
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
        {def.macros.map((mc, i) => (
          <Knob
            key={`${def.id}-${i}`} label={mc.label} value={macros[i]} def={mc.def} accent="var(--fx)"
            readout={`${Math.round(macros[i] * 100)}%`} onChange={(v) => setPunchMacro(def.id, i as 0 | 1, v)}
          />
        ))}
      </div>
      <div className="mangler-mid">
        <div className="chips" role="group" aria-label="Ramp time">
          <span className="silk">RAMP</span>
          {SWEEPS.map((w, i) => (
            <button key={w.label} type="button" className="chip" data-active={m.sweep === i} aria-pressed={m.sweep === i} onClick={() => setSweep(i)}>{w.label}</button>
          ))}
          <PunchLfoButton punchId={def.id} />
        </div>
        <WriteControls />
      </div>
      <div className="punch-grid" data-write={write}>
        {PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} />)}
      </div>
      <p className="hint silk">{write ? "REC FX ARMED · PLAY, THEN HOLD A PAD · THE MOVE IS RECORDED" : "HOLD A PAD TO PERFORM · ARM REC FX TO RECORD THE MOVE"}</p>
    </div>
  );
}

// --- patterns ------------------------------------------------------------------------------------

function Slot({ index }: { index: number }) {
  const active = useStore((s) => s.pattern === index);
  const playing = useStore((s) => s.playing && s.playPattern === index);
  const cued = useStore((s) => s.cue === index);
  const filled = useStore((s) => s.patterns[index].tracks.some((t) => t.steps.some((st) => st.on)));
  const chainIdx = useStore((s) => s.chain.findIndex((e) => e.pattern === index));
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
      <button type="button" className="btn sm" data-active={copyArm} aria-pressed={copyArm} onClick={() => setState({ copyArm: !copyArm, chainEdit: false, chainSel: -1 })}>
        {copyArm ? "TAP SLOT" : "COPY"}
      </button>
      <ConfirmButton label="CLR PTN" short="CLR" onConfirm={clearPattern} />
      {chainControls && (
        <>
          <span className="silk tools-label">CHAIN</span>
          <button type="button" className="btn sm" data-active={chainEdit} aria-pressed={chainEdit} onClick={() => setState({ chainEdit: !chainEdit, chainSel: -1, copyArm: false })}>
            {chainEdit ? "DONE" : "EDIT"}
          </button>
          <button type="button" className="btn sm" data-active={chainOn} aria-pressed={chainOn} disabled={chain.length === 0} onClick={() => setState({ chainOn: !chainOn })}>
            {chainOn ? "ON" : "OFF"}
          </button>
          <ConfirmButton label="CLR CHAIN" short="CLR" disabled={chain.length === 0} onConfirm={clearChain} />
        </>
      )}
    </div>
  );
}

/** One chain entry: its place, pattern, label and how many times it plays. The selected one also shows move and remove. */
function ChainRow({ index }: { index: number }) {
  const entry = useStore((s) => s.chain[index]);
  const selected = useStore((s) => s.chainSel === index);
  const last = useStore((s) => index === s.chain.length - 1);
  const edit = useStore((s) => s.chainEdit);
  // the repeat being played if it is in this entry, else -1 (a number, so the selector gives a stable value)
  const rep = useStore((s) => {
    const at = s.chainOn && s.playing ? passAt(s.chain, s.chainPos) : null;
    return at?.entry === index ? at.rep : -1;
  });
  // the chain plays this entry now, or (chain off) this entry's pattern is the one playing
  const heard = useStore((s) => s.playing && !s.chainOn && s.playPattern === s.chain[index]?.pattern);
  const now = rep >= 0;
  const live = now || heard;
  if (!entry) return null;
  const nn = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="chain-row" role="listitem" data-now={live} data-sel={selected}>
      <button type="button" className="chain-no" aria-pressed={selected} aria-label={`Chain entry ${index + 1}, pattern ${entry.pattern + 1}${live ? ", playing" : ""}${selected ? ", selected" : ", select to edit"}`} onClick={() => selectChainEntry(index)}>
        {live ? "▶" : nn(index + 1)}
      </button>
      <span className="chain-chip">{nn(entry.pattern + 1)}</span>
      <input
        className="chain-label" value={entry.label ?? ""} maxLength={MAX_LABEL} placeholder="—" autoComplete="off" spellCheck={false}
        aria-label={`Label of chain entry ${index + 1}`} onChange={(e) => setChainLabel(index, e.target.value)}
      />
      <div className="chain-rep" role="group" aria-label={`Repeats of chain entry ${index + 1}`}>
        <button type="button" aria-label="Fewer repeats" disabled={entry.repeats <= 1} onClick={() => setChainRepeats(index, entry.repeats - 1)}>−</button>
        <b>{now ? `${rep + 1}/${entry.repeats}` : `×${entry.repeats}`}</b>
        <button type="button" aria-label="More repeats" onClick={() => setChainRepeats(index, entry.repeats + 1)}>+</button>
      </div>
      {selected && (
        <div className="chain-acts">
          <button type="button" className="btn sm" aria-label="Move earlier" disabled={index === 0} onClick={() => moveChainEntry(index, -1)}>▲</button>
          <button type="button" className="btn sm" aria-label="Move later" disabled={last} onClick={() => moveChainEntry(index, 1)}>▼</button>
          <button type="button" className="btn sm" aria-label="Remove from chain" onClick={() => removeChainEntry(index)}>✕ REMOVE</button>
          {edit && <span className="silk chain-hint">TAP A SLOT TO SWAP</span>}
        </div>
      )}
    </div>
  );
}

function ChainChips() {
  const chain = useStore((s) => s.chain);
  const chainEdit = useStore((s) => s.chainEdit);
  const sel = useStore((s) => s.chainSel);
  const passes = passCount(chain);
  return (
    <div className="chain" role="list" aria-label={`Chain, ${chain.length} of ${MAX_CHAIN} entries, ${passes} passes`}>
      {chain.length === 0 && <span className="silk">{chainEdit ? "TAP SLOTS TO ADD" : "EDIT, THEN TAP SLOTS"}</span>}
      {chain.map((_, i) => <ChainRow key={i} index={i} />)}
      {chainEdit && chain.length > 0 && sel < 0 && <span className="silk chain-add">{passes >= MAX_PASSES ? "CHAIN FULL" : "+ TAP A SLOT TO ADD"}</span>}
    </div>
  );
}

/** The pattern tab on a phone lists this many patterns, and MORE the rest. */
const PHONE_PATTERNS = 32;

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Pattern tab on phones: all 64 patterns, the tools and the chain. */
export function PatternsPanel() {
  const playing = useStore((s) => s.playing);
  const [all, setAll] = useState(false);
  return (
    <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PATTERNS</h2>
        <span className="silk">{playing ? "TAP TO CUE" : "TAP TO SELECT"}</span>
      </header>
      <div className="slots">{range(0, all ? NUM_PATTERNS : PHONE_PATTERNS).map((i) => <Slot key={i} index={i} />)}</div>
      <button type="button" className="btn sm slots-more" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? "LESS" : `MORE · ${PHONE_PATTERNS + 1}–${NUM_PATTERNS}`}
      </button>
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
    setState({ chainEdit: false, chainSel: -1, copyArm: false });
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
