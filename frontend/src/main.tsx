import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyTheme, loadTheme } from "./lib/theme";
import "./styles.css";

// Set the theme before the first render so a stored dark theme never flashes light.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
