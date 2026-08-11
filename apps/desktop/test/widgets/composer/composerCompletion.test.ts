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
});
