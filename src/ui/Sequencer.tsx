// The sequencer surface: page selector, the 8-lane overview, the focused track's big pads and the
// step editor (accent / slide / note keys).
import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  clearTrack, holdStep, randomize, setLength, setOctave, setStepNote, tapStep, toggleMute, toggleSolo, toggleStepFlag,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { PUNCHES } from "../engine/mangler";
import { noteName, TRACKS } from "../engine/spec";
import { LENGTHS, PAGE } from "../engine/state";
import { setState, useStore } from "../engine/store";
import { usePress } from "./controls";
import { usePlayheadCell, usePlayheadEffect } from "./usePlayhead";

const accentStyle = (track: number): CSSProperties => ({ "--acc": `var(${TRACKS[track].accent})` }) as CSSProperties;
const pad2 = (n: number) => String(n).padStart(2, "0");

// --- page selector -----------------------------------------------------------------------------

function PageButton({ index }: { index: number }) {
  const length = useStore((s) => s.patterns[s.pattern].length);
  const active = useStore((s) => s.page === index);
  // Progress through this page: transform/opacity only, written straight to the element.
  const bar = useRef<HTMLElement>(null);
  usePlayheadEffect((v) => {
    const el = bar.current;
    if (!el) return;
    const here = v >= 0 && Math.floor(v / PAGE) === index;
    el.style.opacity = here ? "1" : "0";
    if (here) el.style.transform = `scaleX(${((v % PAGE) + 1) / PAGE})`;
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
        onClick={() => setLength(LENGTHS[(LENGTHS.indexOf(length as (typeof LENGTHS)[number]) + 1) % LENGTHS.length])}
      >
        LEN {length}
      </button>
      <button type="button" className="chip" data-active={follow} aria-pressed={follow} onClick={() => setState({ follow: !follow })}>
        FOLLOW
      </button>
    </div>
  );
}

// --- overview matrix ---------------------------------------------------------------------------

interface CellProps {
  track: number;
  abs: number;
  on: boolean;
  acc: boolean;
  slide: boolean;
  selected: boolean;
  big?: boolean;
  note?: string;
}

const Cell = memo(function Cell({ track, abs, on, acc, slide, selected, big, note }: CellProps) {
  const press = usePress(() => tapStep(track, abs), () => holdStep(track, abs));
  const playRef = usePlayheadCell(abs);
  const num = pad2(abs + 1);
  return (
    <button
      type="button"
      className={big ? "pad" : "cell"}
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
      {big && (
        <>
          <span className="pad-num">{num}</span>
          {on && acc && <span className="pad-tag">ACC</span>}
          {on && slide && <span className="pad-tag slide">SLD</span>}
          <span className="pad-main">{on ? note ?? (acc ? "●●" : "●") : "--"}</span>
        </>
      )}
    </button>
  );
});

function FxCell({ abs }: { abs: number }) {
  const id = useStore((s) => s.patterns[s.pattern].fx[abs]);
  const label = id ? PUNCHES.find((p) => p.id === id)?.label.slice(0, 2) : "";
  return (
    <button
      type="button"
      className="cell fx-cell"
      data-on={id !== 0}
      data-beat={abs % 4 === 0}
      aria-label={id ? `FX ${PUNCHES.find((p) => p.id === id)?.label} on step ${abs + 1}, tap to clear` : `No FX on step ${abs + 1}`}
      onClick={() => id && controller.clearFxStep(abs)}
    >
      {label}
    </button>
  );
}

function Lane({ track }: { track: number }) {
  const page = useStore((s) => s.page);
  const tp = useStore((s) => s.patterns[s.pattern].tracks[track]);
  const focused = useStore((s) => s.focus === track);
  const selStep = useStore((s) => (s.focus === track ? s.selStep : -1));
  const muted = useStore((s) => (s.solos.some(Boolean) ? !s.solos[track] : s.mutes[track]));
  const spec = TRACKS[track];
  return (
    <div className="lane" style={accentStyle(track)} data-focus={focused} data-muted={muted}>
      <button
        type="button"
        className="lane-tag"
        aria-label={`Focus ${spec.name}`}
        onClick={() => {
          setState({ focus: track, selStep: -1 });
          controller.audition(track);
        }}
      >
        {spec.short}
      </button>
      <div className="lane-cells">
        {Array.from({ length: PAGE }, (_, i) => {
          const abs = page * PAGE + i;
          const s = tp.steps[abs];
          return <Cell key={i} track={track} abs={abs} on={s.on} acc={s.acc} slide={s.slide} selected={selStep === abs} />;
        })}
      </div>
    </div>
  );
}

export function Matrix() {
  const page = useStore((s) => s.page);
  return (
    <div className="matrix" role="group" aria-label="All tracks, 16 steps">
      {TRACKS.map((t) => <Lane key={t.id} track={t.id} />)}
      <div className="lane fx-lane">
        <span className="lane-tag fx-tag">FX</span>
        <div className="lane-cells">
          {Array.from({ length: PAGE }, (_, i) => <FxCell key={i} abs={page * PAGE + i} />)}
        </div>
      </div>
    </div>
  );
}

// --- focused track ---------------------------------------------------------------------------------

function TrackHeader({ track }: { track: number }) {
  const spec = TRACKS[track];
  const muted = useStore((s) => s.mutes[track]);
  const solo = useStore((s) => s.solos[track]);
  const preset = useStore((s) => s.patterns[s.pattern].tracks[track].preset);
  return (
    <div className="track-head" style={accentStyle(track)}>
      <div className="track-id">
        <span className="track-no">T{track + 1}</span>
        <strong>{spec.name}</strong>
        <span className="silk">{preset || spec.engine}</span>
      </div>
      <div className="track-btns">
        <button type="button" className="btn sm" onClick={() => controller.audition(track)} aria-label={`Hit ${spec.name}`}>HIT</button>
        <button type="button" className="btn sm" data-active={muted} aria-pressed={muted} onClick={() => toggleMute(track)}>M</button>
        <button type="button" className="btn sm solo" data-active={solo} aria-pressed={solo} onClick={() => toggleSolo(track)}>S</button>
        <button type="button" className="btn sm" onClick={() => randomize(track)}>RND</button>
        <ConfirmButton label="CLR" onConfirm={() => clearTrack(track)} />
      </div>
    </div>
  );
}

/** A destructive button that needs a second tap within two seconds. */
export function ConfirmButton({ label, onConfirm, className = "btn sm" }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-armed={armed}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 2000);
        }
      }}
    >
      {armed ? "SURE?" : label}
    </button>
  );
}

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
          <Cell
            key={i} big track={track} abs={abs} on={s.on} acc={s.acc} slide={s.slide} selected={selStep === abs}
            note={melodic && s.on ? noteName(s.note + 12 * tp.oct) : undefined}
          />
        );
      })}
    </div>
  );
}

// --- step editor -----------------------------------------------------------------------------------

const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK: Array<[semi: number, left: number]> = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];

function Keys({ track, step }: { track: number; step: number }) {
  const spec = TRACKS[track];
  const note = useStore((s) => s.patterns[s.pattern].tracks[track].steps[step].note);
  const lo = spec.noteLo ?? 24;
  const hi = spec.noteHi ?? 59;
  const [base, setBase] = useState(() => Math.floor(note / 12) * 12);
  const octBase = Math.min(Math.max(base, Math.floor(lo / 12) * 12), Math.floor(hi / 12) * 12);
  const press = (semi: number) => {
    const n = Math.min(hi, octBase + semi);
    if (n >= lo) setStepNote(track, step, n);
  };
  return (
    <div className="keys-wrap">
      <button type="button" className="btn sm" aria-label="Keys octave down" onClick={() => setBase(octBase - 12)}>◀</button>
      <div className="keys" role="group" aria-label="Note keys">
        {WHITE.map((semi, i) => (
          <button
            key={semi} type="button" className="key white" data-on={note === octBase + semi} style={{ gridColumn: i + 1 }}
            aria-label={noteName(octBase + semi)} onClick={() => press(semi)}
          >
            {noteName(octBase + semi)}
          </button>
        ))}
        {BLACK.map(([semi, left]) => (
          <button
            key={semi} type="button" className="key black" data-on={note === octBase + semi}
            style={{ left: `calc(${(left + 1) * 12.5}% - 4.5%)` }}
            aria-label={noteName(octBase + semi)} onClick={() => press(semi)}
          >
          </button>
        ))}
      </div>
      <button type="button" className="btn sm" aria-label="Keys octave up" onClick={() => setBase(octBase + 12)}>▶</button>
    </div>
  );
}

function StepEditor({ track }: { track: number }) {
  const spec = TRACKS[track];
  const selStep = useStore((s) => s.selStep);
  const step = useStore((s) => (s.selStep >= 0 ? s.patterns[s.pattern].tracks[track].steps[s.selStep] : null));
  const oct = useStore((s) => s.patterns[s.pattern].tracks[track].oct);
  const melodic = spec.role !== "drum";
  const hint = useMemo(
    () => (melodic ? "TAP A STEP TO PLACE A NOTE · TAP AGAIN TO REMOVE" : "TAP = TOGGLE · HOLD = ACCENT"),
    [melodic],
  );
  if (!melodic || !step || selStep < 0) {
    return (
      <div className="step-editor hint" style={accentStyle(track)}>
        <span className="silk">{hint}</span>
        {melodic && (
          <span className="oct">
            <span className="silk">OCT</span>
            <button type="button" className="btn sm" onClick={() => setOctave(track, oct - 1)} aria-label="Octave down">−</button>
            <b>{oct > 0 ? `+${oct}` : oct}</b>
            <button type="button" className="btn sm" onClick={() => setOctave(track, oct + 1)} aria-label="Octave up">+</button>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="step-editor" style={accentStyle(track)}>
      <div className="step-editor-top">
        <span className="silk">STEP {pad2(selStep + 1)}</span>
        <b className="note-readout">{noteName(step.note + 12 * oct)}</b>
        <button type="button" className="btn sm" data-active={step.acc} aria-pressed={step.acc} onClick={() => toggleStepFlag(track, selStep, "acc")}>ACCENT</button>
        <button type="button" className="btn sm" data-active={step.slide} aria-pressed={step.slide} onClick={() => toggleStepFlag(track, selStep, "slide")}>SLIDE</button>
        <span className="oct">
          <span className="silk">OCT</span>
          <button type="button" className="btn sm" onClick={() => setOctave(track, oct - 1)} aria-label="Octave down">−</button>
          <b>{oct > 0 ? `+${oct}` : oct}</b>
          <button type="button" className="btn sm" onClick={() => setOctave(track, oct + 1)} aria-label="Octave up">+</button>
        </span>
      </div>
      <Keys key={track} track={track} step={selStep} />
    </div>
  );
}

export function FocusTrack() {
  const track = useStore((s) => s.focus);
  return (
    <div className="focus-track">
      <TrackHeader track={track} />
      <Pads track={track} />
      <StepEditor track={track} />
    </div>
  );
}

export function SequencerPanel() {
  return (
    <>
      <PageBar />
      <Matrix />
      <FocusTrack />
    </>
  );
}
