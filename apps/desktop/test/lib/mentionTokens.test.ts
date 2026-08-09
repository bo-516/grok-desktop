/**
 * Unit tests for the shared @mention / /command token parser.
 * Covers what both the composer mirror and the timeline chips depend on:
 * classification, lossless round-tripping, and the email false-positive guard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteMentionUnit,
  hasMentionTokens,
  materializeMentionTriggers,
  mentionDisplayLabel,
  mentionKindClass,
  mentionUnitForBackspace,
  mentionUnitForDelete,
  MENTION_AT_MARK,
  MENTION_SLASH_MARK,
  sealCompletedMentions,
  snapCaretToMentionEdge,
  splitMentionTokens,
  splitMentionTrigger,
} from "@/lib/mentionTokens";

describe("splitMentionTokens", () => {
  it("highlights @file tokens and leaves plain text", () => {
    const parts = splitMentionTokens("see @src/App.tsx please");
    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0], { type: "text", text: "see ", offset: 0 });
    assert.equal(parts[1]?.type, "mention");
    if (parts[1]?.type === "mention") {
      assert.equal(parts[1].text, "@src/App.tsx");
      assert.equal(parts[1].kind, "file");
      assert.equal(parts[1].trigger, "@");
      assert.equal(parts[1].body, "src/App.tsx");
      assert.equal(parts[1].offset, 4);
    }
    assert.deepEqual(parts[2], { type: "text", text: " please", offset: 16 });
  });

  it("gives repeated tokens distinct offsets so React keys cannot collide", () => {
    const parts = splitMentionTokens("@a.ts then @a.ts");
    const offsets = parts.map((part) => part.offset);
    assert.deepEqual(offsets, [...new Set(offsets)]);
    assert.deepEqual(offsets, [0, 5, 11]);
  });

  it("classifies extension-less paths as directories", () => {
    const parts = splitMentionTokens("@src/widgets");
    assert.equal(parts[0]?.type, "mention");
    if (parts[0]?.type === "mention") {
      assert.equal(parts[0].kind, "directory");
    }
  });

  it("highlights /commands with trigger and body parts", () => {
    const parts = splitMentionTokens("/review the change");
    assert.equal(parts[0]?.type, "mention");
    if (parts[0]?.type === "mention") {
      assert.equal(parts[0].text, "/review");
      assert.equal(parts[0].kind, "command");
      assert.equal(parts[0].trigger, "/");
      assert.equal(parts[0].body, "review");
    }
  });

  it("does not treat email addresses as mentions", () => {
    const parts = splitMentionTokens("mail me@x.com ok");
    const joined = parts.map((p) => p.text).join("");
    assert.equal(joined, "mail me@x.com ok");
    assert.equal(
      parts.some((p) => p.type === "mention"),
      false,
    );
  });

  it("keeps quoted @paths with spaces as one file chip", () => {
    const parts = splitMentionTokens('read @"design docs/brief.md" now');
    const mention = parts.find((p) => p.type === "mention");
    assert.ok(mention && mention.type === "mention");
    if (mention?.type === "mention") {
      assert.equal(mention.text, '@"design docs/brief.md"');
      assert.equal(mention.kind, "file");
      assert.equal(mention.trigger, "@");
      assert.equal(mention.body, '"design docs/brief.md"');
    }
  });

  it("round-trips the source text so the mirror layer stays caret-accurate", () => {
    const source = '/always-approve @README.md and @"a b/c.ts"\nsecond line';
    const joined = splitMentionTokens(source)
      .map((part) => part.text)
      .join("");
    assert.equal(joined, source);
  });
});

describe("splitMentionTrigger", () => {
  it("splits trigger from body for @ and /", () => {
    assert.deepEqual(splitMentionTrigger("@README.md"), {
      trigger: "@",
      body: "README.md",
    });
    assert.deepEqual(splitMentionTrigger("/compact"), {
      trigger: "/",
      body: "compact",
    });
  });

  it("treats untriggered text as a pure body so chips still get a label", () => {
    assert.deepEqual(splitMentionTrigger("README.md"), {
      trigger: "",
      body: "README.md",
    });
  });
});

describe("mentionDisplayLabel", () => {
  it("drops agent-side quoting from paths with spaces", () => {
    assert.equal(mentionDisplayLabel('"design docs/brief.md"'), "design docs/brief.md");
    assert.equal(mentionDisplayLabel("src/App.tsx"), "src/App.tsx");
  });
});

describe("hasMentionTokens", () => {
  it("is true only when a chip would be rendered", () => {
    assert.equal(hasMentionTokens("plain message"), false);
    assert.equal(hasMentionTokens("ping me@x.com"), false);
    assert.equal(hasMentionTokens("check @README.md"), true);
    assert.equal(hasMentionTokens("/review"), true);
  });
});

describe("mentionKindClass", () => {
  it("maps kinds to the tint classes shared by chips and the mirror layer", () => {
    assert.equal(mentionKindClass("file"), "mention-file");
    assert.equal(mentionKindClass("directory"), "mention-dir");
    assert.equal(mentionKindClass("command"), "mention-command");
  });
});

describe("zero-width composer marks", () => {
  it("parses sealed marks as mentions and materializes them for the agent", () => {
    const draft = `${MENTION_SLASH_MARK}always-approve ${MENTION_AT_MARK}README.md`;
    const parts = splitMentionTokens(draft);
    assert.equal(parts.filter((p) => p.type === "mention").length, 2);
    assert.equal(
      materializeMentionTriggers(draft),
      "/always-approve @README.md",
    );
  });

  it("seals a completed visible trigger once it is followed by whitespace", () => {
    const sealed = sealCompletedMentions("/always-approve @README.md ", 26);
    assert.equal(
      sealed.value,
      `${MENTION_SLASH_MARK}always-approve ${MENTION_AT_MARK}README.md `,
    );
    assert.equal(sealed.caret, 26);
  });

  it("does not seal a token the caret is still editing", () => {
    const mid = sealCompletedMentions("/always-approve ", 8);
    assert.equal(mid.value, "/always-approve ");
  });

  it("deletes a mention as one unit on Backspace from its end", () => {
    const token = `${MENTION_SLASH_MARK}always-approve`;
    const text = `${token} more`;
    const unit = mentionUnitForBackspace(text, token.length);
    assert.ok(unit);
    if (!unit) {
      return;
    }
    assert.deepEqual(deleteMentionUnit(text, unit), {
      value: " more",
      caret: 0,
    });
  });

  it("deletes a mention as one unit on Delete from its start", () => {
    const text = `go ${MENTION_AT_MARK}README.md`;
    const unit = mentionUnitForDelete(text, 3);
    assert.ok(unit);
    if (!unit) {
      return;
    }
    assert.deepEqual(deleteMentionUnit(text, unit), {
      value: "go ",
      caret: 3,
    });
  });

  it("snaps a caret inside a mention to the nearer edge", () => {
    const text = `${MENTION_AT_MARK}README.md`;
    assert.equal(snapCaretToMentionEdge(text, 3), 0);
    assert.equal(snapCaretToMentionEdge(text, 7), text.length);
  });
});
