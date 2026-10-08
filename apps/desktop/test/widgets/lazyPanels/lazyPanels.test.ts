/**
 * Code-split panels: wrapper pre-mount output, App wiring, and a guard that
 * the startup graph never value-imports a split module (which would make
 * Rollup fold that chunk back into the main bundle without any error).
 */

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LazyEnvironmentSheetWidget,
  LazyPreviewDrawerWidget,
  LazySettingsPanelWidget,
} from "@/widgets/lazyPanels";
import { SRC_ROOT, readSrc } from "../../helpers/sourceFiles";

/** No-op dismiss handler for wrapper props. */
const noop = () => undefined;

/**
 * Every .ts / .tsx file under src/, as paths relative to src/.
 * @param dir Absolute directory to walk.
 * @returns Relative POSIX-style paths.
 */
function listSourceFiles(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...listSourceFiles(abs));
    } else if (/\.tsx?$/.test(name)) {
      out.push(path.relative(SRC_ROOT, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * Static value-import / re-export specifiers of one file (type-only skipped).
 * @param rel File path relative to src/.
 * @returns Targets normalized to src-relative paths (`@/x` and `./x` → `x`),
 *   bare package specifiers left as-is.
 */
function valueImportTargets(rel: string): string[] {
  const source = readSrc(rel);
  const pattern =
    /^(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']/gm;
  const targets: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const spec = match[2] ?? "";
    if (match[1]) {
      continue;
    }
    if (spec.startsWith("@/")) {
      targets.push(spec.slice(2));
    } else if (spec.startsWith(".")) {
      const abs = path.resolve(path.dirname(path.join(SRC_ROOT, rel)), spec);
      targets.push(path.relative(SRC_ROOT, abs).split(path.sep).join("/"));
    } else {
      targets.push(spec);
    }
  }
  return targets;
}

/** Split module → where a static value import of it is still allowed. */
const SPLIT_MODULES: Array<{ target: RegExp; allowedIn: RegExp }> = [
  { target: /^widgets\/preview(\/|$)/, allowedIn: /^widgets\/preview\// },
  {
    target: /^widgets\/environment(\/|$)/,
    allowedIn: /^widgets\/environment\//,
  },
  {
    target: /^widgets\/prompts(\/|$)/,
    allowedIn: /^widgets\/(prompts|environment)\//,
  },
  { target: /^widgets\/SettingsPanelWidget$/, allowedIn: /^$/ },
  {
    target: /^widgets\/settings(\/|$)/,
    allowedIn: /^widgets\/(settings\/|SettingsPanelWidget\.tsx$)/,
  },
  { target: /^widgets\/shared\/MathStreamdownView$/, allowedIn: /^$/ },
  {
    target: /^(@streamdown\/math|katex)(\/|$)/,
    allowedIn: /^widgets\/shared\/MathStreamdownView\.tsx$/,
  },
];

describe("lazy panel wrappers (before the chunk is ready)", () => {
  it("preview: open paints the drawer-frame placeholder, closed paints nothing", () => {
    const open = renderToStaticMarkup(
      createElement(LazyPreviewDrawerWidget, {
        open: true,
        effectiveLayout: "overlay",
        onClose: noop,
      }),
    );
    assert.match(open, /context-drawer context-drawer-open/);
    assert.match(open, /context-drawer-overlay/);
    assert.match(open, /aria-busy="true"/);
    assert.match(open, /preview-empty/);
    assert.match(open, /width:\d+px/);
    const closed = renderToStaticMarkup(
      createElement(LazyPreviewDrawerWidget, {
        open: false,
        effectiveLayout: "push",
        onClose: noop,
      }),
    );
    assert.equal(closed, "");
  });

  it("overlay panels render nothing until ready (no stand-in modal)", () => {
    assert.equal(
      renderToStaticMarkup(
        createElement(LazySettingsPanelWidget, { open: true, onClose: noop }),
      ),
      "",
    );
    assert.equal(
      renderToStaticMarkup(
        createElement(LazyEnvironmentSheetWidget, { open: true, onClose: noop }),
      ),
      "",
    );
  });
});

describe("code-split wiring", () => {
  it("App mounts the lazy wrappers with unchanged panel props", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /from "@\/widgets\/lazyPanels"/);
    assert.match(app, /<LazyPreviewDrawerWidget\s+open=\{shell\.previewRailOpen\}/);
    assert.match(app, /<LazyEnvironmentSheetWidget\s+open=\{shell\.activePanel === "environment"\}/);
    assert.match(app, /<LazySettingsPanelWidget\s+open=\{shell\.activePanel === "settings"\}/);
  });

  it("panel entries dynamic-import each feature's public entry", () => {
    const entries = readSrc("widgets/lazyPanels/panelEntries.ts");
    assert.match(entries, /import\("@\/widgets\/preview"\)/);
    assert.match(entries, /import\("@\/widgets\/environment"\)/);
    assert.match(entries, /import\("@\/widgets\/SettingsPanelWidget"\)/);
  });

  it("no startup module value-imports a split module", () => {
    const offenders: string[] = [];
    for (const rel of listSourceFiles()) {
      for (const target of valueImportTargets(rel)) {
        for (const rule of SPLIT_MODULES) {
          if (rule.target.test(target) && !rule.allowedIn.test(rel)) {
            offenders.push(`${rel} → ${target}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});
