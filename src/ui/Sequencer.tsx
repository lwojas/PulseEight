// The sequencer surface: page selector, the 8-lane overview, the focused track's big pads and the
// step editor (accent / slide / note keys).
import { memo, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import {
  clearTrack, holdStep, randomize, setLength, setOctave, setStepGate, setStepNote, tapStep, toggleMute, toggleSolo, toggleStepFlag,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { flashKey, registerKey } from "../engine/keyhl";
import { PUNCHES } from "../engine/mangler";
import { isChromatic, notesInRange, rootAtOrAbove, rootAtOrBelow, type ProjectScale } from "../engine/scale";
import { noteName, TRACKS } from "../engine/spec";
import { DEFAULT_GATE, FX_LANES, GATE_BUTTONS, GATES, LENGTHS, PAGE } from "../engine/state";
import { getState, setState, useStore } from "../engine/store";
import { ArpControl } from "./ArpControl";
import { usePress } from "./controls";
import { Modal } from "./Modal";
import { usePlayheadCell, usePlayheadEffect } from "./usePlayhead";
import { useMedia, WIDE } from "./useMedia";

const accentStyle = (track: number): CSSProperties => ({ "--acc": `var(${TRACKS[track].accent})` }) as CSSProperties;
const pad2 = (n: number) => String(n).padStart(2, "0");

// --- page selector -----------------------------------------------------------------------------

function PageButton({ index }: { index: number }) {
  const length = useStore((s) => s.patterns[s.pattern].length);
  const active = useStore((s) => s.page === index);
  // Progress through this page: one compositor-driven linear animation per step (no per-frame JS),
  // sweeping from the step's start to its end over the step duration.
  const bar = useRef<HTMLElement>(null);
  const anim = useRef<Animation | null>(null);
  usePlayheadEffect((v) => {
    const el = bar.current;
    if (!el) return;
    anim.current?.cancel();
    anim.current = null;
    const here = v >= 0 && Math.floor(v / PAGE) === index;
    el.style.opacity = here ? "1" : "0";
    if (!here) return;
    const pos = v % PAGE;
    const from = `scaleX(${pos / PAGE})`;
    const to = `scaleX(${(pos + 1) / PAGE})`;
    el.style.transform = to;
    anim.current = el.animate([{ transform: from }, { transform: to }], {
      duration: (15 / getState().bpm) * 1000,
      easing: "linear",
      fill: "forwards",
    });
  });
  const inside = index * PAGE < length;
  return (
    <button
      type="button"
      className="page-btn"
      data-active={active}
      data-outside={!inside}
      aria-pressed={active}
      aria-label={`Steps ${index * PAGE + 1} to ${index * PAGE + PAGE}${inside ? "" : " (extends the pattern)"}`}
      onClick={() => {
        if (!inside) setLength((index + 1) * PAGE);
        setState({ page: index });
      }}
    >
      {index * PAGE + 1}-{index * PAGE + PAGE}
      <i ref={bar} className="page-progress" />
    </button>
  );
}

export function PageBar() {
  const length = useStore((s) => s.patterns[s.pattern].length);
  const follow = useStore((s) => s.follow);
  return (
    <div className="pagebar">
      <div className="pages" role="group" aria-label="Step page">
        {[0, 1, 2, 3].map((i) => <PageButton key={i} index={i} />)}
      </div>
      <button
        type="button" className="chip" aria-label={`Pattern length ${length} steps, tap to change`}
        onClick={() => setLength(LENGTHS[(LENGTHS.indexOf(length as (typeof LENGTHS)[number]) + 1) % LENGTHS.length], getState().page)}
      >
        LEN {length}
      </button>
      <button type="button" className="chip" data-active={follow} aria-pressed={follow} onClick={() => setState({ follow: !follow })}>
        FOLLOW
      </button>
    </div>
  );
}

// --- fx lanes (written punch-ins: up to three, layered) ------------------------------------------

function FxCell({ lane, abs }: { lane: number; abs: number }) {
  const id = useStore((s) => s.patterns[s.pattern].fxLanes[lane].fx[abs]);
  const lvl = useStore((s) => s.patterns[s.pattern].fxLanes[lane].fxLvl[abs]);
  const playRef = usePlayheadCell(abs);
  const name = id ? PUNCHES.find((p) => p.id === id)?.label : "";
  return (
    <button
      type="button"
      className="cell fx-cell"
      ref={playRef}
      data-on={id !== 0}
      data-beat={abs % 4 === 0}
      style={id ? ({ "--lvl": lvl.toFixed(2) } as CSSProperties) : undefined}
      aria-label={id ? `FX${lane + 1}: ${name} at ${Math.round(lvl * 100)}% on step ${abs + 1}, tap to clear` : `FX${lane + 1}: no FX on step ${abs + 1}`}
      onClick={() => id && controller.clearFxStep(lane, abs)}
    >
      <span className="pad-num">{pad2(abs + 1)}</span>
      <span className="fx-cell-name">{name}</span>
      <span className="fx-cell-lvl">{id ? `${Math.round(lvl * 100)}%` : ""}</span>
    </button>
  );
}

/** One FX lane, laid out like the step pads: 16 steps a page, tap a filled cell to clear it. */
function FxLane({ lane }: { lane: number }) {
  const page = useStore((s) => s.page);
  return (
    <div className="fx-lane">
      <div className="fx-lane-cells" role="group" aria-label={`FX${lane + 1} steps`}>
        {Array.from({ length: PAGE }, (_, i) => <FxCell key={i} lane={lane} abs={page * PAGE + i} />)}
      </div>
      <div className="fx-lane-foot">
        <span className="silk">FX{lane + 1} · TAP A STEP TO CLEAR · WRITE + HOLD A PAD TO RECORD</span>
        <ConfirmButton label="CLR LANE" onConfirm={() => controller.clearFxLane(lane)} />
      </div>
    </div>
  );
}

function SeqViewTabs() {
  const view = useStore((s) => s.seqView);
  // a bitmask, not an array: the selector must return a stable value
  const usedMask = useStore((s) => s.patterns[s.pattern].fxLanes.reduce((m, l, i) => (l.fx.some((id) => id !== 0) ? m | (1 << i) : m), 0));
  return (
    <div className="seq-views" role="tablist" aria-label="Sequencer view">
      <button type="button" role="tab" className="chip" aria-selected={view === "steps"} data-active={view === "steps"} onClick={() => setState({ seqView: "steps" })}>
        STEPS
      </button>
      {Array.from({ length: FX_LANES }, (_, i) => (
        <button
          key={i} type="button" role="tab" className="chip" data-used={(usedMask & (1 << i)) !== 0}
          aria-selected={view === i} data-active={view === i} onClick={() => setState({ seqView: i })}
        >
          FX{i + 1}
        </button>
      ))}
    </div>
  );
}

// --- track rail: select / mute / solo ---------------------------------------------------------------

function RailItem({ track }: { track: number }) {
  const spec = TRACKS[track];
  const focused = useStore((s) => s.focus === track);
  const muted = useStore((s) => s.mutes[track]);
  const solo = useStore((s) => s.solos[track]);
  const dim = useStore((s) => (s.solos.some(Boolean) ? !s.solos[track] : s.mutes[track]));
  return (
    <div className="rail-item" style={accentStyle(track)} data-focus={focused} data-dim={dim}>
      <button
        type="button" className="rail-main" aria-pressed={focused} aria-label={`Select ${spec.name}`}
        onClick={() => {
          setState({ focus: track, selStep: -1 });
          if (!getState().playing) controller.audition(track);
        }}
      >
        <span className="rail-no">{track + 1}</span>
        <span className="rail-name">
          <b className="long">{spec.name}</b>
          <b className="short">{spec.short}</b>
          <small>{spec.engine}</small>
        </span>
      </button>
      <span className="rail-ms">
        <button type="button" className="btn sm" data-active={muted} aria-pressed={muted} aria-label={`Mute ${spec.name}`} onClick={() => toggleMute(track)}>M</button>
        <button type="button" className="btn sm solo" data-active={solo} aria-pressed={solo} aria-label={`Solo ${spec.name}`} onClick={() => toggleSolo(track)}>S</button>
      </span>
    </div>
  );
}

function TrackRail() {
  return (
    <div className="rail" role="group" aria-label="Tracks">
      {TRACKS.map((t) => <RailItem key={t.id} track={t.id} />)}
    </div>
  );
}

// --- step pad ------------------------------------------------------------------------------------------

interface PadProps {
  track: number;
  abs: number;
  on: boolean;
  acc: boolean;
  slide: boolean;
  selected: boolean;
  note?: string;
}

/** One step. Tap toggles/selects, hold accents/selects. The playhead lights it via data-play (see playhead.ts). */
const Pad = memo(function Pad({ track, abs, on, acc, slide, selected, note }: PadProps) {
  const press = usePress(() => tapStep(track, abs), () => holdStep(track, abs));
  const playRef = usePlayheadCell(abs);
  return (
    <button
      type="button"
      className="pad"
      data-on={on}
      data-acc={acc}
      data-slide={slide}
      data-sel={selected}
      data-beat={abs % 4 === 0}
      aria-pressed={on}
      ref={playRef}
      aria-label={`${TRACKS[track].name} step ${abs + 1}${on ? (note ? ` ${note}` : "") : " off"}${acc ? " accent" : ""}${slide ? " slide" : ""}`}
      {...press}
    >
      <span className="pad-num">{pad2(abs + 1)}</span>
      <span className="pad-main">{on ? note ?? (acc ? "●●" : "●") : "--"}</span>
      <span className="pad-tags">
        {on && acc && <i>ACC</i>}
        {on && slide && <i className="slide">SLD</i>}
      </span>
    </button>
  );
});

function Pads({ track }: { track: number }) {
  const page = useStore((s) => s.page);
  const tp = useStore((s) => s.patterns[s.pattern].tracks[track]);
  const selStep = useStore((s) => (s.focus === track ? s.selStep : -1));
  const spec = TRACKS[track];
  const melodic = spec.role !== "drum";
  return (
    <div className="pads" style={accentStyle(track)} role="group" aria-label={`${spec.name} steps`}>
      {Array.from({ length: PAGE }, (_, i) => {
        const abs = page * PAGE + i;
        const s = tp.steps[abs];
        return (
          <Pad
            key={i} track={track} abs={abs} on={s.on} acc={s.acc} slide={s.slide} selected={selStep === abs}
            note={melodic && s.on ? noteName(s.note + 12 * tp.oct) : undefined}
          />
        );
      })}
    </div>
  );
}

// --- the focused track: header, steps, keyboard ---------------------------------------------------

/** Gate length of the selected step: how long its note is held. Disabled until a step is selected.
 * Inline buttons on wide screens; on a phone a GATE button opens them in a modal. */
function GateControl({ track }: { track: number }) {
  const selStep = useStore((s) => (s.focus === track ? s.selStep : -1));
  const gate = useStore((s) => (s.selStep >= 0 && s.focus === track ? s.patterns[s.pattern].tracks[track].steps[s.selStep].gate ?? DEFAULT_GATE : -1));
  const phone = useMedia("(max-width: 699px)");
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const buttons = (
    <span className="step-gate" role="group" aria-label="Gate length">
      {!phone && <span className="silk">GATE</span>}
      {GATE_BUTTONS.map((i) => (
        <button
          key={GATES[i].label} type="button" className="btn sm" disabled={selStep < 0} data-active={gate === i} aria-pressed={gate === i}
          aria-label={`${GATES[i].name} gate`} title={GATES[i].name} onClick={() => setStepGate(track, selStep, gate === i ? DEFAULT_GATE : i)}
        >
          {GATES[i].label}
        </button>
      ))}
    </span>
  );
  if (!phone) return buttons;
  return (
    <>
      <button ref={btn} type="button" className="btn sm" disabled={selStep < 0} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        GATE
      </button>
      <Modal open={open} title="Gate length" onClose={() => setOpen(false)} className="gate-modal">
        {buttons}
      </Modal>
    </>
  );
}

function TrackHeader({ track }: { track: number }) {
  const spec = TRACKS[track];
  const melodic = spec.role !== "drum";
  const preset = useStore((s) => s.patterns[s.pattern].tracks[track].preset);
  return (
    <div className="track-head" style={accentStyle(track)}>
      <div className="track-id">
        <span className="track-no">T{track + 1}</span>
        <strong>{spec.name}</strong>
        <span className="silk">{preset || spec.engine}</span>
      </div>
      <div className="track-btns">
        {melodic && <GateControl track={track} />}
        <button type="button" className="btn sm" onClick={() => randomize(track)}>RND</button>
        <ConfirmButton label="CLR" onConfirm={() => clearTrack(track)} />
      </div>
    </div>
  );
}

/** A destructive button that needs a second tap within two seconds. */
export function ConfirmButton({ label, onConfirm, className = "btn sm" }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // one pending disarm at a time, and none after unmount (a stale one would cut a later arming short)
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      data-armed={armed}
      onClick={() => {
        window.clearTimeout(timer.current);
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 2000);
        }
      }}
    >
      {armed ? "SURE?" : label}
    </button>
  );
}

// --- keyboard ------------------------------------------------------------------------------------------

const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = new Set([0, 1, 3, 4, 5]); // a black key follows these white keys (C D F G A)

function OctaveControl({ track }: { track: number }) {
  const oct = useStore((s) => s.patterns[s.pattern].tracks[track].oct);
  return (
    <span className="oct">
      <span className="silk">OCT</span>
      <button type="button" className="btn sm" onClick={() => setOctave(track, oct - 1)} aria-label="Octave down">−</button>
      <b>{oct > 0 ? `+${oct}` : oct}</b>
      <button type="button" className="btn sm" onClick={() => setOctave(track, oct + 1)} aria-label="Octave up">+</button>
    </span>
  );
}

/** What a key does when pressed. With the arp on and no step selected, keys are *held* (pointer down
 * to up) and feed the arp; otherwise a press is a single tap, as before. */
function useKeyPress(track: number, step: number, press: (n: number) => void) {
  const arpOn = useStore((s) => s.arp[track].on);
  return (n: number) => {
    if (!arpOn || step >= 0) return { onClick: () => press(n) };
    const down = () => controller.arpDown(track, n);
    const up = () => controller.arpUp(track, n);
    return {
      onPointerDown: (e: { button: number }) => e.button === 0 && down(),
      onPointerUp: up, onPointerLeave: up, onPointerCancel: up,
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    };
  };
}

/** A piano key; the keyhl module lights it directly (no re-render) when its note sounds. */
function PianoKey({ track, note, ...rest }: { track: number; note: number } & ButtonHTMLAttributes<HTMLButtonElement> & { "data-on"?: boolean; "data-c"?: boolean }) {
  const off = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      off.current?.();
      off.current = el ? registerKey(track, note, el) : undefined;
    },
    [track, note],
  );
  return <button ref={ref} type="button" data-track={track} {...rest} />;
}

/** The window of the keyboard on screen (two octaves wide, one on phones), kept on the selected note,
 * and what the shift arrows move between. Chromatic windows start on a C, scale windows on the root. */
function useKeyWindow(track: number, step: number, scale: ProjectScale) {
  const spec = TRACKS[track];
  const wide = useMedia(WIDE);
  const octaves = wide ? 2 : 1;
  const span = octaves * 12;
  const note = useStore((s) => (step >= 0 ? s.patterns[s.pattern].tracks[track].steps[step].note : -1));
  const oct = useStore((s) => s.patterns[s.pattern].tracks[track].oct);
  const lo = spec.noteLo ?? 24;
  const hi = spec.noteHi ?? 59;
  const chromatic = isChromatic(scale);
  const floorTo = (n: number) => (chromatic ? Math.floor(n / 12) * 12 : rootAtOrBelow(scale, n));
  const minBase = chromatic ? Math.floor(lo / 12) * 12 : rootAtOrAbove(scale, lo);
  const maxBase = Math.max(minBase, floorTo(hi) - (octaves - 1) * 12);
  const clamp = (n: number) => Math.min(maxBase, Math.max(minBase, n));
  const [base, setBase] = useState(() => clamp(floorTo(spec.defaultNote ?? lo)));
  // keep the selected note on screen
  useEffect(() => {
    if (note >= 0 && (note < base || note > base + span)) setBase(clamp(floorTo(note)));
  }, [note, base, span, minBase, maxBase, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  return { wide, span, note, oct, lo, hi, chromatic, view: clamp(base), minBase, maxBase, setBase };
}

/** Playable keys. With a step selected a key writes that step's note; without one it just plays the
 * instrument. Chromatic scale: a piano. Any other: only the scale's notes, root first, as one flat row. */
function Keys({ track, step, scale }: { track: number; step: number; scale: ProjectScale }) {
  const { wide, span, note, oct, lo, hi, chromatic, view, minBase, maxBase, setBase } = useKeyWindow(track, step, scale);

  const press = (n: number) => {
    if (n < lo || n > hi) return;
    flashKey(track, n);
    if (step >= 0) setStepNote(track, step, n);
    else controller.audition(track, n);
  };
  const label = (n: number) => noteName(n + 12 * oct);
  const keyProps = useKeyPress(track, step, press);

  let columns: number;
  let keys: ReactNode;
  if (chromatic) {
    const whites: number[] = [];
    for (let o = 0; o < span / 12; o++) for (const w of WHITE_SEMIS) whites.push(view + o * 12 + w);
    whites.push(view + span);
    const blacks = whites.slice(0, -1).flatMap((n, i) => (BLACK_AFTER.has(i % 7) ? [{ n: n + 1, i }] : []));
    columns = whites.length;
    keys = (
      <>
        {whites.map((n, i) => (
          <PianoKey
            key={n} track={track} note={n} className="key white" data-on={note === n} data-c={n % 12 === 0}
            style={{ gridColumn: i + 1 }} aria-label={label(n)} {...keyProps(n)}
          >
            {n % 12 === 0 || !wide ? label(n) : ""}
          </PianoKey>
        ))}
        {blacks.map(({ n, i }) => (
          <PianoKey
            key={n} track={track} note={n} className="key black" data-on={note === n}
            style={{ left: `${((i + 1) / columns) * 100}%`, width: `${(0.6 / columns) * 100}%` }}
            aria-label={label(n)} {...keyProps(n)}
          />
        ))}
      </>
    );
  } else {
    const inScale = notesInRange(scale, view, view + span).filter((n) => n >= lo && n <= hi);
    columns = Math.max(1, inScale.length);
    keys = inScale.map((n) => (
      <PianoKey
        key={n} track={track} note={n} className="key white" data-on={note === n} data-c={(n - scale.root) % 12 === 0}
        aria-label={label(n)} {...keyProps(n)}
      >
        {label(n)}
      </PianoKey>
    ));
  }

  return (
    <div className="keys-wrap">
      <button type="button" className="btn sm key-shift" aria-label="Keys down an octave" disabled={view <= minBase} onClick={() => setBase(view - 12)}>◀</button>
      <div
        className={chromatic ? "keys" : "keys scale-keys"} role="group" aria-label={chromatic ? "Note keys" : "Scale note keys"}
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {keys}
      </div>
      <button type="button" className="btn sm key-shift" aria-label="Keys up an octave" disabled={view >= maxBase} onClick={() => setBase(view + 12)}>▶</button>
    </div>
  );
}

function StepEditor({ track }: { track: number }) {
  const spec = TRACKS[track];
  const selStep = useStore((s) => (s.focus === track ? s.selStep : -1));
  const step = useStore((s) => (s.selStep >= 0 && s.focus === track ? s.patterns[s.pattern].tracks[track].steps[s.selStep] : null));
  const scale = useStore((s) => s.scale);
  if (spec.role === "drum") {
    return (
      <div className="step-editor hint" style={accentStyle(track)}>
        <span className="silk">TAP A STEP TO TOGGLE · HOLD FOR ACCENT</span>
      </div>
    );
  }
  return (
    <div className="step-editor" style={accentStyle(track)}>
      <div className="step-editor-top">
        {step ? (
          <>
            <button type="button" className="btn sm" data-active={step.acc} aria-pressed={step.acc} onClick={() => toggleStepFlag(track, selStep, "acc")}>ACCENT</button>
            <button type="button" className="btn sm" data-active={step.slide} aria-pressed={step.slide} onClick={() => toggleStepFlag(track, selStep, "slide")}>SLIDE</button>
          </>
        ) : (
          <span className="silk">PLAY THE KEYS · TAP A STEP TO ENTER NOTES</span>
        )}
        <span className="step-editor-tools">
          <ArpControl track={track} />
          <OctaveControl track={track} />
        </span>
      </div>
      <Keys key={isChromatic(scale) ? "chromatic" : `${scale.root}-${scale.scale}`} track={track} step={selStep} scale={scale} />
    </div>
  );
}

export function SequencerPanel() {
  const track = useStore((s) => s.focus);
  const view = useStore((s) => s.seqView);
  return (
    <>
      <PageBar />
      <div className="seq-body" style={accentStyle(track)}>
        <TrackRail />
        <div className="stage" data-drum={TRACKS[track].role === "drum"}>
          <SeqViewTabs />
          {view === "steps" ? (
            <>
              <TrackHeader track={track} />
              <Pads track={track} />
              <StepEditor track={track} />
            </>
          ) : (
            <FxLane lane={view} />
          )}
        </div>
      </div>
    </>
  );
}
