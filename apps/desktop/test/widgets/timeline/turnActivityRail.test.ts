/**
 * Live turn-rail must follow thought / tool growth inside the capped scroller.
 * History / compact rails must not jump to the tail on expand.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readDesktopRoot, readSrc } from "../../helpers/sourceFiles";

describe("turn activity rail follow-scroll", () => {
  it("live rails stick to bottom via ResizeObserver on the inner body", () => {
    const rail = readSrc("widgets/timeline/TurnActivityRailView.tsx");
    const hook = readSrc("widgets/timeline/useTurnRailStickToBottom.ts");
    assert.match(rail, /useTurnRailStickToBottom/);
    assert.match(rail, /enabled:\s*live && !compact/);
    assert.match(rail, /turn-rail-body/);
    assert.match(rail, /onScroll=\{handleScroll\}/);
    assert.match(hook, /ResizeObserver/);
    assert.match(hook, /scrollTopForBottom/);
    assert.match(hook, /isScrollNearBottom/);
    assert.match(hook, /shouldRepinOnEnable/);
    assert.match(hook, /firstElementChild/);
  });

  it("TurnBlockWidget forwards compact so inspect does not inner-scroll", () => {
    const block = readSrc("widgets/timeline/TurnBlockWidget.tsx");
    assert.match(block, /compact=\{compact\}/);
  });

  it("expanded live thoughts follow new text inside the turn-rail", () => {
    const thought = readSrc("widgets/timeline/ThoughtWidget.tsx");
    const group = readSrc("widgets/timeline/ThoughtGroupView.tsx");
    const follow = readSrc("widgets/timeline/useFollowThoughtInRail.ts");
    assert.match(thought, /useFollowThoughtInRail/);
    assert.match(thought, /enabled:\s*isLive/);
    assert.match(thought, /bodyRef/);
    assert.match(group, /useFollowThoughtInRail/);
    assert.match(group, /enabled:\s*lastLive/);
    assert.match(follow, /data-kind='turn-rail'/);
    assert.match(follow, /stickRef/);
    assert.match(follow, /scrollDeltaToAlignBottoms/);
    assert.match(follow, /isEdgeNear/);
    assert.doesNotMatch(follow, /scrollIntoView\s*\(/);
  });

  it("turn-rail-body shortcut owns the step gap", () => {
    const shortcuts = readDesktopRoot("uno/shortcuts.timeline.ts");
    assert.match(
      shortcuts,
      /"turn-rail-body":\s*"flex flex-col gap-1/,
    );
    assert.match(shortcuts, /"turn-rail":\s*"flex flex-col pl-3/);
    assert.doesNotMatch(
      shortcuts,
      /"turn-rail":\s*"flex flex-col gap-1 pl-3/,
    );
  });
});
