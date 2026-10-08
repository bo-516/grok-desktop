/**
 * Settled rows take the content-visibility shortcut; the live row does not.
 * Off-screen fences stay plain; geometry for that decision is pure.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGenerator } from "unocss";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { isTurnLive } from "@/lib/turnGrouping";
import {
  TIMELINE_CODE_HIGHLIGHT_MARGIN_PX,
  timelineRowNearScroller,
} from "@/widgets/timeline/timelineRowHighlight";
import { CodeHighlightVisibilityContext } from "@/widgets/shared";
import unoConfigModule from "../../../uno.config";
import { readDesktopRoot } from "../../helpers/sourceFiles";

register(new URL("../../helpers/cssHooks.mjs", import.meta.url));

describe("timeline-settled shortcut", () => {
  it("compiles content-visibility and a remembered block size", async () => {
    const source = readDesktopRoot("uno/shortcuts.timeline.ts");
    assert.match(source, /"timeline-settled":/);
    assert.match(source, /contain-intrinsic-block-size:auto_240px/);
    const uno = await createGenerator(unoConfigModule);
    const { css } = await uno.generate("timeline-settled", { preflights: false });
    assert.match(css, /content-visibility:\s*auto/);
    assert.match(css, /contain-intrinsic-block-size:\s*auto 240px/);
  });
});

describe("timeline row highlight geometry", () => {
  it("treats the prefetch band as near and a far row as deferred", () => {
    const root = { top: 100, right: 800, bottom: 700, left: 0 };
    const margin = TIMELINE_CODE_HIGHLIGHT_MARGIN_PX;
    assert.equal(
      timelineRowNearScroller(
        { top: 120, right: 800, bottom: 400, left: 0 },
        root,
        margin,
      ),
      true,
    );
    assert.equal(
      timelineRowNearScroller(
        { top: 700 + margin - 10, right: 800, bottom: 700 + margin + 40, left: 0 },
        root,
        margin,
      ),
      true,
    );
    assert.equal(
      timelineRowNearScroller(
        { top: 700 + margin + 50, right: 800, bottom: 700 + margin + 300, left: 0 },
        root,
        margin,
      ),
      false,
    );
    assert.equal(
      timelineRowNearScroller(
        { top: Number.NaN, right: 0, bottom: 0, left: 0 },
        root,
        margin,
      ),
      false,
    );
  });
});

describe("settled vs live row shell", () => {
  it("puts content-visibility only on rows that are not the streaming turn", async () => {
    const { TimelineView } = await import("@/widgets/timeline/TimelineView");
    const timeline: TimelineItem[] = [
      {
        kind: "user",
        id: "u0",
        blocks: [{ type: "text", text: "first" }],
      },
      {
        kind: "agent",
        id: "a0",
        text: "Settled answer.\n\n```ts\nexport const settled = 1;\n```\n",
      },
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "second" }],
      },
      {
        kind: "agent",
        id: "a1",
        text: "Live answer.\n\n```ts\nexport const n = 1;\n```\n",
      },
    ];
    const units = buildTimelineRenderUnits(timeline, {});
    const html = renderToStaticMarkup(
      createElement(TimelineView, {
        timeline,
        toolCalls: {},
        status: "streaming",
        units,
        seededUnitKeys: new Set(units.map((unit) => (unit.type === "item" ? unit.item.id : unit.id))),
        isRestoring: false,
        isEmpty: false,
        scrollRef: { current: null },
        handleScroll: () => undefined,
        isTurnLive,
        wrapUpIndex: -1,
        wrapUpText: "",
      }),
    );
    const settled = html.match(/data-settled="1"/g) ?? [];
    const live = html.match(/data-settled="0"/g) ?? [];
    assert.equal(live.length, 1);
    assert.equal(settled.length, 3);
    assert.match(html, /timeline-settled/);
    assert.doesNotMatch(html, /timeline-settled[^>]*data-settled="0"/);
    assert.match(html, /data-code-highlight="deferred"/);
    assert.match(html, /data-code-highlight="on"/);
    assert.match(html, /export const n = 1/);
  });

  it("does not ask Shiki to run while the fence is deferred", async () => {
    const { MarkdownCodeWidget } = await import("@/widgets/shared/MarkdownCodeWidget");
    const html = renderToStaticMarkup(
      createElement(
        CodeHighlightVisibilityContext.Provider,
        { value: "deferred" },
        createElement(
          MarkdownCodeWidget,
          { className: "language-ts" },
          "export const n = 1;\n",
        ),
      ),
    );
    assert.match(html, /data-code-highlight="deferred"/);
    assert.match(html, /export const n = 1/);
    assert.doesNotMatch(html, /code-tok/);
  });
});
