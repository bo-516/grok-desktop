/**
 * Navigation selectSession must resolve catalogued childSessionIds (subagents).
 * Guards A4: filtering must not delete catalog rows or select early-returns.
 * Also drives mid-run buffer→promote path (child not yet in catalog).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  canOpenChildSession,
  canSelectCatalogSession,
  openableChildSessionIds,
} from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalog";
import {
  newSessionAction,
  selectSessionAction,
} from "@/store/sessionStoreNavigation";
import type { SessionStore } from "@/store/sessionStoreTypes";
import { readSrc } from "../helpers/sourceFiles.js";

/**
 * Minimal catalog row for navigation tests.
 * @param partial Overrides including required id.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "/ws",
    title: partial.title ?? partial.id,
    mode: partial.mode ?? "build",
    model: partial.model ?? "",
    status: partial.status ?? "idle",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    timeline: partial.timeline ?? [],
    toolCalls: partial.toolCalls ?? {},
    lastAgentText: partial.lastAgentText ?? "",
    sessionKind: partial.sessionKind,
    parentSessionId: partial.parentSessionId,
  };
}

describe("selectSession navigation for subagent drill-down", () => {
  it("catalogued childSessionId is selectable (no early-return solely for subagent kind)", () => {
    const childSessionId = "019feb2e-97ef-0000-0000-000000000001";
    const catalog = [
      rec({
        id: "019feb2e-5fe5-0000-0000-000000000001",
        title: "Parent goal chat",
      }),
      rec({
        id: childSessionId,
        title: "goal plan writer",
        sessionKind: "subagent",
        parentSessionId: "019feb2e-5fe5-0000-0000-000000000001",
      }),
    ];
    assert.equal(canSelectCatalogSession(catalog, childSessionId), true);
    // Production selectSessionAction: catalog.find then return if missing.
    const found = catalog.find((s) => s.id === childSessionId);
    assert.ok(found);
    assert.equal(found.sessionKind, "subagent");
  });

  it("selectSessionAction still gates only on catalog membership, not sessionKind", () => {
    const nav = readSrc("store/sessionStoreNavigation.ts");
    // Early-return is solely "not in catalog" after promote — must not check sessionKind.
    assert.match(nav, /catalog\.find\(\(s\) => s\.id === id\)/);
    assert.match(nav, /if \(!rec\) \{\s*return;/s);
    // Mid-run L3: promote from buffer/roles before catalog.find.
    assert.match(nav, /promoteBufferedChildForSelect/);
    assert.match(nav, /hydrateViewingSessionFromDisk/);
    // Kind may come from catalog or live sessionRoles (before disk sync).
    assert.match(nav, /withCachedSlashCatalog/);
    assert.match(
      nav,
      /viewingSubagent:\s*isSubagentSessionKind\(kind\)/,
    );
    assert.match(
      nav,
      /rec\.sessionKind\s*\?\?\s*get\(\)\.sessionRoles\[id\]\?\.sessionKind/,
    );
    assert.match(nav, /viewingParentSessionId:\s*parentId/);
  });

  it("selectSessionAction promotes buffered child and sets viewingSubagent", () => {
    const PARENT = "parent-nav-promote";
    const CHILD = "child-nav-promote";
    let state: Partial<SessionStore> = {
      catalog: [
        rec({
          id: PARENT,
          title: "Parent",
          workspace: "/proj",
          timeline: [
            {
              kind: "user",
              id: "u1",
              blocks: [{ type: "text", text: "spawn" }],
            },
          ],
        }),
      ],
      childSessions: {
        [CHILD]: {
          ...createSessionState({ id: CHILD, workspace: "" }),
          status: "streaming",
          timeline: [
            {
              kind: "user",
              id: "cu",
              blocks: [{ type: "text", text: "worker prompt" }],
            },
            { kind: "agent", id: "ca", text: "partial answer" },
          ],
          lastAgentText: "partial answer",
        },
      },
      sessionRoles: {
        [CHILD]: { parentSessionId: PARENT, sessionKind: "subagent" },
      },
      sessionProvenance: { [PARENT]: "local" },
      pendingSessions: {},
      pendingSessionOrder: [],
      catalogRevision: 0,
      poolEntries: [],
      viewingSessionId: PARENT,
      activeSessionId: PARENT,
      session: createSessionState({ id: PARENT, workspace: "/proj" }),
      connectionMode: "disconnected",
      bridgeInfo: "",
      lastError: null,
      live: null,
      localDraft: false,
      creatingSession: false,
      pendingMode: null,
      restoringSessionId: null,
      viewingSubagent: false,
      viewingParentSessionId: undefined,
      promptQueue: [],
      clearPendingMode: () => {
        /* no timer in unit test */
      },
    };

    const get = () => state as SessionStore;
    const set = (
      partial: Partial<SessionStore> | ((s: SessionStore) => Partial<SessionStore>),
    ) => {
      const patch =
        typeof partial === "function" ? partial(state as SessionStore) : partial;
      state = { ...state, ...patch };
    };

    // UI open gate would enable Open for this buffered child.
    assert.equal(
      canOpenChildSession(
        CHILD,
        state.catalog!,
        state.childSessions!,
        state.sessionRoles!,
      ),
      true,
    );
    assert.equal(
      openableChildSessionIds(
        state.catalog!,
        state.childSessions!,
        state.sessionRoles!,
      ).has(CHILD),
      true,
    );
    // Not yet in catalog (streaming buffer path).
    assert.equal(state.catalog!.some((r) => r.id === CHILD), false);

    selectSessionAction(set as never, get as never, CHILD);

    assert.equal(state.viewingSessionId, CHILD);
    assert.equal(state.viewingSubagent, true);
    assert.equal(state.viewingParentSessionId, PARENT);
    const row = state.catalog!.find((r) => r.id === CHILD);
    assert.ok(row, "promote must insert catalog row");
    assert.equal(row!.sessionKind, "subagent");
    assert.equal(row!.parentSessionId, PARENT);
    assert.equal(row!.workspace, "/proj");
    assert.equal(state.childSessions![CHILD], undefined);
    assert.equal(state.session?.id, CHILD);
    assert.ok((state.session?.timeline?.length ?? 0) >= 1);
  });

  it("rail filter lives in product path and uses filterCatalogForSessionRail", () => {
    const rail = readSrc("widgets/sessionRail/useSessionRailWidget.ts");
    assert.match(rail, /filterCatalogForSessionRail/);
    assert.doesNotMatch(rail, /subagentVisibility/);
  });

  it("Agents inspect path focuses the panel instead of selecting a session", () => {
    const hook = readSrc("widgets/agentsRail/useAgentsPanelWidget.ts");
    assert.match(hook, /groupSubagentsByRound/);
    assert.match(hook, /mergeSubagentsWithSpawnTools/);
    assert.match(hook, /inspectSubagentInPanel/);
    assert.doesNotMatch(hook, /selectSession/);
    assert.doesNotMatch(hook, /subagentVisibility|buildListTasksCommand|buildKillTaskCommand/);
    const timeline = readSrc("widgets/timeline/SubagentGroupWidget.tsx");
    assert.match(timeline, /inspectSubagentInPanel/);
    assert.doesNotMatch(timeline, /selectSession/);
  });

  it("newSessionAction keeps the previous slash catalog on the draft canvas", async () => {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const key of Object.keys(store)) {
            delete store[key];
          }
        },
        key: () => null,
        get length() {
          return Object.keys(store).length;
        },
      },
    });
    const live = createSessionState({ id: "s-live", workspace: "/proj" });
    live.availableCommands = [
      { name: "compact", description: "Compress conversation history" },
      { name: "design", description: "Write a design" },
    ];
    let state: Partial<SessionStore> = {
      session: live,
      catalog: [rec({ id: "s-live", workspace: "/proj", title: "Live" })],
      viewingSessionId: "s-live",
      activeSessionId: "s-live",
      sessionRoles: {},
      sessionProvenance: { "s-live": "local" },
      pendingSessions: {},
      pendingSessionOrder: [],
      childSessions: {},
      catalogRevision: 0,
      poolEntries: [],
      connectionMode: "live-bridge",
      bridgeInfo: "",
      lastError: null,
      live: null,
      localDraft: false,
      creatingSession: false,
      pendingMode: null,
      restoringSessionId: null,
      viewingSubagent: false,
      viewingParentSessionId: undefined,
      promptQueue: [],
      clearPendingMode: () => {
        /* no timer */
      },
    };
    const get = () => state as SessionStore;
    const set = (
      partial: Partial<SessionStore> | ((s: SessionStore) => Partial<SessionStore>),
    ) => {
      const patch =
        typeof partial === "function" ? partial(state as SessionStore) : partial;
      state = { ...state, ...patch };
    };

    await newSessionAction(set as never, get as never);

    assert.equal(state.localDraft, true);
    assert.equal(state.session?.id, "");
    assert.equal(state.session?.availableCommands?.length, 2);
    assert.equal(state.session?.availableCommands?.[0]?.name, "compact");
    assert.equal(state.session?.availableCommands?.[1]?.name, "design");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });
});
