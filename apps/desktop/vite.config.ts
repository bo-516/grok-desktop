/**
 * Vite config for the desktop UI shell.
 *
 * Purpose: React + UnoCSS app; in `serve` mode mounts the vendored ai-inspector
 * (ide-byebye single-file build) for source-aware intent handoff while developing.
 *
 * Boundary: production `vite build` does not get inspector injection (plugin
 * `apply: 'serve'`). Missing vendor file only drops that plugin.
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
    server: {
      port: 8172,
      fs: {
        // Monorepo root for resolving workspace packages during serve.
        allow: [REPO_ROOT],
      },
    },
  };
});
