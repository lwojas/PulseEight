import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { autosave, loadProject } from "./engine/persist";
import "./index.css";

loadProject();
autosave();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
