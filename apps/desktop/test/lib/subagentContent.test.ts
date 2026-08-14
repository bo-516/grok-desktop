/**
 * Four-level local content resolver + cycle-order expansion.
 * Drives the shipped functions — not a copy of the priority chain.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
  type SubagentCard,
} from "@grok-desktop/acp-core";
import { groupSubagentsByRound } from "@/lib/agentCards";
import {
  orderedSubagentSessionIds,
  resolveSubagentContent,
  resolveSubagentTranscriptPresentation,
  sessionHasTranscript,
  type SubagentContentSources,
} from "@/lib/subagentContent";
import type { SessionRecord } from "@/store/sessionCatalogTypes";

/**
 * Minimal orchestration card for resolver tests.
 * @param partial Overrides; `subagentId` is required.
 */
function makeCard(
  partial: Partial<SubagentCard> & { subagentId: string },
): SubagentCard {
  return {
    childSessionId: partial.childSessionId ?? partial.subagentId,
    type: "general-purpose",
    description: partial.description ?? partial.subagentId,
    status: "completed",
    ...partial,
  };
}

/**
 * Session snapshot with a single user line so `sessionHasTranscript` is true.
 * @param id Session id.
 * @param text User text to seed.
 */
function sessionWithText(id: string, text: string): SessionState {
  const state = createSessionState({ id, workspace: "/w" });
  return {
    ...state,
    lastAgentText: text,
    timeline: [
      {
        id: `${id}-u`,
        kind: "user",
        blocks: [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Catalog row carrying the same transcript as {@link sessionWithText}.
 * @param id Session id.
 * @param text Cached last-agent / user text.
 */
function catalogRow(id: string, text: string): SessionRecord {
  return {
    id,
    workspace: "/w",
    title: text,
    mode: "build",
    model: "grok",
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
    timeline: [
      {
        id: `${id}-u`,
        kind: "user",
        blocks: [{ type: "text", text }],
      },
    ],
    toolCalls: {},
    lastAgentText: text,
  };
}

/** Empty source bag used as the default miss-all baseline. */
const EMPTY: SubagentContentSources = {
  childSessions: {},
  pendingSessions: {},
  catalog: [],
};

describe("resolveSubagentContent", () => {
  it("returns unavailable when every source is empty", () => {
    const got = resolveSubagentContent("child-1", EMPTY, undefined);
    assert.equal(got.kind, "unavailable");
  });

  it("live buffer beats pending, catalog, and card.output", () => {
    const live = sessionWithText("child-1", "live text");
    const pending = sessionWithText("child-1", "pending text");
    const sources: SubagentContentSources = {
      childSessions: { "child-1": live },
      pendingSessions: { "child-1": pending },
      catalog: [catalogRow("child-1", "cached text")],
    };
    const card = makeCard({
      subagentId: "sa-1",
      childSessionId: "child-1",
      output: "finished output",
    });
    const got = resolveSubagentContent("child-1", sources, card);
    assert.equal(got.kind, "live");
    if (got.kind !== "live") {
      return;
    }
    assert.equal(got.state.lastAgentText, "live text");
  });

  it("pending buffer is live when childSessions has no row", () => {
    const pending = sessionWithText("child-1", "pending text");
    const sources: SubagentContentSources = {
      childSessions: {},
      pendingSessions: { "child-1": pending },
      catalog: [catalogRow("child-1", "cached text")],
    };
    const got = resolveSubagentContent(
      "child-1",
      sources,
      makeCard({
        subagentId: "sa-1",
        childSessionId: "child-1",
        output: "finished output",
      }),
    );
    assert.equal(got.kind, "live");
    if (got.kind !== "live") {
      return;
    }
    assert.equal(got.state.lastAgentText, "pending text");
  });

  it("catalog snapshot is cached and beats card.output", () => {
    const sources: SubagentContentSources = {
      childSessions: {},
      pendingSessions: {},
      catalog: [catalogRow("child-1", "cached text")],
    };
    const got = resolveSubagentContent(
      "child-1",
      sources,
      makeCard({
        subagentId: "sa-1",
        childSessionId: "child-1",
        output: "finished output",
      }),
    );
    assert.equal(got.kind, "cached");
    if (got.kind !== "cached") {
      return;
    }
    assert.equal(got.state.lastAgentText, "cached text");
    assert.ok(sessionHasTranscript(got.state));
  });

  it("falls through to outputOnly when only card.output exists", () => {
    const got = resolveSubagentContent(
      "child-1",
      EMPTY,
      makeCard({
        subagentId: "sa-1",
        childSessionId: "child-1",
        output: "finished output only",
      }),
    );
    assert.equal(got.kind, "outputOnly");
    if (got.kind !== "outputOnly") {
      return;
    }
    assert.equal(got.text, "finished output only");
  });

  it("blank child id is unavailable", () => {
    const got = resolveSubagentContent(
      "  ",
      {
        childSessions: { "child-1": sessionWithText("child-1", "x") },
        pendingSessions: {},
        catalog: [],
      },
      undefined,
    );
    assert.equal(got.kind, "unavailable");
  });
});

describe("orderedSubagentSessionIds", () => {
  it("matches groupSubagentsByRound order (round, then spawn)", () => {
    const subagents: Record<string, SubagentCard> = {
      a: makeCard({
        subagentId: "a",
        childSessionId: "c-a",
        parentPromptId: "round-1",
      }),
      b: makeCard({
        subagentId: "b",
        childSessionId: "c-b",
        parentPromptId: "round-1",
      }),
      c: makeCard({
        subagentId: "c",
        childSessionId: "c-c",
        parentPromptId: "round-2",
      }),
      d: makeCard({
        subagentId: "d",
        childSessionId: "c-d",
      }),
    };
    const fromHelper = orderedSubagentSessionIds(subagents);
    const fromRounds = groupSubagentsByRound(subagents).flatMap((round) =>
      round.cards.map((card) => card.childSessionId),
    );
    assert.deepEqual(fromHelper, fromRounds);
    assert.deepEqual(fromHelper, ["c-a", "c-b", "c-c", "c-d"]);
  });
});

describe("resolveSubagentTranscriptPresentation", () => {
  it("live empty + running is pending (never a blank body)", () => {
    const empty = createSessionState({ id: "child-1", workspace: "" });
    const got = resolveSubagentTranscriptPresentation({
      content: { kind: "live", state: empty },
      card: makeCard({
        subagentId: "sa-1",
        childSessionId: "child-1",
        status: "running",
      }),
      startedAtMs: 1_000,
      nowMs: 6_000,
    });
    assert.equal(got.kind, "pending");
    if (got.kind !== "pending") {
      return;
    }
    assert.ok(got.elapsed.length > 0);
  });

  it("failed + no transcript still has a non-blank message", () => {
    const got = resolveSubagentTranscriptPresentation({
      content: { kind: "unavailable" },
      card: makeCard({
        subagentId: "sa-1",
        childSessionId: "child-1",
        status: "failed",
      }),
    });
    assert.equal(got.kind, "unavailable");
    if (got.kind !== "unavailable") {
      return;
    }
    assert.ok(got.message.trim().length > 0);
    assert.ok(got.error);
  });
});
