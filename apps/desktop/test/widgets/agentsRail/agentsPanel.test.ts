/**
 * Agents panel views + shipped helpers: empty roster, row title cluster,
 * compact inspect (no mid-panel chrome), four body kinds, click-to-preview
 * (no home / prev / next bar), two-level Escape.
 * Renders real views (not a copy).
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
  type SubagentCard,
} from "@grok-desktop/acp-core";
import {
  resolveSubagentContent,
  resolveSubagentTranscriptPresentation,
} from "@/lib/subagentContent";
import {
  groupSubagentsByRound,
  mergeSubagentsWithSpawnTools,
} from "@/lib/agentCards";
import {
  agentsEscapeAction,
  nextAgentsDrawerEscape,
} from "@/store/agentsPanelStore";
import { AgentsRosterView } from "@/widgets/agentsRail/AgentsRosterView";
import { SubagentDetailHeadView } from "@/widgets/agentsRail/SubagentDetailHeadView";
import { SubagentTranscriptFallbackView } from "@/widgets/agentsRail/SubagentTranscriptFallbackView";
import { agentsPanelKeyAction } from "@/widgets/agentsRail/useAgentsPanelWidget";
import { readDesktopRoot, readSrc } from "../../helpers/sourceFiles";

// Stub KaTeX/CSS so the shipped transcript path can load in Node.
register(new URL("../../helpers/cssHooks.mjs", import.meta.url));

/** Distinctive execute-tool title used in the tools-only snapshot. */
const TOOL_TITLE = "run npm test";

/**
 * Child snapshot that groups to a turn with activity and no trailing answer.
 * @param status Session status (streaming for live, idle for cached).
 */
function toolsOnlyChild(status: SessionState["status"]): SessionState {
  return {
    ...createSessionState({ id: "c1", workspace: "" }),
    status,
    lastAgentText: "",
    timeline: [
      {
        id: "u1",
        kind: "user",
        blocks: [{ type: "text", text: "run the suite" }],
      },
      { id: "t1", kind: "tool", toolCallId: "tc-run" },
    ],
    toolCalls: {
      "tc-run": {
        toolCallId: "tc-run",
        kind: "execute",
        title: TOOL_TITLE,
        status: status === "streaming" ? "in_progress" : "completed",
      },
    },
  };
}

/**
 * Minimal card for view tests.
 * @param partial Overrides; subagentId required.
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

describe("compact inspect keeps tool title rows", () => {
  it("TurnBlockWidget compact still mounts the activity rail", () => {
    const src = readSrc("widgets/timeline/TurnBlockWidget.tsx");
    assert.match(src, /TurnActivityRailView/);
    assert.doesNotMatch(src, /hasRail && !compact/);
  });

  it("agents-transcript CSS hides tool bodies, not the turn rail", () => {
    const src = readDesktopRoot("uno/shortcuts.agents.ts");
    assert.match(src, /tool-content-wrap/);
    assert.doesNotMatch(src, /turn-rail\]:hidden|turn-rail\):hidden/);
    assert.match(src, /turn-rail\]:\(max-h-none overflow-visible\)/);
    assert.match(src, /!px-3/);
  });

  it("transcript wrap is a flex column so TimelineView can scroll", () => {
    const src = readDesktopRoot("uno/shortcuts.agents.ts");
    const wrap = src.match(
      /"agents-transcript-wrap":\s*\n\s*"([^"]+)"/,
    );
    assert.ok(wrap?.[1], "agents-transcript-wrap shortcut present");
    assert.match(wrap[1], /flex flex-col/);
    assert.match(wrap[1], /flex-1/);
    assert.match(wrap[1], /min-h-0/);
    assert.match(wrap[1], /overflow-hidden/);
    const fallback = src.match(
      /"agents-transcript-fallback":\s*\n\s*"([^"]+)"/,
    );
    assert.ok(fallback?.[1], "agents-transcript-fallback shortcut present");
    assert.match(fallback[1], /flex-1/);
    assert.match(fallback[1], /min-h-0/);
    assert.match(fallback[1], /overflow-y-auto/);
  });

  it("inspect roster is height-capped, roster-only is fill", () => {
    const agents = readDesktopRoot("uno/shortcuts.agents.ts");
    assert.match(agents, /"agents-rail-fill":\s*"flex-1"/);
    assert.match(agents, /"agents-rail-compact":/);
    assert.match(agents, /max-h-\[min\(17rem,max\(8\.5rem,38%\)\)\]/);
    assert.match(agents, /"agents-rail-section-compact":/);
    const chrome = readDesktopRoot("uno/shortcuts.chrome.ts");
    const rail = chrome.match(/"agents-rail":\s*\n\s*"([^"]+)"/);
    assert.ok(rail?.[1], "agents-rail shortcut present");
    assert.doesNotMatch(rail[1], /flex-1/);
  });
});

describe("Agents roster empty state", () => {
  it("renders the explicit empty hint when there are no cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [],
        backgroundTasks: [],
        focusedChildId: null,
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
      }),
    );
    assert.match(html, /No subagents in this session yet/);
    assert.match(html, /data-agents-empty="subagents"/);
  });

  it("lists spawn-tool stubs when orchestration cards are missing", () => {
    const childId = "019ff5e2-b1a1-76f1-a82f-89a7c22e6c9d";
    const merged = mergeSubagentsWithSpawnTools(undefined, {
      "call-1": {
        toolCallId: "call-1",
        kind: "other",
        status: "completed",
        title: "Shy boyfriend dialogue",
        rawInput: { description: "Shy boyfriend dialogue" },
        content: `subagent_id: ${childId}`,
        meta: { "x.ai/tool": { name: "spawn_subagent" } },
      },
    });
    const html = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: groupSubagentsByRound(merged),
        backgroundTasks: [],
        focusedChildId: null,
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
      }),
    );
    assert.doesNotMatch(html, /No subagents in this session yet/);
    assert.match(html, /Shy boyfriend dialogue/);
  });
});

describe("Agents roster row alignment", () => {
  it("keeps the status indicator in the same cluster as the title", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [
          {
            parentPromptId: "p1",
            cards: [
              makeCard({
                subagentId: "s1",
                childSessionId: "c1",
                description: "goal plan writer",
                status: "completed",
              }),
            ],
          },
        ],
        backgroundTasks: [],
        focusedChildId: "c1",
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
      }),
    );
    assert.match(
      html,
      /agents-roster-row-title[\s\S]*tool-status-dot[\s\S]*agents-roster-row-label[\s\S]*goal plan writer/,
    );
    assert.match(html, /agents-roster-row-meta/);
  });

  it("compact inspect caps roster height so the transcript can grow", () => {
    const compact = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [
          {
            parentPromptId: "p1",
            cards: [
              makeCard({
                subagentId: "s1",
                childSessionId: "c1",
                description: "goal plan writer",
                durationMs: 9100,
              }),
            ],
          },
        ],
        backgroundTasks: [],
        focusedChildId: "c1",
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
        compact: true,
      }),
    );
    assert.match(compact, /data-agents-roster="compact"/);
    assert.match(compact, /agents-rail-compact/);
    assert.match(compact, /agents-rail-section-compact/);
    assert.doesNotMatch(compact, /agents-rail-fill/);
    assert.doesNotMatch(compact, />Subagents</);
    assert.doesNotMatch(compact, /Round 1/);
    assert.doesNotMatch(compact, /agents-roster-row-meta/);
    assert.match(compact, /goal plan writer/);
    const fill = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [
          {
            parentPromptId: "p1",
            cards: [
              makeCard({
                subagentId: "s1",
                childSessionId: "c1",
                description: "goal plan writer",
              }),
            ],
          },
        ],
        backgroundTasks: [],
        focusedChildId: null,
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
      }),
    );
    assert.match(fill, /data-agents-roster="fill"/);
    assert.match(fill, /agents-rail-fill/);
    assert.doesNotMatch(fill, /agents-rail-compact/);
    assert.match(fill, />Subagents</);
    assert.match(fill, /Round 1/);
    assert.match(fill, /agents-roster-row-meta/);
  });
});

describe("Agents detail head is meta-only", () => {
  it("does not repeat the roster title", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentDetailHeadView, {
        card: makeCard({
          subagentId: "s1",
          childSessionId: "c1",
          description: "goal plan writer",
          durationMs: 9100,
        }),
        ended: true,
      }),
    );
    assert.match(html, /data-agents-surface="detail-head"/);
    assert.match(html, /agents-detail-head-meta/);
    assert.doesNotMatch(html, /agents-detail-head-title/);
    assert.doesNotMatch(html, /goal plan writer/);
    assert.match(html, /completed/);
  });
});

describe("Agents four content bodies", () => {
  it("live tools-only snapshot mounts compact TimelineView with tool titles", async () => {
    const state = toolsOnlyChild("streaming");
    const content = resolveSubagentContent(
      "c1",
      { childSessions: { c1: state }, pendingSessions: {}, catalog: [] },
      makeCard({ subagentId: "s1", childSessionId: "c1", status: "running" }),
    );
    const presentation = resolveSubagentTranscriptPresentation({
      content,
      card: makeCard({
        subagentId: "s1",
        childSessionId: "c1",
        status: "running",
      }),
    });
    assert.equal(presentation.kind, "timeline");
    if (presentation.kind !== "timeline") {
      return;
    }
    assert.equal(presentation.state.timeline.some((row) => row.kind === "tool"), true);
    const { SubagentTranscriptView } = await import(
      "@/widgets/agentsRail/SubagentTranscriptView"
    );
    const html = renderToStaticMarkup(
      createElement(SubagentTranscriptView, {
        presentation,
        scrollKey: "agents:c1",
      }),
    );
    assert.match(html, /data-agents-body="live"/);
    assert.match(html, /data-timeline-compact="1"/);
    assert.match(html, /data-kind="tool"/);
    assert.match(html, new RegExp(TOOL_TITLE));
    assert.doesNotMatch(html, /What can I help with\?/);
  });

  it("cached tools-only snapshot keeps tool title rows on compact TimelineView", async () => {
    const state = toolsOnlyChild("idle");
    const presentation = resolveSubagentTranscriptPresentation({
      content: { kind: "cached", state },
      card: makeCard({
        subagentId: "s1",
        childSessionId: "c1",
        status: "completed",
      }),
    });
    assert.equal(presentation.kind, "timeline");
    if (presentation.kind !== "timeline") {
      return;
    }
    assert.equal(presentation.ended, true);
    const { SubagentTranscriptView } = await import(
      "@/widgets/agentsRail/SubagentTranscriptView"
    );
    const html = renderToStaticMarkup(
      createElement(SubagentTranscriptView, {
        presentation,
        scrollKey: "agents:c1",
      }),
    );
    assert.match(html, /data-agents-body="cached"/);
    assert.match(html, /data-timeline-compact="1"/);
    assert.match(html, /data-kind="tool"/);
    assert.match(html, new RegExp(TOOL_TITLE));
    assert.doesNotMatch(html, /What can I help with\?/);
  });

  it("output-only body is not blank", () => {
    const presentation = resolveSubagentTranscriptPresentation({
      content: { kind: "outputOnly", text: "only the final paragraph" },
      card: makeCard({
        subagentId: "s1",
        childSessionId: "c1",
        output: "only the final paragraph",
      }),
    });
    assert.equal(presentation.kind, "outputOnly");
    if (presentation.kind !== "outputOnly") {
      return;
    }
    const html = renderToStaticMarkup(
      createElement(SubagentTranscriptFallbackView, { presentation }),
    );
    assert.match(html, /data-agents-body="output-only"/);
    assert.match(html, /Final output only/);
    assert.match(html, /only the final paragraph/);
  });

  it("unavailable body is not blank", () => {
    const presentation = resolveSubagentTranscriptPresentation({
      content: { kind: "unavailable" },
      card: makeCard({ subagentId: "s1", childSessionId: "c1" }),
    });
    assert.equal(presentation.kind, "unavailable");
    if (presentation.kind !== "unavailable") {
      return;
    }
    const html = renderToStaticMarkup(
      createElement(SubagentTranscriptFallbackView, { presentation }),
    );
    assert.match(html, /data-agents-body="unavailable"/);
    assert.match(html, /process was not recorded/);
    assert.ok(html.replace(/<[^>]+>/g, "").trim().length > 0);
  });
});

describe("Agents panel inspects via roster click", () => {
  it("does not mount home / prev / next buttons", () => {
    const panel = readSrc("widgets/agentsRail/AgentsPanelWidget.tsx");
    assert.doesNotMatch(panel, /AgentsSwitcherBarView/);
    assert.doesNotMatch(panel, /data-agents-surface="switcher"/);
    assert.match(panel, /onFocusChild=\{model\.onFocusChild\}/);
    assert.match(panel, /SubagentDetailWidget/);
    const html = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [
          {
            parentPromptId: "p1",
            cards: [
              makeCard({
                subagentId: "s1",
                childSessionId: "c1",
                description: "goal plan writer",
              }),
            ],
          },
        ],
        backgroundTasks: [],
        focusedChildId: "c1",
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
      }),
    );
    assert.match(html, /aria-current="true"/);
    assert.match(html, /goal plan writer/);
    assert.doesNotMatch(html, /aria-label="Previous subagent"/);
    assert.doesNotMatch(html, /aria-label="Next subagent"/);
    assert.doesNotMatch(html, /aria-label="Back to subagent list"/);
  });
});

describe("Esc two-level semantics", () => {
  it("detail → roster (drawer stays open) then roster → close", () => {
    const detail = nextAgentsDrawerEscape({
      open: true,
      rail: "agents",
      effectiveFocus: { kind: "subagent", childSessionId: "c1" },
    });
    assert.equal(detail, "roster");
    assert.equal(
      agentsEscapeAction({ kind: "subagent", childSessionId: "c1" }),
      "roster",
    );
    const afterRoster = nextAgentsDrawerEscape({
      open: true,
      rail: "agents",
      effectiveFocus: { kind: "roster" },
    });
    assert.equal(afterRoster, "close");
  });
});

describe("background task log preview", () => {
  it("renders a preview button when the task has an outputFile", () => {
    const html = renderToStaticMarkup(
      createElement(AgentsRosterView, {
        rounds: [],
        backgroundTasks: [
          {
            taskId: "t1",
            command: "npm test",
            status: "completed",
            description: "Build acp-core and run affected desktop tests",
            outputFile:
              "/Users/me/.grok/sessions/ws/s1/terminal/call-87f9.log",
          },
        ],
        focusedChildId: null,
        nowMs: 0,
        startedAtById: {},
        onFocusChild: () => undefined,
        onPreviewLog: () => undefined,
      }),
    );
    assert.match(html, /Preview log/);
    assert.match(html, /Build acp-core and run affected desktop tests · completed/);
    assert.match(html, /<button/);
  });

  it("opens preview with the log parent as cwd, not the project workspace", () => {
    const hook = readSrc("widgets/agentsRail/useAgentsPanelWidget.ts");
    assert.match(hook, /previewLogReadCwd/);
    assert.match(hook, /cwd:\s*previewLogReadCwd\(path,\s*workspace\)/);
    assert.doesNotMatch(
      hook,
      /openPreview\(\{\s*kind:\s*"file",\s*path,\s*cwd:\s*workspace/,
    );
  });
});

describe("agentsPanelKeyAction", () => {
  it("maps listed cycle keys", () => {
    assert.equal(
      agentsPanelKeyAction({
        key: "]",
        altKey: false,
        atRoster: true,
        hasChildren: true,
      }),
      "next",
    );
    assert.equal(
      agentsPanelKeyAction({
        key: "[",
        altKey: false,
        atRoster: false,
        hasChildren: true,
      }),
      "prev",
    );
    assert.equal(
      agentsPanelKeyAction({
        key: "ArrowDown",
        altKey: true,
        atRoster: true,
        hasChildren: true,
      }),
      "next",
    );
    assert.equal(
      agentsPanelKeyAction({
        key: "Home",
        altKey: false,
        atRoster: false,
        hasChildren: true,
      }),
      "home",
    );
    assert.equal(
      agentsPanelKeyAction({
        key: "]",
        altKey: false,
        atRoster: true,
        hasChildren: false,
      }),
      "none",
    );
  });
});
