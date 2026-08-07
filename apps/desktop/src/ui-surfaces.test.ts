/**
 * Structural checks: Framer-prototype shell + live-only product path.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(path.join(here, rel), "utf8");
}

describe("UI surface presence", () => {
  it("timeline renders user/agent/thought/tool kinds", () => {
    const timeline = read("widgets/TimelineView.tsx");
    const thought = read("widgets/timeline/ThoughtWidget.tsx");
    const tool = read("widgets/timeline/ToolCardView.tsx");
    assert.match(timeline, /data-kind="user"/);
    assert.match(timeline, /data-kind="agent"/);
    assert.match(thought, /data-kind="thought"/);
    assert.match(tool, /data-kind="tool"/);
    assert.match(timeline, /toolCalls/);
  });

  it("composer has send and cancel/stop", () => {
    const view = read("widgets/composer/ComposerWidget.tsx");
    const hook = read("widgets/composer/useComposerWidget.ts");
    assert.match(view, /composer-dock/);
    assert.match(view, /@ files?/);
    assert.match(view, /sendHint/);
    assert.match(hook, /sendPrompt/);
    assert.match(hook, /cancelTurn/);
    assert.match(hook, /useComposerCompletion/);
    assert.match(hook, /Generating/);
  });

  it("permission UI offers selectable outcomes", () => {
    const src = read("widgets/PermissionModalView.tsx");
    assert.match(src, /respondPermission/);
    assert.match(src, /allow_once/);
    assert.match(src, /deny/);
  });

  it("App shell matches prototype regions", () => {
    const src = read("App.tsx");
    assert.match(src, /SessionRailView/);
    assert.match(src, /TimelineView/);
    assert.match(src, /ComposerWidget/);
    assert.match(src, /top-nav/);
    assert.match(src, /main-column/);
    assert.doesNotMatch(src, /Viewing saved history|read-only/);
  });

  it("product UI is live-only (no mock agent entry)", () => {
    const app = read("App.tsx");
    assert.match(app, /startLiveBridge|selectSession/);
    assert.doesNotMatch(app, /startMockAgent|loadDemoFixture|Mock agent/);
    const store = read("store/sessionStore.ts");
    assert.doesNotMatch(store, /createMockAcpPair/);
    // Product path must not silently set alwaysApprove:true
    const live = read("store/sessionStoreLive.ts");
    assert.match(live, /DEFAULT_ALWAYS_APPROVE = false/);
    assert.doesNotMatch(store, /alwaysApprove:\s*true/);
    assert.doesNotMatch(live, /alwaysApprove:\s*true/);
  });

  it("session rail is side-nav with project groups", () => {
    const rail = read("widgets/SessionRailView.tsx");
    assert.match(rail, /side-nav/);
    assert.match(rail, /groupSessionsByProject/);
    assert.match(rail, /New chat/);
    assert.match(rail, /selectSession/);
    assert.doesNotMatch(rail, /style=\{\{/);
  });

  it("tool card normalizes array content and plan empty is en-US", () => {
    const tool = read("widgets/timeline/ToolCardView.tsx");
    assert.match(tool, /normalizeToolContentParts/);
    assert.match(tool, /mini-diff/);
    const plan = read("widgets/PlanPanelView.tsx");
    assert.match(plan, /No plan yet/);
  });

  it("colors only via defineColor tokens in layout css", () => {
    const css = read("styles/defineColor.css");
    assert.match(css, /--color-bg-app/);
    assert.match(css, /--color-primary/);
    const layoutFiles = [
      "styles/shell-layout.css",
      "styles/side-nav.css",
      "styles/timeline.css",
      "styles/composer.css",
      "styles/chrome.css",
    ];
    for (const rel of layoutFiles) {
      const body = read(rel);
      assert.equal(
        /#[0-9a-fA-F]{3,8}\b/.test(body),
        false,
        `${rel} must not contain hex colors`,
      );
    }
  });
});
