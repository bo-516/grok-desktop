/** Pure-rule tests for Composer `@` and `/skill` completion. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MENTION_AT_MARK,
  MENTION_SLASH_MARK,
} from "@/lib/mentionTokens";
import {
  createCommandSuggestions,
  createMentionSuggestions,
  findComposerTrigger,
  getComposerEmptyLabel,
  replaceComposerTrigger,
} from "@/widgets/composer/composerCompletion";

const MODEL_CATALOG = {
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
      reasoningEfforts: [
        { id: "low" },
        { id: "medium" },
        { id: "high", label: "High" },
      ],
    },
  ],
};

describe("composerCompletion", () => {
  it("detects a file mention at the current caret without matching email text", () => {
    const mention = findComposerTrigger("Check @src/com", 14);
    // Non-email prefix (`)`) before `@` still opens a mention; emails like a@x.ai do not.
    const nonEmailPrefixMention = findComposerTrigger("ok)@src/com", 11);
    const email = findComposerTrigger("contact a@x.ai", 14);

    assert.deepEqual(mention, {
      kind: "mention",
      symbol: "@",
      query: "src/com",
      start: 6,
      end: 14,
    });
    assert.deepEqual(nonEmailPrefixMention, {
      kind: "mention",
      symbol: "@",
      query: "src/com",
      start: 3,
      end: 11,
    });
    assert.equal(email, null);
  });

  it("replaces the active slash token with a zero-width mark and keeps following text", () => {
    const trigger = findComposerTrigger("Run /impl then test", 9);
    assert.ok(trigger);
    if (!trigger) {return;}

    assert.deepEqual(
      replaceComposerTrigger("Run /impl then test", trigger, "implement"),
      {
        value: `Run ${MENTION_SLASH_MARK}implement then test`,
        caret: 14,
      },
    );
  });

  it("labels agent metadata with a skill scope as a skill", () => {
    const suggestions = createCommandSuggestions(
      [
        { name: "compact", description: "Compress" },
        {
          name: "implement",
          description: "Implement a task",
          input: { hint: "<description>" },
          _meta: { scope: "bundled" },
        },
      ],
      "imp",
    );

    assert.deepEqual(suggestions, [
      {
        id: "command:implement",
        kind: "skill",
        value: "implement",
        label: "/implement",
        description: "Implement a task",
        inputHint: "<description>",
      },
    ]);
  });

  it("keeps the full grok-build slash catalog instead of cutting to 10 rows", () => {
    const commands = Array.from({ length: 16 }, (_, i) => ({
      name: `cmd-${String(i).padStart(2, "0")}`,
      description: `Command ${i}`,
    }));
    const suggestions = createCommandSuggestions(commands, "");
    assert.equal(suggestions.length, 16);
    assert.equal(suggestions[15]?.value, "cmd-15");
  });

  it("keeps bridge files as real relative-path mention candidates", () => {
    const suggestions = createMentionSuggestions(
      [
        { path: "src/widgets/ComposerWidget.tsx", kind: "file" },
        { path: "src/widgets", kind: "directory" },
      ],
      "composer",
    );

    assert.equal(suggestions[0]?.value, "src/widgets/ComposerWidget.tsx");
    assert.equal(suggestions[0]?.kind, "file");
  });

  it("matches absolute and file:// queries against relative bridge entries", () => {
    const workspace = "/Users/me/proj";
    const entries = [
      { path: "apps/desktop/src/widgets/timeline/TimelineView.tsx", kind: "file" as const },
      { path: "apps/desktop/src/widgets", kind: "directory" as const },
    ];
    const abs =
      "/Users/me/proj/apps/desktop/src/widgets/timeline/TimelineView.tsx";
    const byAbs = createMentionSuggestions(entries, abs, workspace);
    const byUri = createMentionSuggestions(
      entries,
      `file://${abs}`,
      workspace,
    );
    const byOutside = createMentionSuggestions(
      entries,
      "/tmp/other/apps/desktop/src/widgets/timeline/TimelineView.tsx",
      workspace,
    );

    assert.equal(byAbs.length, 1);
    assert.equal(
      byAbs[0]?.value,
      "apps/desktop/src/widgets/timeline/TimelineView.tsx",
    );
    assert.equal(byUri.length, 1);
    assert.equal(byOutside.length, 0);
  });

  it("quotes a selected file path that contains spaces using the @ mark", () => {
    const trigger = findComposerTrigger("Read @des", 9);
    assert.ok(trigger);
    if (!trigger) {return;}

    assert.deepEqual(
      replaceComposerTrigger("Read @des", trigger, "design docs/brief.md"),
      {
        value: `Read ${MENTION_AT_MARK}"design docs/brief.md" `,
        caret: 29,
      },
    );
  });

  it("explains that a live bridge request failed instead of claiming no files exist", () => {
    assert.equal(
      getComposerEmptyLabel("mention", false, true, true),
      "Could not read the workspace. Restart the bridge and try again.",
    );
  });

  it("keeps /model open for argument completion and does not reseal a slash mark", () => {
    const afterName = findComposerTrigger("/model ", 7, MODEL_CATALOG);
    assert.equal(afterName?.argCommand, "model");
    assert.equal(afterName?.query, "");
    const models = createCommandSuggestions([], "4.6", {
      argCommand: "model",
      ...MODEL_CATALOG,
    });
    assert.equal(models.length, 1);
    assert.equal(models[0]?.value, "grok-4.6");
    assert.equal(models[0]?.label, "Grok 4.6");

    assert.ok(afterName);
    if (!afterName) {
      return;
    }
    const inserted = replaceComposerTrigger("/model ", afterName, "grok-4.6");
    assert.equal(inserted.value.startsWith("/model grok-4.6"), true);
    assert.doesNotMatch(inserted.value, new RegExp(MENTION_SLASH_MARK));

    const effortSlot = findComposerTrigger(
      "/model grok-4.6 xh",
      18,
      MODEL_CATALOG,
    );
    assert.equal(effortSlot?.argCommand, "effort");
    assert.equal(effortSlot?.argModelId, "grok-4.6");
    assert.equal(effortSlot?.query, "xh");
    const efforts = createCommandSuggestions([], "xh", {
      argCommand: "effort",
      argModelId: "grok-4.6",
      ...MODEL_CATALOG,
    });
    assert.equal(efforts[0]?.value, "xhigh");

    const on45 = findComposerTrigger("/model grok-4.5 ", 16, MODEL_CATALOG);
    assert.equal(on45?.argCommand, "effort");
    assert.equal(on45?.argModelId, "grok-4.5");
    const efforts45 = createCommandSuggestions([], "", {
      argCommand: "effort",
      argModelId: "grok-4.5",
      ...MODEL_CATALOG,
    });
    assert.deepEqual(
      efforts45.map((row) => row.value),
      ["low", "medium", "high"],
    );
    assert.ok(!efforts45.some((row) => row.value === "xhigh"));
  });

  it("does not claim slash commands are still waiting when the catalog is ready", () => {
    assert.equal(
      getComposerEmptyLabel("command", false, true, false, {
        catalogSize: 8,
        connectionMode: "live-bridge",
        isLoadingCatalog: false,
      }),
      "No matching commands",
    );
    assert.equal(
      getComposerEmptyLabel("command", false, true, false, {
        catalogSize: 0,
        connectionMode: "connecting",
        isLoadingCatalog: false,
      }),
      "Loading commands…",
    );
    assert.equal(
      getComposerEmptyLabel("command", false, true, false, {
        catalogSize: 0,
        connectionMode: "disconnected",
        isLoadingCatalog: false,
      }),
      "Connect the bridge to load commands",
    );
    assert.doesNotMatch(
      getComposerEmptyLabel("command", false, true, false, {
        catalogSize: 0,
        connectionMode: "live-bridge",
        isLoadingCatalog: false,
      }),
      /Waiting for live grok-build/,
    );
  });
});
