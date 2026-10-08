/**
 * Vite config for the desktop UI shell.
 *
 * Purpose: React + UnoCSS app; in `serve` mode mounts the dev-only
 * ai-inspector for source-aware intent handoff while developing.
 *
 * Boundary: production `vite build` does not get inspector injection (plugin
 * `apply: 'serve'`). A missing inspector package only drops that plugin.
 * Sourcemaps are off for both serve and build — we debug via source paths /
 * inspector chips, not browser source maps (avoids multi-MB inline maps).
 * plugin-react uses `babel.compact` so inspector injection cannot trip
 * Babel's 500KB pretty-print deopt note on the entry.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { loadAiInspectorDevPlugins, REPO_ROOT } from "./aiInspectorDev";

/**
 * Product semver baked into the client as __APP_VERSION__.
 * Root package.json is the source of truth. VERSION overrides it for a
 * release build that stamps a different number than the committed file.
 * A missing or unreadable package.json falls back to 0.0.0-dev so the
 * dev server still boots.
 * @returns A non-empty version string.
 */
function readProductVersion(): string {
  const fromEnv = process.env.VERSION?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const raw = readFileSync(
      path.resolve(__dirname, "../../package.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Fall through to the dev placeholder.
  }
  return "0.0.0-dev";
}

export default defineConfig(async () => {
  const aiInspectorPlugins = await loadAiInspectorDevPlugins();
  /** Same string Info.plist and the shell -X stamp use. */
  const appVersion = readProductVersion();

  return {
    plugins: [
      UnoCSS(),
      // code-inspector must run before the React transform (plugin order).
      ...aiInspectorPlugins,
      react({
        /*
         * Inspector + data-insp-path can push the entry past Babel's 500KB
         * pretty-print threshold (`importClient: "code"` inlines ~600KB).
         * compact skips the deopt note; source maps stay off below.
         */
        babel: { compact: true },
      }),
    ],
    /**
     * Replaced at transform time. A string literal, so the client never
     * reads package.json. Tests that run outside Vite do not see this define.
     */
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        // Dev: resolve workspace package to source for HMR without prebuild
        "@grok-desktop/acp-core": path.resolve(
          __dirname,
          "../../packages/acp-core/src/index.ts",
        ),
      },
    },
    /**
     * Dev environment (Vite 6): default is `{ js: true }`, which appends huge
     * inline sourceMappingURL blobs on every transformed module. Off for both
     * JS and CSS — inspector already carries source locations.
     */
    dev: {
      sourcemap: false,
    },
    /** Production: keep default false explicit so maps never ship in dist. */
    build: {
      sourcemap: false,
    },
    css: {
      /** CSS pipeline sourcemaps in serve (independent of `dev.sourcemap`). */
      devSourcemap: false,
    },
    server: {
      port: 8172,
      fs: {
        // Monorepo root for resolving workspace packages during serve.
        allow: [REPO_ROOT],
      },
    },
  };
});
