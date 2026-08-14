/**
 * renameSessionAction writes a locked catalog title and stamps the canvas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import { renameSessionAction } from "@/store/sessionStoreRename";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "@/store/sessionStoreTypes";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal catalog row for the rename action harness.
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
    createdAt: 1,
    updatedAt: 1,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

/**
 * Mutable store slice the rename action reads/writes.
 * @param catalog Starting catalog.
 * @param sessionId Canvas session id (may differ from the renamed row).
 */
function makeHarness(catalog: SessionRecord[], sessionId: string) {
  let state = {
    catalog,
    session: createSessionState({ id: sessionId, workspace: "/ws" }),
  };
  const get = (() => state) as SessionStoreGet;
  const set: SessionStoreSet = (partial) => {
    const patch =
      typeof partial === "function"
        ? partial(state as unknown as SessionStore)
        : partial;
    state = { ...state, ...patch };
  };
  return { getState: () => state, set, get };
}

describe("renameSessionAction", () => {
  it("locks the catalog title and updates the open canvas when ids match", () => {
    const h = makeHarness(
      [rec({ id: "s1", title: "Old title" })],
      "s1",
    );
    h.getState().session.title = "Old title";
    renameSessionAction(h.set, h.get, "s1", "  Renamed chat  ");
    assert.equal(h.getState().catalog[0]?.title, "Renamed chat");
    assert.equal(h.getState().catalog[0]?.titleLocked, true);
    assert.equal(h.getState().session.title, "Renamed chat");
  });

  it("does not touch the canvas when renaming a background session", () => {
    const h = makeHarness(
      [
        rec({ id: "open", title: "Open" }),
        rec({ id: "bg", title: "Background" }),
      ],
      "open",
    );
    h.getState().session.title = "Open";
    renameSessionAction(h.set, h.get, "bg", "New background");
    assert.equal(h.getState().catalog[1]?.title, "New background");
    assert.equal(h.getState().session.title, "Open");
  });

  it("ignores empty titles and unknown ids", () => {
    const h = makeHarness([rec({ id: "s1", title: "Keep" })], "s1");
    renameSessionAction(h.set, h.get, "s1", "   ");
    renameSessionAction(h.set, h.get, "missing", "Nope");
    assert.equal(h.getState().catalog[0]?.title, "Keep");
    assert.equal(h.getState().catalog[0]?.titleLocked, undefined);
  });
});
