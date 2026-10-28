// The arpeggiator's UI: a compact ARP button (opens the settings) beside an on/off switch. One
// implementation serves every track; the track only picks which settings it edits.
import { useRef, useState, type CSSProperties } from "react";
import { ARP_DIRECTIONS, ARP_MAX_OCTAVES, ARP_RATES } from "../engine/arp";
import { setArp } from "../engine/actions";
import { TRACKS } from "../engine/spec";
import { useStore } from "../engine/store";
import { Knob } from "./controls";
import { Modal } from "./Modal";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function ArpSettingsForm({ track }: { track: number }) {
  const a = useStore((s) => s.arp[track]);
  return (
    <div className="arp-form" style={{ "--acc": `var(${TRACKS[track].accent})` } as CSSProperties}>
      <button type="button" className="btn arp-power" data-active={a.on} aria-pressed={a.on} onClick={() => setArp(track, { on: !a.on })}>
        {a.on ? "ARP ON" : "ARP OFF"}
      </button>
      <div className="arp-group" role="group" aria-label="Rate">
        <span className="silk">RATE</span>
        <div className="chips">
          {ARP_RATES.map((r, i) => (
            <button key={r.label} type="button" className="chip" data-active={a.rate === i} aria-pressed={a.rate === i} onClick={() => setArp(track, { rate: i })}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="arp-group" role="group" aria-label="Direction">
        <span className="silk">DIRECTION</span>
        <div className="chips">
          {ARP_DIRECTIONS.map((d) => (
            <button key={d.id} type="button" className="chip" data-active={a.dir === d.id} aria-pressed={a.dir === d.id} onClick={() => setArp(track, { dir: d.id })}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="arp-group" role="group" aria-label="Octave range">
        <span className="silk">OCTAVES</span>
        <div className="chips">
          {Array.from({ length: ARP_MAX_OCTAVES }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className="chip" data-active={a.octaves === n} aria-pressed={a.octaves === n} onClick={() => setArp(track, { octaves: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="knobs arp-knobs">
        <Knob label="VELOCITY" value={a.velocity} def={0.8} readout={pct(a.velocity)} onChange={(v) => setArp(track, { velocity: v })} />
        <Knob label="GATE" value={a.gate} def={0.6} readout={pct(a.gate)} onChange={(v) => setArp(track, { gate: v })} />
      </div>
    </div>
  );
}

/** ARP button + on/off switch for `track`, with the shared settings modal behind the button. */
export function ArpControl({ track }: { track: number }) {
  const on = useStore((s) => s.arp[track].on);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <span className="arp-ctl" style={{ "--acc": `var(${TRACKS[track].accent})` } as CSSProperties}>
      <button ref={btn} type="button" className="btn sm arp-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        ARP
      </button>
      <button type="button" className="btn sm arp-toggle" data-active={on} aria-pressed={on} aria-label={`Arpeggiator ${on ? "on" : "off"}`} onClick={() => setArp(track, { on: !on })}>
        {on ? "ON" : "OFF"}
      </button>
      <Modal open={open} title={`Arpeggiator · ${TRACKS[track].name}`} onClose={() => setOpen(false)} className="arp-modal">
        <ArpSettingsForm track={track} />
      </Modal>
    </span>
  );
}
