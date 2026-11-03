// The sidechain editor: duck this track to another track's signal (the bass under the kick). Few controls on purpose: a source, how deep,
// and how fast it comes back; the compressor behind it is fixed to what ducking wants (see sidechain.ts).
import { setSidechain } from "../engine/actions";
import { formatScAmount, formatScRelease, scActive, scLoops, sidechainOf } from "../engine/sidechain";
import { NUM_TRACKS, TRACKS } from "../engine/spec";
import { useStore } from "../engine/store";
import { Knob } from "./controls";
import { Modal } from "./Modal";
import { useState, type CSSProperties } from "react";

const accentStyle = (track: number): CSSProperties => ({ "--acc": `var(${TRACKS[track].accent})` }) as CSSProperties;

function SidechainBody({ track }: { track: number }) {
  const tracks = useStore((s) => s.patterns[s.pattern].tracks);
  const sc = sidechainOf(tracks[track], track);
  const set = (patch: Parameters<typeof setSidechain>[1]) => setSidechain(track, patch);
  return (
    <section className="sc-body" data-on={sc.on} aria-label="Sidechain">
      <div className="sc-head">
        <button type="button" className="btn sm" data-active={sc.on} aria-pressed={sc.on} onClick={() => set({ on: !sc.on })}>DUCK</button>
        <label className="silk sc-src">
          TO
          <select className="chip variant" aria-label="Sidechain source" value={sc.src} onChange={(e) => set({ src: Number(e.target.value) })}>
            {Array.from({ length: NUM_TRACKS }, (_, i) => i).filter((i) => i !== track).map((i) => (
              <option key={i} value={i} disabled={scLoops(tracks, track, i)}>{`${i + 1} · ${TRACKS[i].name}`}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="knobs sc-knobs" style={{ "--n": 2 } as React.CSSProperties}>
        <Knob label="AMOUNT" value={sc.amt} def={0.5} readout={formatScAmount(sc.amt)} onChange={(v) => set({ amt: Math.round(v * 100) / 100 })} />
        <Knob label="RELEASE" value={sc.rel} def={0.4} readout={formatScRelease(sc.rel)} onChange={(v) => set({ rel: Math.round(v * 100) / 100 })} />
      </div>
    </section>
  );
}

/** The SC button (next to LFO under the INSERT FX faders of the sound panel) and the modal it opens. */
export function SidechainButton({ track }: { track: number }) {
  const [open, setOpen] = useState(false);
  const active = useStore((s) => scActive(s.patterns[s.pattern].tracks[track]));
  return (
    <>
      <button type="button" className="btn sm" data-active={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>SC</button>
      <Modal open={open} title={`${TRACKS[track].name} · Sidechain`} onClose={() => setOpen(false)} className="sc-modal">
        <div style={accentStyle(track)}>
          <SidechainBody track={track} />
        </div>
      </Modal>
    </>
  );
}
