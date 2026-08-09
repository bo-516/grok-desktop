import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "virtual:uno.css";
import "./styles/defineColor.css";
import "./styles/base.css";
import { App } from "./App";
import { applyTheme, loadTheme } from "./lib/theme";
import { applyPalette, loadPalette } from "./lib/colorPalette";

// F-NATIVE-02 + Settings palette: restore appearance before first paint
applyTheme(loadTheme());
applyPalette(loadPalette());

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
