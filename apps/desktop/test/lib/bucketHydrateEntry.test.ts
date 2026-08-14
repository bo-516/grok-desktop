/**
 * Bucket full-snapshot entry convergence (I1): hydrateSessionBucket is the
 * only ownership-aware full replace; Node replay_end and seed preserve
 * client-owned subagents when the snapshot omits them.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import {
  createSessionState,
  resetTimelineIdCounter,
  type SessionState,
} from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "@/bridge/liveBridgeDispatch";
import {
  createSessionReduceBucket,
  hydrateSessionBucket,
} from "@/lib/sessionReduce";

const DESKTOP_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

/**
 * Recursively list .ts/.tsx files under a directory.
 * @param dir Absolute directory.
 * @returns Absolute file paths.
 */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (name.isFile() && /\.tsx?$/.test(name.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("bucket hydrate entry (I1)", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("structural: full-snapshot paths use hydrateSessionBucket (no bare bucket.state = snapshot)", () => {
    // Scan liveBridgeDispatch for assignment patterns that bypass hydrate on
    // full bridge snapshots. Id stamps and lifecycle patches are allowed.
    const dispatchPath = path.join(
      DESKTOP_SRC,
      "bridge/liveBridgeDispatch.ts",
    );
    const src = readFileSync(dispatchPath, "utf8");
    // Node replay_end must call hydrateSessionBucket with msg.session.
    assert.match(
      src,
      /hydrateSessionBucket\(\s*bucket,\s*msg\.session/,
      "replay_end Node path must hydrate via hydrateSessionBucket",
    );
    // seedSession must call hydrateSessionBucket.
    assert.match(
      src,
      /function seedSession[\s\S]*hydrateSessionBucket/,
      "seedSession must call hydrateSessionBucket",
    );
    // state path must call hydrateSessionBucket (not only mergeBridgeSnapshot alone).
    assert.match(
      src,
      /msg\.type === "state"[\s\S]*hydrateSessionBucket/,
      "state path must call hydrateSessionBucket",
    );
    // Bare replace of bucket.state with an external snapshot variable is forbidden
    // outside hydrateSessionBucket itself.
    for (const file of listTsFiles(DESKTOP_SRC)) {
      if (file.endsWith("sessionReduce.ts")) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      // Flag `bucket.state = msg.session` / `bucket.state = incoming` style full replaces.
      const bad = text.match(
        /bucket\.state\s*=\s*(msg\.session|incoming|snapshot|session)\b/,
      );
      assert.equal(
        bad,
        null,
        `${path.relative(DESKTOP_SRC, file)} bypasses hydrate with ${bad?.[0]}`,
      );
    }
  });

  it("hydrateSessionBucket ownership-merges: empty snapshot keeps live subagents", () => {
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "p", workspace: "/w" }),
    );
    bucket.state = {
      ...bucket.state,
      subagents: {
        a1: {
          subagentId: "a1",
          childSessionId: "c1",
          status: "running",
          type: "general-purpose",
          description: "worker",
        },
      },
    };
    const empty = createSessionState({ id: "p", workspace: "/w" });
    empty.timeline = [];
    empty.subagents = undefined;
    hydrateSessionBucket(bucket, empty, { clearDedupe: true });
    assert.equal(Object.keys(bucket.state.subagents ?? {}).length, 1);
  });

  it("Node replay_end after live subagents keeps card count (scenario E)", () => {
    let last: SessionState = createSessionState({
      id: "parent-replay-e",
      workspace: "/w",
    });
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s) => {
          last = s;
        },
        onSessionUpdate: (s) => {
          last = s;
        },
      },
    });
    const parent = "parent-replay-e";
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: parent, workspace: "/w" }),
    });
    // Four live spawns.
    for (let i = 1; i <= 4; i++) {
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: parent,
        update: {
          sessionUpdate: "subagent_spawned",
          subagent_id: `sa-${i}`,
          child_session_id: `child-${i}`,
          subagent_type: "general-purpose",
          description: `worker-${i}`,
        },
        eventId: `spawn-${i}`,
      });
    }
    const liveCount = Object.keys(last.subagents ?? {}).length;
    assert.equal(liveCount, 4);

    // Seed with subagents (catalog seed path).
    dispatch.seedSession({
      ...createSessionState({ id: parent, workspace: "/w" }),
      timeline: last.timeline,
      toolCalls: last.toolCalls,
      subagents: last.subagents,
      subagentLinks: last.subagentLinks,
    });
    const afterSeed = Object.keys(
      dispatch.bucketFor(parent).state.subagents ?? {},
    ).length;
    assert.equal(afterSeed, 4);

    // Node replay_end with snapshot that omits subagents (wire re-serialize).
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: parent });
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: parent,
      status: "idle",
      count: 0,
      bytes: 0,
      elapsedMs: 1,
      session: {
        ...createSessionState({ id: parent, workspace: "/w" }),
        timeline: last.timeline,
        toolCalls: last.toolCalls,
        // intentionally no subagents
      },
    });
    const afterReplay = Object.keys(last.subagents ?? {}).length;
    assert.equal(
      afterReplay,
      4,
      `scenario E: afterReplay must be 4, got ${afterReplay}`,
    );
  });

  it("seedSession without subagents does not wipe existing cards", () => {
    let last: SessionState = createSessionState({
      id: "parent-seed-keep",
      workspace: "/w",
    });
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s) => {
          last = s;
        },
        onSessionUpdate: (s) => {
          last = s;
        },
      },
    });
    const parent = "parent-seed-keep";
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: parent, workspace: "/w" }),
    });
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: parent,
      update: {
        sessionUpdate: "subagent_spawned",
        subagent_id: "sa-1",
        child_session_id: "child-1",
        subagent_type: "general-purpose",
        description: "worker",
      },
      eventId: "sp1",
    });
    assert.equal(Object.keys(last.subagents ?? {}).length, 1);

    // Cold seed without subagents (shorter timeline would skip; match length).
    dispatch.seedSession({
      ...createSessionState({ id: parent, workspace: "/w" }),
      timeline: last.timeline,
      toolCalls: {},
      // no subagents
    });
    assert.equal(
      Object.keys(dispatch.bucketFor(parent).state.subagents ?? {}).length,
      1,
    );
  });
});
