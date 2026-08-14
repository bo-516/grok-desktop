/**
 * Completion pick planner: `/model` / `/effort` args apply; command names insert.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENTION_SLASH_MARK } from "@/lib/mentionTokens";
import { planSuggestionPick } from "@/widgets/composer/composerPick";

const CATALOG = {
  models: [
    { id: "grok-4.6", label: "Grok 4.6" },
    { id: "grok-4.5", label: "Grok 4.5" },
  ],
  availableModels: [
    {
      id: "grok-4.6",
      name: "Grok 4.6",
      reasoningEfforts: [
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    },
    {
      id: "grok-4.5",
      name: "Grok 4.5",
      reasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
    },
  ],
};

describe("planSuggestionPick", () => {
  it("applies a /model argument instead of leaving it in the draft", () => {
    const plan = planSuggestionPick("/model ", 7, "grok-4.6", CATALOG);
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") {
      return;
    }
    assert.match(plan.draft, /^\/model grok-4\.6\s*$/);
  });

  it("applies a trailing /model effort token together with the model", () => {
    const draft = "/model grok-4.6 ";
    const plan = planSuggestionPick(draft, draft.length, "xhigh", CATALOG);
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") {
      return;
    }
    assert.match(plan.draft, /grok-4\.6 xhigh/);
  });

  it("applies a /effort argument on the current model", () => {
    const plan = planSuggestionPick("/effort ", 8, "high", {
      ...CATALOG,
      currentModel: "grok-4.6",
    });
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") {
      return;
    }
    assert.match(plan.draft, /^\/effort high\s*$/);
  });

  it("inserts a command name so the argument list can open", () => {
    const plan = planSuggestionPick("/mod", 4, "model", CATALOG);
    assert.equal(plan.kind, "insert");
    if (plan.kind !== "insert") {
      return;
    }
    assert.equal(plan.value.startsWith(MENTION_SLASH_MARK), true);
    assert.match(plan.value, /model /);
  });

  it("inserts skills and @files instead of applying chrome", () => {
    const skill = planSuggestionPick("/imp", 4, "implement");
    assert.equal(skill.kind, "insert");
    const mention = planSuggestionPick("See @src", 8, "src/App.tsx");
    assert.equal(mention.kind, "insert");
    if (mention.kind !== "insert") {
      return;
    }
    assert.match(mention.value, /src\/App\.tsx/);
  });

  it("returns none when the caret is not on a trigger", () => {
    const plan = planSuggestionPick("hello there", 5, "grok-4.6", CATALOG);
    assert.equal(plan.kind, "none");
  });

  it("applies /fork and /rewind on pick instead of inserting a chip", () => {
    const fork = planSuggestionPick("/fo", 3, "fork");
    assert.equal(fork.kind, "apply");
    const rewind = planSuggestionPick("/rew", 4, "rewind");
    assert.equal(rewind.kind, "apply");
    const compact = planSuggestionPick("/comp", 5, "compact");
    assert.equal(compact.kind, "insert");
  });
});
