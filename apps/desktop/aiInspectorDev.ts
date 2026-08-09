/**
 * Dev-only ai-inspector (ide-byebye) integration for the desktop Vite server.
 *
 * Purpose: load the **vendored** single-file plugin under `vendor/ai-inspector/`
 * so ⌘-click / Alt+Shift+I can hand selected UI source + intent to Grok Build
 * (and other agents) while developing grok-desktop. Production builds never
 * take this path (`apply: 'serve'` inside the plugin).
 *
 * Boundary: imports only the in-repo vendored build — no external monorepo
 * checkout and no `AI_INSPECTOR_PATH`. Missing / unloadable vendor file → empty
 * plugin list (dev still works). Peer packages `unplugin` and
 * `code-inspector-plugin` must be present in desktop `devDependencies`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";

/** Absolute path of `apps/desktop` (this file's directory). */
const DESKTOP_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (`grok-desktop/`), used as Grok Build handoff cwd. */
export const REPO_ROOT = path.resolve(DESKTOP_DIR, "../..");

/**
 * Vendored single-file build of ide-byebye (`dist/code-intent-inspector.js`).
 * Refresh by copying a rebuilt artifact into this path (see vendor README).
 */
const VENDORED_PLUGIN_ENTRY = path.join(
  DESKTOP_DIR,
  "vendor/ai-inspector/code-intent-inspector.js",
);

/**
 * Dynamically load Vite plugins from the vendored ai-inspector build.
 *
 * Boundary: returns `[]` when the vendor file is absent so `npm run dev` still
 * works. When present, registers code-inspector + inspector bootstrap with Grok
 * Build as the default handoff agent and `projectRoot` = monorepo root (not
 * `apps/desktop`).
 *
 * @returns Vite plugin list (0 or more); safe to spread into `plugins`.
 */
export async function loadAiInspectorDevPlugins(): Promise<PluginOption[]> {
  if (!fs.existsSync(VENDORED_PLUGIN_ENTRY)) {
    console.warn(
      `[desktop] vendored ai-inspector missing at ${VENDORED_PLUGIN_ENTRY}`,
    );
    return [];
  }

  const mod = (await import(VENDORED_PLUGIN_ENTRY)) as {
    default?: (options?: Record<string, unknown>) => PluginOption | PluginOption[];
    codeIntentInspectorPlugin?: (
      options?: Record<string, unknown>,
    ) => PluginOption | PluginOption[];
  };
  const factory = mod.default ?? mod.codeIntentInspectorPlugin;
  if (typeof factory !== "function") {
    console.warn(
      `[desktop] vendored ai-inspector has no default/codeIntentInspectorPlugin export; skipping`,
    );
    return [];
  }

  const plugins = factory({
    // Enter key → Grok Build Terminal launcher with prefilled intent prompt.
    defaultAgent: "grok-build",
    applyMode: "agent-edit",
    // Opt out of rrweb so host project need not install @rrweb/* for basic use.
    recording: false,
    outputDir: ".intent-inspector",
    agents: {
      grokBuild: {
        // Handoff cwd is the monorepo root so Grok sees packages/* and apps/*.
        // Relative @ refs are rooted here → @apps/desktop/src/… (not ugly absolute paths).
        projectRoot: REPO_ROOT,
      },
    },
  });

  return Array.isArray(plugins) ? plugins : [plugins];
}
