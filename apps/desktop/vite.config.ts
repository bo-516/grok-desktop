/**
 * Vite config for the desktop UI shell.
 *
 * Purpose: React + UnoCSS app; in `serve` mode mounts the vendored ai-inspector
 * (ide-byebye single-file build) for source-aware intent handoff while developing.
 *
 * Boundary: production `vite build` does not get inspector injection (plugin
 * `apply: 'serve'`). Missing vendor file only drops that plugin.
 * Sourcemaps are off for both serve and build — we debug via source paths /
 * inspector chips, not browser source maps (avoids multi-MB inline maps and
 * Babel deopt noise after inspector injects long data-insp-path attrs).
 */

import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { loadAiInspectorDevPlugins, REPO_ROOT } from "./aiInspectorDev";

export default defineConfig(async () => {
  const aiInspectorPlugins = await loadAiInspectorDevPlugins();

  return {
    plugins: [
      UnoCSS(),
      // code-inspector must run before the React transform (plugin order).
      ...aiInspectorPlugins,
      react(),
    ],
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
