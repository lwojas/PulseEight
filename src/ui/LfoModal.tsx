// The LFO editor: three LFOs per track, each pointed at one parameter of the track (its sound knobs, sends and INSERT FX).
import { useState, type CSSProperties } from "react";
import { setLfo } from "../engine/actions";
import { formatLfoRate, LFO_DIVISION_NAMES, LFO_WAVES } from "../engine/lfo";
import { lockParams } from "../engine/plock";
import { TRACKS } from "../engine/spec";
import { useStore } from "../engine/store";
import { Knob } from "./controls";
import { Modal } from "./Modal";

const accentStyle = (track: number): CSSProperties => ({ "--acc": `var(${TRACKS[track].accent})` }) as CSSProperties;

function LfoRow({ track, index }: { track: number; index: number }) {
  const lfo = useStore((s) => s.patterns[s.pattern].tracks[track].lfos[index]);
  const targets = lockParams(track);
  const set = (patch: Partial<typeof lfo>) => setLfo(track, index, patch);
  const divN = LFO_DIVISION_NAMES.length;
  return (
    <section className="lfo-row" aria-label={`LFO ${index + 1}`} data-on={lfo.on}>
      <div className="lfo-head">
        <button type="button" className="btn sm" data-active={lfo.on} aria-pressed={lfo.on} onClick={() => set({ on: !lfo.on })}>LFO {index + 1}</button>
        <select className="chip variant" aria-label={`LFO ${index + 1} target`} value={lfo.target} onChange={(e) => set({ target: e.target.value, on: e.target.value ? true : lfo.on })}>
          <option value="">— TARGET —</option>
          {targets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className="lfo-body">
        <div className="seg" role="group" aria-label="Waveform">
          {LFO_WAVES.map((w, i) => (
            <button key={w} type="button" className="chip" data-active={lfo.wave === i} aria-pressed={lfo.wave === i} onClick={() => set({ wave: i })}>{w}</button>
          ))}
        </div>
        <button type="button" className="btn sm" data-active={lfo.sync} aria-pressed={lfo.sync} onClick={() => set({ sync: !lfo.sync })}>SYNC</button>
        <div className="knobs lfo-knobs" style={{ "--n": 2 } as CSSProperties}>
          {lfo.sync ? (
            <Knob key="div" label="RATE" value={lfo.div / (divN - 1)} def={0.5} steps={divN} readout={formatLfoRate(lfo)} onChange={(v) => set({ div: Math.round(v * (divN - 1)) })} />
          ) : (
            <Knob key="rate" label="RATE" value={lfo.rate} def={0.4} readout={formatLfoRate(lfo)} onChange={(v) => set({ rate: v })} />
          )}
          <Knob label="DEPTH" value={(lfo.depth + 1) / 2} def={0.75} readout={`${Math.round(lfo.depth * 100)}%`} onChange={(v) => set({ depth: Math.round((v * 2 - 1) * 100) / 100 })} />
        </div>
      </div>
    </section>
  );
}

/** The LFO button (beside the P-LOCK buttons of the sound panel) and the modal it opens. */
export function LfoButton({ track }: { track: number }) {
  const [open, setOpen] = useState(false);
  const active = useStore((s) => s.patterns[s.pattern].tracks[track].lfos.some((l) => l.on && l.target));
  return (
    <>
      <button type="button" className="btn sm lfo-btn" data-active={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>LFO</button>
      <Modal open={open} title={`${TRACKS[track].name} · LFOs`} onClose={() => setOpen(false)} className="lfo-modal">
        <div style={accentStyle(track)}>
          {[0, 1, 2].map((i) => <LfoRow key={i} track={track} index={i} />)}
        </div>
      </Modal>
    </>
  );
}
