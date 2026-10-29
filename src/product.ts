// Product identity: the names and storage keys that make this build "Pulse.8". A cloned product edits
// this file first. Everything here is an identifier saved on users' machines or stamped into project
// files, so changing `id` after shipping orphans existing saves, autosaves and MIDI settings.
export const PRODUCT = {
  /** Display name (menus, messages, the page title in index.html). */
  name: "Pulse.8",
  /** Header logo: the two halves are styled separately (see `.logo` in index.css). */
  logo: ["PULSE", ".8"] as const,
  /** Stable machine id: IndexedDB name, localStorage prefix, project-file stamp, and the VST's app id.
   * Must equal WEBVST_APP_ID in vst/CMakeLists.txt, or a plugin host rejects the state. */
  id: "pulse8",
};

/** Prefix for localStorage keys, e.g. `storageKey("midi")` → "pulse8.midi". */
export const storageKey = (name: string) => `${PRODUCT.id}.${name}`;
/** Extension of exported project files, e.g. ".pulse8.json". */
export const FILE_EXT = `.${PRODUCT.id}.json`;
