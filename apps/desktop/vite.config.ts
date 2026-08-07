import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
  },
});
