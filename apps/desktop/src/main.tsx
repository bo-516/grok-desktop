import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "virtual:uno.css";
import "./styles/defineColor.css";
import "./styles/base.css";
import "./styles/base.react-bits.css";
import { App } from "./App";
import { applyTheme, loadTheme } from "./lib/theme";
import { applyPalette, loadPalette } from "./lib/colorPalette";
import { installGlobalCrashHandlers, reportCrash } from "./lib/crashLog";
import { AppErrorBoundary } from "./widgets/AppErrorBoundary";

// F-NATIVE-02 + Settings palette: restore appearance before first paint
applyTheme(loadTheme());
applyPalette(loadPalette());

// Capture uncaught errors + boot beacon before React mounts (black-screen diagnosis).
installGlobalCrashHandlers();

const root = document.getElementById("root");
if (!root) {
  reportCrash("error", "#root missing", { source: "boot" });
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

/**
 * If React never mounts a real tree (module error after #root exists), surface
 * a recovery UI instead of leaving the static boot splash forever.
 * Interval clears once `.app-shell` or the error boundary paints.
 */
if (typeof window !== "undefined") {
  const bootStarted = Date.now();
  const bootWatch = window.setInterval(() => {
    const shell = document.querySelector(".app-shell, [role='alert']");
    if (shell) {
      window.clearInterval(bootWatch);
      return;
    }
    if (Date.now() - bootStarted < 8000) {
      return;
    }
    window.clearInterval(bootWatch);
    reportCrash("error", "UI did not mount within 8s", { source: "boot.watch" });
    const boot = document.getElementById("grok-boot");
    if (!boot) {
      return;
    }
    boot.innerHTML = [
      '<p style="margin:0;font-size:15px;font-weight:500;color:#e8e9eb">Grok Desktop failed to start</p>',
      '<p style="margin:0;font-size:12px;opacity:0.75;max-width:28rem;text-align:center">The UI shell never mounted. Check the bridge/Vite console or app log, then reload.</p>',
      '<button type="button" id="grok-boot-reload" style="margin-top:12px;padding:8px 14px;border:none;border-radius:8px;background:#e8e9eb;color:#0c0d0f;cursor:pointer;font:inherit;font-size:13px">Reload</button>',
    ].join("");
    document.getElementById("grok-boot-reload")?.addEventListener("click", () => {
      window.location.reload();
    });
  }, 500);
}
