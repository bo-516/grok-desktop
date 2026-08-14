/**
 * Session rail rename helpers: sanitize, catalog lock, canvas re-stamp.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  applyLockedCatalogTitle,
  railSessionTitle,
  renameCatalogSession,
  sanitizeSessionTitle,
  SESSION_TITLE_MAX_LEN,
} from "@/lib/sessionTitleEdit";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal catalog row for rename tests.
 * @param partial Overrides including required id.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "/ws",
    title: partial.title ?? partial.id,
    titleLocked: partial.titleLocked,
    mode: "build",
    model: "",
    status: "idle",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

describe("sanitizeSessionTitle", () => {
  it("trims, collapses whitespace, and clips to the catalog max", () => {
    assert.equal(sanitizeSessionTitle("  hello   world  "), "hello world");
    assert.equal(sanitizeSessionTitle("\nfoo\tbar\n"), "foo bar");
    assert.equal(sanitizeSessionTitle("   "), "");
    const long = "a".repeat(SESSION_TITLE_MAX_LEN + 20);
    assert.equal(sanitizeSessionTitle(long).length, SESSION_TITLE_MAX_LEN);
  });
});

describe("railSessionTitle", () => {
  it("shows a locked title as typed and rewrites unlocked placeholders", () => {
    assert.equal(
      railSessionTitle({ title: "Untitled chat", titleLocked: true }),
      "Untitled chat",
    );
    assert.equal(
      railSessionTitle({ title: "Chat 019fd68e" }),
      "Untitled chat",
    );
    assert.equal(railSessionTitle({ title: "Fix login" }), "Fix login");
  });
});

describe("renameCatalogSession", () => {
  it("locks the chosen title and leaves other rows / recency alone", () => {
    const catalog = [
      rec({ id: "a", title: "Old A", updatedAt: 10 }),
      rec({ id: "b", title: "Old B", updatedAt: 20 }),
    ];
    const next = renameCatalogSession(catalog, "a", "  New name  ");
    assert.notEqual(next, catalog);
    assert.equal(next[0]?.title, "New name");
    assert.equal(next[0]?.titleLocked, true);
    assert.equal(next[0]?.updatedAt, 10);
    assert.equal(next[1]?.title, "Old B");
    assert.equal(next[1]?.titleLocked, undefined);
  });

  it("no-ops on empty input, unknown id, or an already-locked same title", () => {
    const catalog = [rec({ id: "a", title: "Same", titleLocked: true })];
    assert.equal(renameCatalogSession(catalog, "a", "   "), catalog);
    assert.equal(renameCatalogSession(catalog, "missing", "Nope"), catalog);
    assert.equal(renameCatalogSession(catalog, "a", "Same"), catalog);
  });
});

describe("applyLockedCatalogTitle", () => {
  it("restamps a locked catalog title onto a canvas snapshot", () => {
    const session = createSessionState({ id: "s1" });
    session.title = "Agent just renamed this";
    const locked = applyLockedCatalogTitle(session, [
      { id: "s1", title: "My name", titleLocked: true },
    ]);
    assert.equal(locked.title, "My name");
    const unlocked = applyLockedCatalogTitle(session, [
      { id: "s1", title: "My name" },
    ]);
    assert.equal(unlocked.title, "Agent just renamed this");
    assert.equal(applyLockedCatalogTitle(session, undefined), session);
  });
});
