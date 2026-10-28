// Top-right project controls: SAVE and LOAD (named projects kept in the browser) and a menu with
// file IMPORT / EXPORT.
import { useRef, useState, type ReactNode } from "react";
import { controller } from "../engine/controller";
import { deleteSave, exportProject, importProject, listSaves, loadSaved, saveProject, type SavedProject } from "../engine/persist";
import { refreshKeys } from "../engine/keyhl";
import { saveKeyHighlight } from "../engine/state";
import { getState, setState, useStore } from "../engine/store";
import { Modal } from "./Modal";

const icon = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const SAVE_ICON = icon(<><path d="M3 2.5h8l2 2v9H3z" /><path d="M5.5 2.5v3.5h4V2.5M5.5 13.5V9.5h5v4" /></>);
const LOAD_ICON = icon(<><path d="M2 5.5V13h12V6H8L6.5 4.5H2z" /></>);
const MENU_ICON = icon(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />);

type Dialog = "save" | "load" | "menu" | null;

const stamp = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProjectMenu() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saves, setSaves] = useState<SavedProject[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const projectName = useStore((s) => s.projectName);
  const keyHl = useStore((s) => s.keyHighlight);
  const toggleKeyHl = () => {
    setState({ keyHighlight: !keyHl });
    saveKeyHighlight(!keyHl);
    refreshKeys();
  };

  const open = (d: Dialog) => {
    setNote("");
    if (d === "load") setSaves(listSaves());
    if (d === "save") setName(getState().projectName);
    setDialog(d);
  };
  const close = () => setDialog(null);
  const stopFirst = () => getState().playing && controller.stop();

  const doSave = () => {
    if (saveProject(name)) close();
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
      <button type="button" className="btn sm" aria-label="Save project" onClick={() => open("save")}>{SAVE_ICON}<span className="lbl">SAVE</span></button>
      <button type="button" className="btn sm" aria-label="Load project" onClick={() => open("load")}>{LOAD_ICON}<span className="lbl">LOAD</span></button>
      <button ref={menuBtn} type="button" className="btn sm" aria-label="Menu" aria-haspopup="dialog" onClick={() => open("menu")}>{MENU_ICON}</button>

      <Modal open={dialog === "save"} title="Save project" onClose={close}>
        <form className="modal-form" onSubmit={(e) => { e.preventDefault(); doSave(); }}>
          <label className="silk" htmlFor="save-name">NAME</label>
          <input id="save-name" className="modal-input" value={name} maxLength={40} autoComplete="off" placeholder="My groove" onChange={(e) => setName(e.target.value)} />
          <p className="modal-note">Saving under an existing name replaces it.</p>
          {note && <p className="modal-note err" role="alert">{note}</p>}
          <button type="submit" className="btn modal-primary">SAVE</button>
        </form>
      </Modal>

      <Modal open={dialog === "load"} title="Load project" onClose={close}>
        {saves.length === 0 ? <p className="modal-note">No saved projects yet.</p> : (
          <ul className="modal-list">
            {saves.map((e) => (
              <li key={e.id}>
                <button type="button" className="modal-item" onClick={() => doLoad(e)}>
                  <b>{e.name}</b><small>{stamp(e.savedAt)}</small>
                </button>
                <button type="button" className="btn sm" aria-label={`Delete ${e.name}`} onClick={() => { deleteSave(e.id); setSaves(listSaves()); }}>✕</button>
              </li>
            ))}
          </ul>
        )}
        {note && <p className="modal-note err" role="alert">{note}</p>}
        <p className="modal-note">Loading replaces the current project.</p>
      </Modal>

      <Modal open={dialog === "menu"} title="Menu" onClose={close} anchor={{ to: menuBtn, placement: "bottom", offset: 6 }}>
        <div className="modal-menu">
          <button type="button" className="btn" data-active={keyHl} role="switch" aria-checked={keyHl} onClick={toggleKeyHl}>KEY HIGHLIGHT: {keyHl ? "ON" : "OFF"}</button>
          <button type="button" className="btn" onClick={() => { exportProject(getState().projectName); close(); }}>EXPORT TO FILE</button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>IMPORT FROM FILE</button>
          {note && <p className="modal-note err" role="alert">{note}</p>}
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </Modal>
    </div>
  );
}
