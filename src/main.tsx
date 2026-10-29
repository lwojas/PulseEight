import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getHostState, hasEmbeddedHost } from "webdsp";
import { App } from "./App";
import { controller } from "./engine/controller";
import { autosave, loadProject, restoreFromHost } from "./engine/persist";
import { midi } from "./midi/setup";
import "./index.css";

// Restore the autosave before the first render so the default project never flashes, and before
// autosave starts so it cannot overwrite what is being restored. In a plugin host the session is
// restored instead (see persist.ts, "the project in a plugin host's session").
const host = getHostState();
const restored = host ? restoreFromHost(host, () => controller.stop()) : loadProject();
// A plugin host supplies its own audio backend, which needs no user gesture: bring the engine up (not the transport) so the
// start gate never shows. It starts alongside the restore rather than after it (the engine does not need the project to be
// created, only to be configured), which shortens the silence after a reopened window.
if (hasEmbeddedHost()) void controller.start(restored);
void restored.then(() => {
  autosave();
  midi.boot();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
