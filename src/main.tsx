import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { autosave, loadProject } from "./engine/persist";
import { midi } from "./midi/setup";
import "./index.css";

// Restore the autosave before the first render so the default project never flashes, and before
// autosave starts so it cannot overwrite what is being restored.
void loadProject().then(() => {
  autosave();
  midi.boot();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
