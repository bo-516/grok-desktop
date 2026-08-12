/**
 * Project grouping + title + upsert tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  filterCatalogForSessionRail,
  mergeRemoteSessionsIntoCatalog,
} from "@/lib/sessionActions";
import {
  formatRelativeTime,
  groupSessionsByProject,
  groupSessionsByTime,
  isNoProjectSession,
  isWeakSessionTitle,
  pickSessionTitle,
  projectNameFromWorkspace,
  pruneEmptyWeakSessions,
  rehydrateCatalogTitles,
  resolveCatalogUpdatedAt,
  splitNoProjectSessions,
  timeBucketFor,
  upsertFromLiveState,
  type SessionRecord,
} from "@/store/sessionCatalog";

describe("sessionCatalog", () => {
  it("projectNameFromWorkspace uses basename", () => {
    assert.equal(
      projectNameFromWorkspace("/Users/me/code/grok-desktop/demo"),
      "demo",
    );
  });

  it("isWeakSessionTitle detects id placeholders", () => {
    assert.equal(isWeakSessionTitle("Session 019fd68e"), true);
    assert.equal(isWeakSessionTitle("session 019fd68e"), true);
    assert.equal(isWeakSessionTitle("Chat 019fd68e"), true);
    assert.equal(isWeakSessionTitle("Chat 019fd6c4"), true);
    assert.equal(isWeakSessionTitle("(no summary)"), true);
    assert.equal(isWeakSessionTitle("no summary"), true);
    assert.equal(isWeakSessionTitle("Untitled chat"), true);
    assert.equal(isWeakSessionTitle("untitled"), true);
    assert.equal(isWeakSessionTitle("Untitled session"), true);
    assert.equal(
      isWeakSessionTitle("UI UX Design Agent Style Codex Claude"),
      false,
    );
    assert.equal(isWeakSessionTitle("Fix the average function"), false);
  });

  it("pickSessionTitle prefers user message over id", () => {
    const state = createSessionState({
      id: "019fd68e-1f9f-76c3-91d4-ed487503dc51",
      workspace: "/proj/demo",
    });
    state.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "Fix the average function" }],
      },
    ];
    assert.equal(
      pickSessionTitle({ state, existingTitle: "Session 019fd68e" }),
      "Fix the average function",
    );
  });

  it("upsert does not clobber rich timeline with empty handshake", () => {
    const rich = createSessionState({
      id: "s1",
      workspace: "/proj/demo",
    });
    rich.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "Hello world prompt" }],
      },
      { kind: "agent", id: "a1", text: "Hi there" },
    ];
    let cat = upsertFromLiveState([], rich, 1000);
    assert.equal(cat[0]?.title, "Hello world prompt");
    assert.equal(cat[0]?.timeline.length, 2);

    const empty = createSessionState({
      id: "s1",
      workspace: "/proj/demo",
    });
    cat = upsertFromLiveState(cat, empty, 2000);
    assert.equal(cat[0]?.timeline.length, 2);
    assert.equal(cat[0]?.title, "Hello world prompt");
    // Empty handshake must not advance recency (select/resume reordering).
    assert.equal(cat[0]?.updatedAt, 1000);
  });

  it("upsertFromLiveState preserves sessionKind and parentSessionId from catalog", () => {
    // Product path: disk/list merge stamps role fields, then live hydrate
    // (Tasks drill-down → session/load → applyInbound) rebuilds the row.
    // Live SessionState has no session_kind — wipe would re-show the child in the rail.
    const childId = "019feb2e-97ef-0000-0000-000000000001";
    const parentId = "019feb2e-5fe5-0000-0000-000000000001";
    const withKind = mergeRemoteSessionsIntoCatalog(
      [],
      [
        {
          id: childId,
          title: "goal plan writer",
          workspace: "/ws",
          sessionKind: "subagent",
          parentSessionId: parentId,
          updatedAt: "2026-08-09T12:00:00.000Z",
        },
        {
          id: parentId,
          title: "Parent goal chat",
          workspace: "/ws",
          updatedAt: "2026-08-09T13:00:00.000Z",
        },
      ],
      1000,
    );
    const childBefore = withKind.find((r) => r.id === childId);
    assert.equal(childBefore?.sessionKind, "subagent");
    assert.equal(childBefore?.parentSessionId, parentId);
    assert.equal(filterCatalogForSessionRail(withKind).length, 1);

    // Real shipped upsert: live state after session/load for the child.
    const live = createSessionState({ id: childId, workspace: "/ws" });
    live.timeline = [
      {
        kind: "agent",
        id: "a1",
        text: "child timeline body",
      },
    ];
    live.status = "idle";
    const afterUpsert = upsertFromLiveState(withKind, live, 5000);
    const childAfter = afterUpsert.find((r) => r.id === childId);
    assert.ok(childAfter);
    assert.equal(childAfter?.sessionKind, "subagent");
    assert.equal(childAfter?.parentSessionId, parentId);
    assert.equal(childAfter?.timeline.length, 1);
    // Rail still hides the subagent after live hydrate (criteria 3–4).
    const rail = filterCatalogForSessionRail(afterUpsert);
    assert.equal(rail.length, 1);
    assert.equal(rail[0]?.id, parentId);
    assert.equal(
      rail.some((r) => r.id === childId),
      false,
    );
  });

  it("resource embed blocks change activity without using type names as text", () => {
    const withText = createSessionState({
      id: "s-embed",
      workspace: "/proj/demo",
    });
    withText.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "see this" }],
      },
    ];
    withText.lastAgentText = "";
    let cat = upsertFromLiveState([], withText, 1000);
    assert.equal(cat[0]?.updatedAt, 1000);

    // Same text + resource attach must advance recency (real new send payload).
    const withResource = createSessionState({
      id: "s-embed",
      workspace: "/proj/demo",
    });
    withResource.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [
          { type: "text", text: "see this" },
          {
            type: "resource",
            resource: {
              uri: "file:///proj/demo/docs/a.md",
              text: "body",
            },
          },
        ],
      },
    ];
    withResource.lastAgentText = "";
    cat = upsertFromLiveState(cat, withResource, 2000);
    assert.equal(cat[0]?.updatedAt, 2000);

    // Title / catalog fields must not absorb the literal "resource" type token.
    assert.doesNotMatch(cat[0]?.title ?? "", /resource/);
  });

  it("upsert advances updatedAt only when user/agent message content changes", () => {
    const base = createSessionState({
      id: "s-recency",
      workspace: "/proj/demo",
    });
    base.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "first prompt" }],
      },
    ];
    base.lastAgentText = "";
    let cat = upsertFromLiveState([], base, 1000);
    assert.equal(cat[0]?.updatedAt, 1000);

    // Status-only / select resume with same messages — keep prior updatedAt.
    const same = createSessionState({
      id: "s-recency",
      workspace: "/proj/demo",
    });
    same.timeline = base.timeline;
    same.lastAgentText = "";
    same.status = "idle";
    cat = upsertFromLiveState(cat, same, 5000);
    assert.equal(cat[0]?.updatedAt, 1000);

    // New agent reply advances recency (live tip append, even if idle settle).
    const replied = createSessionState({
      id: "s-recency",
      workspace: "/proj/demo",
    });
    replied.timeline = [
      ...base.timeline,
      { kind: "agent", id: "a1", text: "agent answer" },
    ];
    replied.lastAgentText = "agent answer";
    replied.status = "streaming";
    cat = upsertFromLiveState(cat, replied, 9000);
    assert.equal(cat[0]?.updatedAt, 9000);

    // New user message also advances.
    const userAgain = createSessionState({
      id: "s-recency",
      workspace: "/proj/demo",
    });
    userAgain.timeline = [
      ...replied.timeline,
      {
        kind: "user",
        id: "u2",
        blocks: [{ type: "text", text: "follow up" }],
      },
    ];
    userAgain.lastAgentText = "agent answer";
    userAgain.status = "streaming";
    cat = upsertFromLiveState(cat, userAgain, 12_000);
    assert.equal(cat[0]?.updatedAt, 12_000);
  });

  it("session/load bulk hydrate does not advance updatedAt (select must not reorder)", () => {
    // Catalog row already has a stable recency from list / prior live use.
    const partial = createSessionState({
      id: "s-load",
      workspace: "/proj/demo",
    });
    partial.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "old prompt" }],
      },
      { kind: "agent", id: "a1", text: "old reply" },
    ];
    partial.lastAgentText = "old reply";
    partial.status = "idle";
    let cat = upsertFromLiveState([], partial, 1000);
    assert.equal(cat[0]?.updatedAt, 1000);

    // Select → session/load returns a much longer historical timeline while idle.
    const loaded = createSessionState({
      id: "s-load",
      workspace: "/proj/demo",
    });
    loaded.timeline = [
      ...partial.timeline,
      {
        kind: "user",
        id: "u2",
        blocks: [{ type: "text", text: "turn 2" }],
      },
      { kind: "agent", id: "a2", text: "reply 2" },
      {
        kind: "user",
        id: "u3",
        blocks: [{ type: "text", text: "turn 3" }],
      },
      { kind: "agent", id: "a3", text: "reply 3" },
      {
        kind: "user",
        id: "u4",
        blocks: [{ type: "text", text: "turn 4" }],
      },
      { kind: "agent", id: "a4", text: "reply 4" },
    ];
    loaded.lastAgentText = "reply 4";
    loaded.status = "idle";
    cat = upsertFromLiveState(cat, loaded, 99_000);
    assert.equal(cat[0]?.timeline.length, 8);
    // Wall clock must not win — clicking the row must not jump it to the top.
    assert.equal(cat[0]?.updatedAt, 1000);
  });

  it("cold session/load fill keeps remote-list recency instead of now", () => {
    // Row from sessions_list with empty timeline and remote updatedAt epoch.
    const listed = mergeRemoteSessionsIntoCatalog(
      [],
      [
        {
          id: "s-cold",
          title: "Listed chat",
          workspace: "/proj/demo",
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      50_000,
    );
    const listedAt = Date.parse("2026-08-01T12:00:00.000Z");
    assert.equal(listed[0]?.updatedAt, listedAt);

    // First open fills history while idle — must keep list recency, not Date.now().
    const loaded = createSessionState({
      id: "s-cold",
      workspace: "/proj/demo",
    });
    loaded.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hello from history" }],
      },
      { kind: "agent", id: "a1", text: "hi back" },
      {
        kind: "user",
        id: "u2",
        blocks: [{ type: "text", text: "second" }],
      },
      { kind: "agent", id: "a2", text: "ok" },
    ];
    loaded.lastAgentText = "ok";
    loaded.status = "idle";
    const cat = upsertFromLiveState(listed, loaded, 99_000);
    assert.equal(cat[0]?.timeline.length, 4);
    assert.equal(cat[0]?.updatedAt, listedAt);
  });

  it("resolveCatalogUpdatedAt prefers newer agent session_info time without content change", () => {
    const existing = {
      id: "s1",
      workspace: "/p",
      title: "T",
      mode: "build" as const,
      model: "m",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 1000,
      timeline: [
        {
          kind: "user" as const,
          id: "u",
          blocks: [{ type: "text" as const, text: "hi" }],
        },
      ],
      toolCalls: {},
      lastAgentText: "",
    };
    const next = resolveCatalogUpdatedAt(
      existing,
      existing.timeline,
      "",
      "2026-08-07T12:00:00.000Z",
      50_000,
    );
    assert.equal(next, Date.parse("2026-08-07T12:00:00.000Z"));
  });

  it("resolveCatalogUpdatedAt does not wall-clock jump on idle bulk content change", () => {
    const existing = {
      id: "s1",
      workspace: "/p",
      title: "T",
      mode: "build" as const,
      model: "m",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 1000,
      timeline: [
        {
          kind: "user" as const,
          id: "u1",
          blocks: [{ type: "text" as const, text: "a" }],
        },
        { kind: "agent" as const, id: "a1", text: "b" },
      ],
      toolCalls: {},
      lastAgentText: "b",
    };
    const bulkTimeline = [
      ...existing.timeline,
      {
        kind: "user" as const,
        id: "u2",
        blocks: [{ type: "text" as const, text: "c" }],
      },
      { kind: "agent" as const, id: "a2", text: "d" },
      {
        kind: "user" as const,
        id: "u3",
        blocks: [{ type: "text" as const, text: "e" }],
      },
      { kind: "agent" as const, id: "a3", text: "f" },
    ];
    const next = resolveCatalogUpdatedAt(
      existing,
      bulkTimeline,
      "f",
      undefined,
      99_000,
      "idle",
    );
    assert.equal(next, 1000);
  });

  it("rehydrateCatalogTitles fixes Chat id titles from timeline", () => {
    const fixed = rehydrateCatalogTitles([
      {
        id: "s1",
        workspace: "/p",
        title: "Chat 019aaaaa",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [
              {
                type: "text",
                text: "UI UX Design Agent Style Codex Claude",
              },
            ],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    assert.equal(fixed[0]?.title, "UI UX Design Agent Style Codex Claude");
  });

  it("rehydrateCatalogTitles keeps an agent session_info title", () => {
    const fixed = rehydrateCatalogTitles([
      {
        id: "s-agent-title",
        workspace: "/p",
        title: "Implement Composer Mentions",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [{ type: "text", text: "make the input better" }],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);

    assert.equal(fixed[0]?.title, "Implement Composer Mentions");
  });

  it("pruneEmptyWeakSessions drops reconnect ghosts", () => {
    const pruned = pruneEmptyWeakSessions([
      {
        id: "keep",
        workspace: "/proj/demo",
        title: "Grok Terminal UI Design Recreation",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 300,
        timeline: [
          {
            kind: "user",
            id: "u",
            blocks: [{ type: "text", text: "Grok Terminal UI Design Recreation" }],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "ghost1",
        workspace: "/proj/demo",
        title: "Chat 019aaaa",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 100,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "ghost2",
        workspace: "/proj/demo",
        title: "Chat 019bbbb",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 200,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    assert.equal(pruned.some((s) => s.id === "keep"), true);
    // only one empty weak kept (newest ghost2)
    const empties = pruned.filter((s) => s.timeline.length === 0);
    assert.equal(empties.length, 1);
    assert.equal(empties[0]?.id, "ghost2");
  });

  it("groupSessionsByProject clusters by workspace and sorts by updatedAt desc", () => {
    const groups = groupSessionsByProject([
      {
        id: "a",
        workspace: "/proj/demo",
        title: "Zeta",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 300,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "a2",
        workspace: "/proj/demo",
        title: "Alpha",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 100,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
      {
        id: "b",
        workspace: "/proj/other",
        title: "B",
        mode: "build",
        model: "m",
        status: "idle",
        createdAt: 1,
        updatedAt: 200,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    ]);
    // Project names: "demo" before "other" by first-char ASCII (d < o).
    assert.equal(groups[0]?.projectName, "demo");
    assert.equal(groups[1]?.projectName, "other");
    // Within demo: Zeta (300) before Alpha (100) by last-message recency.
    assert.deepEqual(
      groups[0]?.sessions.map((s) => s.id),
      ["a", "a2"],
    );
  });

  it("splitNoProjectSessions pulls unfiled chats out of the project tree", () => {
    /**
     * Row builder for split tests.
     * @param partial Id plus the fields the case cares about.
     */
    const rec = (
      partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
    ): SessionRecord => ({
      id: partial.id,
      workspace: partial.workspace ?? "",
      title: partial.title ?? partial.id,
      mode: "build",
      model: "m",
      status: "idle",
      createdAt: 1,
      updatedAt: partial.updatedAt ?? 1,
      timeline: [],
      toolCalls: {},
      lastAgentText: "",
      noProject: partial.noProject,
    });

    // Sticky marker wins over the workspace path: on disk a no-project chat
    // sits under the bridge cwd, so the path alone cannot be trusted.
    const marked = rec({
      id: "marked",
      workspace: "/bridge/cwd",
      noProject: true,
      updatedAt: 100,
    });
    const legacy = rec({ id: "legacy", workspace: "", updatedAt: 300 });
    const filed = rec({ id: "filed", workspace: "/proj/demo" });
    const { noProject, withProject } = splitNoProjectSessions([
      marked,
      legacy,
      filed,
    ]);
    assert.equal(isNoProjectSession(marked), true);
    assert.equal(isNoProjectSession(filed), false);
    // Newest first inside the section.
    assert.deepEqual(
      noProject.map((s) => s.id),
      ["legacy", "marked"],
    );
    assert.deepEqual(
      withProject.map((s) => s.id),
      ["filed"],
    );
    // Grouping the remainder must not resurrect a "(no project)" folder.
    assert.deepEqual(
      groupSessionsByProject(withProject).map((g) => g.workspace),
      ["/proj/demo"],
    );
  });

  it("upsertFromLiveState marks new no-workspace rows and keeps the mark", () => {
    const loose = createSessionState({ id: "loose", workspace: "" });
    let cat = upsertFromLiveState([], loose, 1000);
    assert.equal(cat[0]?.noProject, true);

    // Bridge later reports its own resolved cwd — the row stays unfiled.
    const resolved = createSessionState({
      id: "loose",
      workspace: "/bridge/cwd",
    });
    cat = upsertFromLiveState(cat, resolved, 2000);
    assert.equal(cat[0]?.noProject, true);

    // A real project chat is never marked, even while the masking pref is on
    // and a later snapshot arrives with an empty workspace.
    const filed = createSessionState({ id: "filed", workspace: "/proj/demo" });
    let filedCat = upsertFromLiveState([], filed, 1000);
    assert.equal(filedCat[0]?.noProject, undefined);
    filedCat = upsertFromLiveState(
      filedCat,
      createSessionState({ id: "filed", workspace: "" }),
      2000,
    );
    assert.equal(filedCat[0]?.noProject, undefined);
    assert.equal(filedCat[0]?.workspace, "/proj/demo");
  });

  it("groupSessionsByTime buckets Today / Yesterday / Earlier", () => {
    const now = new Date("2026-08-07T15:00:00").getTime();
    const todayStart = new Date("2026-08-07T00:00:00").getTime();
    const yesterday = new Date("2026-08-06T12:00:00").getTime();
    const earlier = new Date("2026-08-01T12:00:00").getTime();
    assert.equal(timeBucketFor(todayStart + 1000, now), "today");
    assert.equal(timeBucketFor(yesterday, now), "yesterday");
    assert.equal(timeBucketFor(earlier, now), "earlier");

    const groups = groupSessionsByTime(
      [
        {
          id: "t",
          workspace: "/p",
          title: "Today",
          mode: "build",
          model: "m",
          status: "idle",
          createdAt: todayStart,
          updatedAt: todayStart + 2000,
          timeline: [],
          toolCalls: {},
          lastAgentText: "",
        },
        {
          id: "y",
          workspace: "/p",
          title: "Yest",
          mode: "build",
          model: "m",
          status: "idle",
          createdAt: yesterday,
          updatedAt: yesterday,
          timeline: [],
          toolCalls: {},
          lastAgentText: "",
        },
        {
          id: "e",
          workspace: "/p",
          title: "Old",
          mode: "build",
          model: "m",
          status: "idle",
          createdAt: earlier,
          updatedAt: earlier,
          timeline: [],
          toolCalls: {},
          lastAgentText: "",
        },
      ],
      now,
    );
    assert.deepEqual(
      groups.map((g) => g.bucket),
      ["today", "yesterday", "earlier"],
    );
    assert.equal(groups[0]?.label, "Today");
  });

  it("formatRelativeTime uses compact labels with short now window", () => {
    const now = 1_000_000;
    assert.equal(formatRelativeTime(now - 10_000, now), "now");
    assert.equal(formatRelativeTime(now - 45_000, now), "45s");
    assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5m");
    assert.equal(formatRelativeTime(now - 3 * 3600_000, now), "3h");
    assert.equal(formatRelativeTime(now - 24 * 3600_000, now), "1d");
    assert.equal(formatRelativeTime(now - 3 * 24 * 3600_000, now), "3d");
  });
});
