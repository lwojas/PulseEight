// The sequencer surface: page selector, the 8-lane overview, the focused track's big pads and the
// step editor (accent / slide / note keys).
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  clearTrack, holdStep, randomize, setLength, setOctave, setStepNote, tapStep, toggleMute, toggleSolo, toggleStepFlag,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { PUNCHES } from "../engine/mangler";
import { noteName, TRACKS } from "../engine/spec";
import { LENGTHS, PAGE } from "../engine/state";
import { getState, setState, useStore } from "../engine/store";
import { usePress } from "./controls";
import { usePlayheadCell, usePlayheadEffect } from "./usePlayhead";
import { useMedia, WIDE } from "./useMedia";

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

// --- fx lane (written punch-ins, one slim row under the pads) -----------------------------------

function FxCell({ abs }: { abs: number }) {
  const id = useStore((s) => s.patterns[s.pattern].fx[abs]);
  const lvl = useStore((s) => s.patterns[s.pattern].fxLvl[abs]);
  const label = id ? PUNCHES.find((p) => p.id === id)?.label.slice(0, 2) : "";
  return (
    <button
      type="button"
      className="cell fx-cell"
      data-on={id !== 0}
      data-beat={abs % 4 === 0}
      style={id ? ({ "--lvl": lvl.toFixed(2) } as CSSProperties) : undefined}
      aria-label={id ? `FX ${PUNCHES.find((p) => p.id === id)?.label} at ${Math.round(lvl * 100)}% on step ${abs + 1}, tap to clear` : `No FX on step ${abs + 1}`}
      onClick={() => id && controller.clearFxStep(abs)}
    >
      {label}
    </button>
  );
}

function FxStrip() {
  const page = useStore((s) => s.page);
  return (
    <div className="fx-strip" role="group" aria-label="Written FX for this page">
      <span className="silk fx-strip-tag">FX</span>
      <div className="fx-strip-cells">
        {Array.from({ length: PAGE }, (_, i) => <FxCell key={i} abs={page * PAGE + i} />)}
      </div>
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

// --- the focused track: header, steps, FX lane, keyboard ---------------------------------------------------

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
        <button type="button" className="btn sm track-ms" data-active={muted} aria-pressed={muted} onClick={() => toggleMute(track)}>M</button>
        <button type="button" className="btn sm solo track-ms" data-active={solo} aria-pressed={solo} onClick={() => toggleSolo(track)}>S</button>
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

/** Playable keys. With a step selected a key writes that step's note; without one it just plays the
 * instrument. Two octaves on wide screens, one on phones. */
function Keys({ track, step }: { track: number; step: number }) {
  const spec = TRACKS[track];
  const wide = useMedia(WIDE);
  const octaves = wide ? 2 : 1;
  const span = octaves * 12;
  const note = useStore((s) => (step >= 0 ? s.patterns[s.pattern].tracks[track].steps[step].note : -1));
  const oct = useStore((s) => s.patterns[s.pattern].tracks[track].oct);
  const lo = spec.noteLo ?? 24;
  const hi = spec.noteHi ?? 59;
  const minBase = Math.floor(lo / 12) * 12;
  const maxBase = Math.max(minBase, Math.floor(hi / 12) * 12 - (octaves - 1) * 12);
  const [base, setBase] = useState(() => Math.min(maxBase, Math.max(minBase, Math.floor((spec.defaultNote ?? lo) / 12) * 12)));
  // keep the selected note on screen
  useEffect(() => {
    if (note >= 0 && (note < base || note > base + span)) setBase(Math.min(maxBase, Math.max(minBase, Math.floor(note / 12) * 12)));
  }, [note, base, span, minBase, maxBase]);
  const view = Math.min(maxBase, Math.max(minBase, base));

  const whites: number[] = [];
  for (let o = 0; o < octaves; o++) for (const w of WHITE_SEMIS) whites.push(view + o * 12 + w);
  whites.push(view + span);
  const blacks = whites.slice(0, -1).flatMap((n, i) => (BLACK_AFTER.has(i % 7) ? [{ n: n + 1, i }] : []));
  const W = whites.length;

  const press = (n: number) => {
    if (n < lo || n > hi) return;
    if (step >= 0) setStepNote(track, step, n);
    else controller.audition(track, n);
  };
  const label = (n: number) => noteName(n + 12 * oct);

  return (
    <div className="keys-wrap">
      <button type="button" className="btn sm key-shift" aria-label="Keys down an octave" disabled={view <= minBase} onClick={() => setBase(view - 12)}>◀</button>
      <div className="keys" role="group" aria-label="Note keys" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
        {whites.map((n, i) => (
          <button
            key={n} type="button" className="key white" data-on={note === n} data-c={n % 12 === 0}
            style={{ gridColumn: i + 1 }} aria-label={label(n)} onClick={() => press(n)}
          >
            {n % 12 === 0 || !wide ? label(n) : ""}
          </button>
        ))}
        {blacks.map(({ n, i }) => (
          <button
            key={n} type="button" className="key black" data-on={note === n}
            style={{ left: `${((i + 1) / W) * 100}%`, width: `${(0.6 / W) * 100}%` }}
            aria-label={label(n)} onClick={() => press(n)}
          />
        ))}
      </div>
      <button type="button" className="btn sm key-shift" aria-label="Keys up an octave" disabled={view >= maxBase} onClick={() => setBase(view + 12)}>▶</button>
    </div>
  );
}

function StepEditor({ track }: { track: number }) {
  const spec = TRACKS[track];
  const selStep = useStore((s) => (s.focus === track ? s.selStep : -1));
  const step = useStore((s) => (s.selStep >= 0 && s.focus === track ? s.patterns[s.pattern].tracks[track].steps[s.selStep] : null));
  const oct = useStore((s) => s.patterns[s.pattern].tracks[track].oct);
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
            <span className="silk">STEP {pad2(selStep + 1)}</span>
            <b className="note-readout">{noteName(step.note + 12 * oct)}</b>
            <button type="button" className="btn sm" data-active={step.acc} aria-pressed={step.acc} onClick={() => toggleStepFlag(track, selStep, "acc")}>ACCENT</button>
            <button type="button" className="btn sm" data-active={step.slide} aria-pressed={step.slide} onClick={() => toggleStepFlag(track, selStep, "slide")}>SLIDE</button>
          </>
        ) : (
          <span className="silk">PLAY THE KEYS · TAP A STEP TO ENTER NOTES</span>
        )}
        <OctaveControl track={track} />
      </div>
      <Keys track={track} step={selStep} />
    </div>
  );
}

export function SequencerPanel() {
  const track = useStore((s) => s.focus);
  return (
    <>
      <PageBar />
      <div className="seq-body" style={accentStyle(track)}>
        <TrackRail />
        <div className="stage" data-drum={TRACKS[track].role === "drum"}>
          <TrackHeader track={track} />
          <Pads track={track} />
          <FxStrip />
          <StepEditor track={track} />
        </div>
      </div>
    </>
  );
}
