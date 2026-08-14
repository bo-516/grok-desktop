/**
 * Dev-only ai-inspector integration for the desktop Vite server.
 *
 * Purpose: load the intent-inspector plugin from desktop `devDependencies`
 * so ⌘-click / Alt+Shift+I can hand selected UI source + intent to Grok Build
 * (and other agents) while developing grok-desktop. Production builds never
 * take this path (`apply: 'serve'` inside the plugin).
 *
 * Boundary: missing / unloadable package → empty plugin list (dev still works).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";

/** Absolute path of `apps/desktop` (this file's directory). */
const DESKTOP_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (`grok-desktop/`), used as Grok Build handoff cwd. */
export const REPO_ROOT = path.resolve(DESKTOP_DIR, "../..");

/**
 * Factory exported by the intent-inspector package (`default` or named).
 *
 * @param options Inspector options forwarded to the package (see package types).
 * @returns Vite plugin or plugin list.
 */
type InspectorPluginFactory = (
  options?: Record<string, unknown>,
) => PluginOption | PluginOption[];

/**
 * Resolve the inspector plugin factory from the installed npm package.
 *
 * Boundary: missing package, import error, or a non-function export →
 * `undefined` (caller returns an empty plugin list).
 *
 * @returns Factory when the package is loadable; otherwise `undefined`.
 */
async function loadInspectorPluginFactory(): Promise<
  InspectorPluginFactory | undefined
> {
  try {
    const mod = (await import("ide-byebye")) as {
      default?: InspectorPluginFactory;
      codeIntentInspectorPlugin?: InspectorPluginFactory;
    };
    const factory = mod.default ?? mod.codeIntentInspectorPlugin;
    if (typeof factory === "function") {
      return factory;
    }
    console.warn(
      `[desktop] ai-inspector package has no default/codeIntentInspectorPlugin export; skipping`,
    );
    return undefined;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `[desktop] ai-inspector package failed to load; skipping (${detail})`,
    );
    return undefined;
  }
}

/**
 * Dynamically load Vite plugins from the desktop intent-inspector package.
 *
 * Boundary: returns `[]` when the package is absent or unloadable so
 * `npm run dev` still works. When present, registers source mapping +
 * inspector bootstrap with Grok Build as the default handoff agent and
 * `projectRoot` = monorepo root (not `apps/desktop`).
 * `codeInspector.importClient` is `"file"` so the locator runtime is not
 * inlined into `main.tsx` (avoids Babel's 500KB deopt note).
 *
 * @returns Vite plugin list (0 or more); safe to spread into `plugins`.
 */
export async function loadAiInspectorDevPlugins(): Promise<PluginOption[]> {
  const factory = await loadInspectorPluginFactory();
  if (!factory) {
    return [];
  }

  const plugins = factory({
    // Enter key → Grok Build Terminal launcher with prefilled intent prompt.
    defaultAgent: "grok-build",
    applyMode: "agent-edit",
    // Opt out of rrweb so host project need not install @rrweb/* for basic use.
    recording: false,
    outputDir: ".intent-inspector",
    /*
     * Forwarded to code-inspector-plugin. Default `importClient: "code"`
     * inlines the locator client into the Vite entry (main.tsx) and Babel
     * prints a 500KB deopt note on every serve. `file` keeps that runtime
     * on its own module.
     */
    codeInspector: {
      importClient: "file",
    },
    // Source chips stay monorepo-relative via grokBuild.projectRoot; screenshots /
    // recording stills use absolute paths so Grok can open them regardless of cwd.
    // Override with artifactPathStyle: "relative" only if short chips are preferred.
    pathStyle: "relative",
    artifactPathStyle: "absolute",
    agents: {
      grokBuild: {
        // Handoff cwd is the monorepo root so Grok sees packages/* and apps/*.
        // Relative @ refs are rooted here → @apps/desktop/src/… (not ugly absolute paths).
        projectRoot: REPO_ROOT,
        pathStyle: "relative",
        artifactPathStyle: "absolute",
      },
    },
  });

  return Array.isArray(plugins) ? plugins : [plugins];
}
