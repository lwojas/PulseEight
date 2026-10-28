// Top-right project controls: SAVE and LOAD (named projects kept in the browser) and a menu with
// file IMPORT / EXPORT.
import { useRef, useState, type ReactNode } from "react";
import { controller } from "../engine/controller";
import { deleteSave, exportProject, importProject, listSaves, loadSaved, saveProject, type SavedProject } from "../engine/persist";
import { refreshKeys } from "../engine/keyhl";
import { ROOT_NAMES, SCALES, SCALE_PRESETS, withPreset, withRoot, withScale } from "../engine/scale";
import { saveKeyHighlight } from "../engine/state";
import { getState, setState, useStore } from "../engine/store";
import { Modal } from "./Modal";

const icon = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const SAVE_ICON = icon(<><path d="M3 2.5h8l2 2v9H3z" /><path d="M5.5 2.5v3.5h4V2.5M5.5 13.5V9.5h5v4" /></>);
const LOAD_ICON = icon(<><path d="M2 5.5V13h12V6H8L6.5 4.5H2z" /></>);
const MENU_ICON = icon(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />);

type Dialog = "save" | "load" | "menu" | "blocked" | null;

const stamp = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProjectMenu() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saves, setSaves] = useState<SavedProject[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const blocked = useStore((s) => s.storageBlocked);
  const projectName = useStore((s) => s.projectName);
  const keyHl = useStore((s) => s.keyHighlight);
  const scale = useStore((s) => s.scale);
  const toggleKeyHl = () => {
    setState({ keyHighlight: !keyHl });
    saveKeyHighlight(!keyHl);
    refreshKeys();
  };

  const open = (d: Dialog) => {
    setNote("");
    if (d === "load") void listSaves().then(setSaves);
    if (d === "save") setName(getState().projectName);
    setDialog(d);
  };
  const close = () => setDialog(null);
  const stopFirst = () => getState().playing && controller.stop();

  const doSave = async () => {
    if (await saveProject(name)) close();
    else setNote("Could not save: browser storage is full or blocked.");
  };
  const doLoad = (entry: SavedProject) => {
    stopFirst();
    if (loadSaved(entry)) close();
    else setNote("That save is damaged and could not be loaded.");
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    stopFirst();
    try {
      await importProject(f);
      close();
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <div className="project-menu">
      <span className="project-name" title={projectName || "Unsaved project"} data-empty={!projectName}>{projectName || "UNSAVED"}</span>
      <button
        ref={saveBtn} type="button" className="btn sm" data-blocked={blocked} aria-disabled={blocked} aria-haspopup={blocked ? "dialog" : undefined}
        aria-label={blocked ? "Save project (unavailable: storage is blocked)" : "Save project"} onClick={() => open(blocked ? "blocked" : "save")}
      >{SAVE_ICON}<span className="lbl">SAVE</span></button>
      <button type="button" className="btn sm" aria-label="Load project" onClick={() => open("load")}>{LOAD_ICON}<span className="lbl">LOAD</span></button>
      <button ref={menuBtn} type="button" className="btn sm" aria-label="Menu" aria-haspopup="dialog" onClick={() => open("menu")}>{MENU_ICON}</button>

      <Modal open={dialog === "save"} title="Save project" onClose={close}>
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); void doSave(); }}>
          <label className="silk" htmlFor="save-name">NAME</label>
          <input id="save-name" className="modal-input" value={name} maxLength={40} autoComplete="off" placeholder="My groove" onChange={(e) => setName(e.target.value)} />
          <p className="modal-note">Saving under an existing name replaces it.</p>
          {note && <p className="modal-note err" role="alert">{note}</p>}
          <button type="submit" className="btn modal-primary">SAVE</button>
        </form>
      </Modal>

      <Modal open={dialog === "blocked"} title="Storage is blocked" onClose={close} anchor={{ to: saveBtn, placement: "bottom", offset: 6 }}>
        <p className="modal-note">This browser is not letting Pulse.8 store anything, so your project is not being saved and a reload will lose it. This usually means a private or incognito window, or site data blocked in the browser settings.</p>
        <p className="modal-note">To keep your work, open Pulse.8 in a normal window and allow site data, or use <b>Menu → Export</b> to download the project as a file. Import it again later from the same menu.</p>
        <button type="button" className="btn modal-primary" onClick={close}>OK</button>
      </Modal>

      <Modal open={dialog === "load"} title="Load project" onClose={close}>
        {saves.length === 0 ? <p className="modal-note">No saved projects yet.</p> : (
          <ul className="modal-list">
            {saves.map((e) => (
              <li key={e.id}>
                <button type="button" className="modal-item" onClick={() => doLoad(e)}>
                  <b>{e.name}</b><small>{stamp(e.savedAt)}</small>
                </button>
                <button type="button" className="btn sm" aria-label={`Delete ${e.name}`} onClick={() => { void deleteSave(e.id).then(listSaves).then(setSaves); }}>✕</button>
              </li>
            ))}
          </ul>
        )}
        {note && <p className="modal-note err" role="alert">{note}</p>}
        <p className="modal-note">Loading replaces the current project.</p>
      </Modal>

      <Modal open={dialog === "menu"} title="Menu" onClose={close} anchor={{ to: menuBtn, placement: "bottom", offset: 6 }}>
        <div className="modal-menu">
          <section className="menu-group" aria-label="Key and scale">
            <span className="silk">KEY &amp; SCALE</span>
            <div className="menu-field">
              <label className="silk" htmlFor="scale-preset">GENRE PRESET</label>
              <select id="scale-preset" className="modal-input modal-select" value={scale.preset} onChange={(e) => setState({ scale: withPreset(scale, e.target.value) })}>
                <option value="" disabled>Custom</option>
                {SCALE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} · {ROOT_NAMES[p.root]} {SCALES.find((x) => x.id === p.scale)?.label}</option>)}
              </select>
            </div>
            <div className="menu-row">
              <div className="menu-field">
                <label className="silk" htmlFor="scale-root">ROOT</label>
                <select id="scale-root" className="modal-input modal-select" value={scale.root} onChange={(e) => setState({ scale: withRoot(scale, Number(e.target.value)) })}>
                  {ROOT_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </div>
              <div className="menu-field">
                <label className="silk" htmlFor="scale-mode">SCALE</label>
                <select id="scale-mode" className="modal-input modal-select" value={scale.scale} onChange={(e) => setState({ scale: withScale(scale, e.target.value) })}>
                  {SCALES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </div>
            </div>
            <p className="modal-note">Synth keyboards show only the scale's notes, starting on the root. Chromatic shows every key.</p>
          </section>
          <section className="menu-group" aria-label="Display">
            <span className="silk">DISPLAY</span>
            <button type="button" className="btn" data-active={keyHl} role="switch" aria-checked={keyHl} onClick={toggleKeyHl}>KEY HIGHLIGHT: {keyHl ? "ON" : "OFF"}</button>
          </section>
          <section className="menu-group" aria-label="Project file">
            <span className="silk">PROJECT FILE</span>
            <div className="menu-row">
              <button type="button" className="btn" onClick={() => { exportProject(getState().projectName); close(); }}>EXPORT</button>
              <button type="button" className="btn" onClick={() => file.current?.click()}>IMPORT</button>
            </div>
            {note && <p className="modal-note err" role="alert">{note}</p>}
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ""; }} />
          </section>
        </div>
      </Modal>
    </div>
  );
}
