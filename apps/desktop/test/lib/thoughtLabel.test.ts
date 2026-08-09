/**
 * Pure Thought label + auto-collapse helpers (shipped thoughtLabel.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatThoughtGroupLabel,
  formatThoughtLabel,
  shouldAutoCollapseThought,
} from "@/lib/thoughtLabel";
import type { TimelineItem } from "@grok-desktop/acp-core";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

function thought(partial: Partial<ThoughtItem> & { text: string }): ThoughtItem {
  return {
    kind: "thought",
    id: partial.id ?? "t1",
    text: partial.text,
    collapsed: partial.collapsed ?? true,
    startedAt: partial.startedAt ?? 0,
    completedAt: partial.completedAt,
  };
}

describe("formatThoughtLabel", () => {
  it("streaming label may include a short live body preview", () => {
    const item = thought({
      text: "The user wants a one-sentence demo intro that is quite long",
      startedAt: 1000,
      completedAt: undefined,
    });
    const label = formatThoughtLabel(item, "streaming");
    assert.match(label, /^Thinking…/);
    assert.match(label, / · /);
    assert.match(label, /The user wants/);
    // Cap preview length so the pill stays short.
    assert.ok(label.length < 80);
  });

  it("streaming without body text is bare Thinking…", () => {
    const item = thought({ text: "", startedAt: 1000 });
    assert.equal(formatThoughtLabel(item, "streaming"), "Thinking…");
  });

  it("completed label is duration-only with no English body preview", () => {
    const item = thought({
      text: "The user wants a one-sentence description of the demo workspace",
      startedAt: 1000,
      completedAt: 4000,
    });
    const label = formatThoughtLabel(item, "idle");
    assert.equal(label, "Thought for 3s");
    assert.doesNotMatch(label, /user wants|demo| · /);
  });

  it("completed without timestamps is bare Thought (no preview)", () => {
    const item = thought({
      text: "legacy cached reasoning without clocks",
      startedAt: 0,
      completedAt: undefined,
    });
    // Not streaming → no Thinking…; missing completedAt + non-streaming → Thought.
    assert.equal(formatThoughtLabel(item, "idle"), "Thought");
  });

  it("rounds duration up to at least 1s", () => {
    const item = thought({
      text: "x",
      startedAt: 1000,
      completedAt: 1200,
    });
    assert.equal(formatThoughtLabel(item, "idle"), "Thought for 1s");
  });
});

describe("formatThoughtGroupLabel", () => {
  it("sums duration and appends step count when count > 1", () => {
    assert.equal(formatThoughtGroupLabel(3000, 2), "Thought for 3s · 2 steps");
  });

  it("single-segment group omits step suffix", () => {
    assert.equal(formatThoughtGroupLabel(5000, 1), "Thought for 5s");
  });

  it("missing duration degrades without inventing seconds", () => {
    assert.equal(formatThoughtGroupLabel(0, 3), "Thought · 3 steps");
    assert.equal(formatThoughtGroupLabel(0, 1), "Thought");
  });
});

describe("shouldAutoCollapseThought", () => {
  it("collapses on the streaming → completed edge when user did not toggle", () => {
    assert.equal(
      shouldAutoCollapseThought({
        prevCompletedAt: undefined,
        completedAt: 5000,
        userToggled: false,
      }),
      true,
    );
  });

  it("does not collapse when the user already toggled", () => {
    assert.equal(
      shouldAutoCollapseThought({
        prevCompletedAt: undefined,
        completedAt: 5000,
        userToggled: true,
      }),
      false,
    );
  });

  it("does not re-collapse after already completed", () => {
    assert.equal(
      shouldAutoCollapseThought({
        prevCompletedAt: 5000,
        completedAt: 5000,
        userToggled: false,
      }),
      false,
    );
  });
});
