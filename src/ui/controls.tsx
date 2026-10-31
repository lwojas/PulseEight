// Touch-first control primitives: Knob, Slider, and the tap / long-press hook.
import { useCallback, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type PointerEvent as RPointerEvent } from "react";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// --- Stepper: the OLED readout between a minus and a plus (BPM, last step) ----------------------------

interface StepperProps {
  label: string;
  value: ReactNode;
  onNudge: (delta: -1 | 1) => void;
  /** Accessible names of the two buttons, and whether each is out of range. */
  decLabel: string;
  incLabel: string;
  decDisabled?: boolean;
  incDisabled?: boolean;
  className?: string;
  /** Accessible name of the group when it differs from the visible label. */
  ariaLabel?: string;
}

export function Stepper({ label, ariaLabel, value, onNudge, decLabel, incLabel, decDisabled, incDisabled, className }: StepperProps) {
  return (
    <div className={className ? `oled ${className}` : "oled"} aria-label={ariaLabel ?? label}>
      <button type="button" className="oled-btn" aria-label={decLabel} disabled={decDisabled} onClick={() => onNudge(-1)}>−</button>
      <div className="oled-main">
        <span className="silk">{label}</span>
        <b>{value}</b>
      </div>
      <button type="button" className="oled-btn" aria-label={incLabel} disabled={incDisabled} onClick={() => onNudge(1)}>+</button>
    </div>
  );
}

// --- Knob --------------------------------------------------------------------------------------

const START = 135; // 7 o'clock
const SWEEP = 270; // to 5 o'clock

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface KnobProps {
  label: string;
  value: number;
  readout: string;
  onChange: (v: number) => void;
  /** Normalised default, restored on double-tap. */
  def?: number;
  /** Number of detents for stepped controls. */
  steps?: number;
  accent?: string;
  /** Called when a gesture starts (e.g. to audition). */
  onTouch?: () => void;
  /** The shown value is a step's parameter lock rather than the base value. */
  locked?: boolean;
}

/** Drag up/down (or left/right) to turn; double-tap resets; arrow keys nudge. */
export function Knob({ label, value, readout, onChange, def, steps, accent, onTouch, locked }: KnobProps) {
  const drag = useRef<{ y: number; x: number; v: number } | null>(null);
  const lastTap = useRef(0);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, x: e.clientX, v: value };
    onTouch?.();
    const now = performance.now();
    if (def !== undefined && now - lastTap.current < 300) onChange(def);
    lastTap.current = now;
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 170 px of travel is the full range; holding shift (desktop) makes it 5x finer.
    const travel = e.shiftKey ? 850 : 170;
    const delta = (d.y - e.clientY + (e.clientX - d.x) * 0.5) / travel;
    let next = clamp01(d.v + delta);
    if (steps && steps > 1) next = Math.round(next * (steps - 1)) / (steps - 1);
    if (next !== value) onChange(next);
  };
  const up = () => {
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = steps && steps > 1 ? 1 / (steps - 1) : e.shiftKey ? 0.01 : 0.05;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(clamp01(value + step));
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(clamp01(value - step));
    else if (e.key === "Home") onChange(0);
    else if (e.key === "End") onChange(1);
    else return;
    e.preventDefault();
  };

  // The dial is drawn in a fixed 64-unit box and scaled by CSS (--ks), so size is a layout concern.
  const size = 64;
  const r = size / 2 - 5;
  const c = size / 2;
  const end = START + SWEEP * value;
  const [nx1, ny1] = polar(c, c, r - 14, end);
  const [nx2, ny2] = polar(c, c, r - 3, end);
  const style = { "--k": accent ?? "var(--acc, var(--bass))" } as CSSProperties;

  return (
    <div className="knob" style={style} data-lock={locked || undefined}>
      <div className="knob-label">{label}</div>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={readout}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <svg viewBox={`0 0 ${size} ${size}`}>
          <path d={arc(c, c, r, START, START + SWEEP)} className="knob-track" />
          {value > 0.003 && <path d={arc(c, c, r, START, end)} className="knob-fill" />}
          <circle cx={c} cy={c} r={r - 7} className="knob-cap" />
          <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="knob-notch" />
        </svg>
      </div>
      <div className="knob-readout">{readout}</div>
    </div>
  );
}

// --- Slider ------------------------------------------------------------------------------------

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent?: string;
  /** Normalised default restored on double-tap. */
  def?: number;
  /** Text for the value side (default: the percentage). */
  readout?: string;
  /** The value is a parameter lock (P-LOCK mode). */
  locked?: boolean;
}

/** A chunky horizontal bar you drag across. */
export function Slider({ label, value, onChange, accent, def, readout, locked }: SliderProps) {
  const lastTap = useRef(0);
  const active = useRef(false);
  const set = (e: RPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange(clamp01((e.clientX - rect.left) / rect.width));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clamp01(value + 0.05));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clamp01(value - 0.05));
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="slider"
      data-locked={locked || undefined}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(value.toFixed(2))}
      style={{ "--k": accent ?? "var(--acc)" } as CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = true;
        const now = performance.now();
        if (def !== undefined && now - lastTap.current < 300) onChange(def);
        else set(e);
        lastTap.current = now;
      }}
      onPointerMove={(e) => active.current && set(e)}
      onPointerUp={() => (active.current = false)}
      onPointerCancel={() => (active.current = false)}
      onKeyDown={key}
    >
      <div className="slider-fill" style={{ transform: `scaleX(${value})` }} />
      <span className="slider-label">{label}</span>
      <span className="slider-value">{readout ?? Math.round(value * 100)}</span>
    </div>
  );
}

// --- tap / long-press ----------------------------------------------------------------------------

/** Pointer handlers giving `onTap` on a short press and `onHold` once the press is held 380 ms. */
export function usePress(onTap: (e: RPointerEvent<HTMLElement>) => void, onHold?: () => void, holdMs = 380) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const live = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    live.current = false;
  }, []);

  return {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      live.current = true;
      held.current = false;
      if (onHold) {
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, holdMs);
      }
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      if (!live.current) return;
      window.clearTimeout(timer.current);
      live.current = false;
      if (!held.current) onTap(e);
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
