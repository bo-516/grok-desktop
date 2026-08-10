/**
 * Unit tests for the shared @mention / /command token parser.
 * Covers what both the composer mirror and the timeline chips depend on:
 * classification, lossless round-tripping, and the email false-positive guard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  caretJumpOverMention,
  deleteMentionUnit,
  hasMentionTokens,
  materializeMentionTriggers,
  mentionDisplayLabel,
  mentionKindClass,
  mentionUnitForBackspace,
  mentionUnitForDelete,
  MENTION_AT_MARK,
  MENTION_SLASH_MARK,
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
      assert.equal(parts[1].committed, false);
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

  it("leaves filesystem paths in a pasted shell line as plain text", () => {
    // Real timeline text: only the leading token can be a slash command, so
    // paths further in must not paint as commands.
    const source =
      'ls -la /Users/me/idea 2>/dev/null; pkill -f "npm run dev -w @pkg"';
    const parts = splitMentionTokens(source);
    assert.equal(
      parts
        .filter((p) => p.type === "mention")
        .some((p) => p.type === "mention" && p.kind === "command"),
      false,
    );
    assert.equal(parts.map((p) => p.text).join(""), source);
  });

  it("keeps a leading /command but not a leading absolute path", () => {
    const command = splitMentionTokens("/browser-use 弄完测一下");
    assert.equal(command[0]?.type, "mention");
    if (command[0]?.type === "mention") {
      assert.equal(command[0].kind, "command");
      assert.equal(command[0].text, "/browser-use");
    }

    const path = splitMentionTokens("/Users/me/idea is the root");
    assert.equal(
      path.some((p) => p.type === "mention"),
      false,
    );
  });

  it("stops @mentions before trailing sentence punctuation", () => {
    const source = 'compare @src/App.tsx, @README.md. and @"a b/c.ts"';
    const parts = splitMentionTokens(source);
    const mentions = parts.filter((p) => p.type === "mention");
    assert.deepEqual(
      mentions.map((p) => p.text),
      ["@src/App.tsx", "@README.md", '@"a b/c.ts"'],
    );
    assert.equal(parts.map((p) => p.text).join(""), source);
  });

  it("does not treat absolute @paths as workspace mentions", () => {
    const parts = splitMentionTokens("see @/etc/hosts ok");
    assert.equal(
      parts.some((p) => p.type === "mention"),
      false,
    );
  });

  it("keeps committed marks classified anywhere in the draft", () => {
    const parts = splitMentionTokens(`run ${MENTION_SLASH_MARK}review now`);
    const mention = parts.find((p) => p.type === "mention");
    assert.ok(mention && mention.type === "mention");
    if (mention?.type === "mention") {
      assert.equal(mention.kind, "command");
      assert.equal(mention.committed, true);
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

  it("marks only menu-picked tokens committed, so typed paths stay plain text", () => {
    const typed = splitMentionTokens("@doc");
    assert.equal(typed[0]?.type, "mention");
    if (typed[0]?.type === "mention") {
      assert.equal(typed[0].committed, false);
    }

    const picked = splitMentionTokens(`${MENTION_AT_MARK}docs/design`);
    assert.equal(picked[0]?.type, "mention");
    if (picked[0]?.type === "mention") {
      assert.equal(picked[0].committed, true);
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

  it("leaves typed @paths fully editable — they are not committed tokens", () => {
    const text = "@README.md";
    assert.equal(mentionUnitForBackspace(text, text.length), null);
    assert.equal(mentionUnitForDelete(text, 0), null);
    assert.equal(snapCaretToMentionEdge(text, 3), 3);
    assert.equal(caretJumpOverMention(text, text.length, "left"), null);
    assert.equal(caretJumpOverMention(text, 0, "right"), null);
  });

  it("jumps the caret over a committed path with one Left / Right", () => {
    // Mirrors a menu-picked file like docs/refactor-plan-drawer-2026-08-10.md.
    const path = "docs/refactor-plan-drawer-2026-08-10.md";
    const token = `${MENTION_AT_MARK}${path}`;
    const text = `see ${token} now`;
    const tokenStart = 4;
    const tokenEnd = tokenStart + token.length;

    // One Left from just after the chip lands before the body (token start).
    assert.equal(caretJumpOverMention(text, tokenEnd, "left"), tokenStart);
    // One Right from the leading edge lands after the whole chip.
    assert.equal(caretJumpOverMention(text, tokenStart, "right"), tokenEnd);
    // Inside the body also hops the full unit in the arrow direction.
    assert.equal(
      caretJumpOverMention(text, tokenStart + 5, "left"),
      tokenStart,
    );
    assert.equal(
      caretJumpOverMention(text, tokenStart + 5, "right"),
      tokenEnd,
    );
    // Outside the chip: browser keeps char-by-char motion.
    assert.equal(caretJumpOverMention(text, tokenEnd + 1, "left"), null);
    assert.equal(caretJumpOverMention(text, tokenStart, "left"), null);
    assert.equal(caretJumpOverMention(text, tokenEnd, "right"), null);
  });
});
