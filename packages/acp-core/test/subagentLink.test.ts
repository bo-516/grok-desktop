/**
 * Protocol-field subagent identification and body-id parsing.
 * Fixtures mirror design doc §2.1 / §2.2 real-shaped payloads.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallCard } from "../src/types.js";
import {
  isSpawnSubagentCard,
  parseSpawnedSubagentId,
  sanitizeToolRawInput,
  vendorToolName,
  waitBarrierTaskIds,
} from "../src/subagentLink.js";

/** Real-shaped vendor meta for spawn_subagent. */
const SPAWN_META = {
  "x.ai/tool": {
    version: 1,
    name: "spawn_subagent",
    kind: "task",
    namespace: "grok_build",
    label: "Subagent",
    read_only: false,
  },
  subagentBackground: true,
};

/** Completed spawn body from live CLI (design doc §2.2). */
const SPAWN_BODY = `Subagent started in background.
subagent_id: 019feff5-9ef4-7623-91cb-1938fc28e83e
type: general-purpose
description: Create Vue+Vite project

Use get_command_or_subagent_output with task_ids=["019feff5-9ef4-7623-91cb-1938fc28e83e"] and timeout_ms to wait for results.`;

/**
 * Build a minimal tool card for identification tests.
 * @param partial Fields to override on a bare card.
 */
function card(partial: Partial<ToolCallCard> & { toolCallId?: string }): ToolCallCard {
  return {
    toolCallId: partial.toolCallId ?? "call-1",
    ...partial,
  };
}

describe("subagentLink", () => {
  it("vendorToolName reads spawn / wait / kill from _meta", () => {
    assert.equal(
      vendorToolName(card({ meta: SPAWN_META })),
      "spawn_subagent",
    );
    assert.equal(
      vendorToolName(
        card({
          meta: {
            "x.ai/tool": { name: "get_command_or_subagent_output" },
          },
        }),
      ),
      "get_command_or_subagent_output",
    );
    assert.equal(
      vendorToolName(
        card({
          meta: {
            "x.ai/tool": { name: "kill_command_or_subagent" },
          },
        }),
      ),
      "kill_command_or_subagent",
    );
  });

  it("plain tools without _meta return undefined / not spawn", () => {
    const plain = card({
      title: "Read package.json",
      kind: "read",
      status: "completed",
    });
    assert.equal(vendorToolName(plain), undefined);
    assert.equal(isSpawnSubagentCard(plain), false);
  });

  it("title alone never identifies a spawn card", () => {
    const titleOnly = card({
      title: "spawn_subagent",
      kind: "other",
      status: "completed",
      content: SPAWN_BODY,
    });
    assert.equal(isSpawnSubagentCard(titleOnly), false);
    assert.equal(vendorToolName(titleOnly), undefined);
  });

  it("parseSpawnedSubagentId extracts id from real-shaped body", () => {
    const id = parseSpawnedSubagentId([
      { type: "content", content: { type: "text", text: SPAWN_BODY } },
    ]);
    assert.equal(id, "019feff5-9ef4-7623-91cb-1938fc28e83e");
  });

  it("parseSpawnedSubagentId returns undefined for incomplete body", () => {
    assert.equal(parseSpawnedSubagentId(undefined), undefined);
    assert.equal(parseSpawnedSubagentId(""), undefined);
    assert.equal(
      parseSpawnedSubagentId("Subagent started in background."),
      undefined,
    );
    assert.equal(parseSpawnedSubagentId([{ type: "diff", path: "a" }]), undefined);
  });

  it("waitBarrierTaskIds preserves order from rawInput.task_ids", () => {
    const ids = [
      "019feff5-9ef4-7623-91cb-1938fc28e83e",
      "019feff5-a111-7623-91cb-1938fc28e83e",
      "019feff5-b222-7623-91cb-1938fc28e83e",
      "019feff5-c333-7623-91cb-1938fc28e83e",
    ];
    const wait = card({
      meta: {
        "x.ai/tool": { name: "get_command_or_subagent_output" },
      },
      rawInput: { task_ids: ids, timeout_ms: 600000 },
    });
    assert.deepEqual(waitBarrierTaskIds(wait), ids);
    assert.deepEqual(waitBarrierTaskIds(card({})), []);
    assert.deepEqual(
      waitBarrierTaskIds(card({ rawInput: { description: "no ids" } })),
      [],
    );
  });

  it("sanitizeToolRawInput drops prompt and keeps description / task_ids", () => {
    const cleaned = sanitizeToolRawInput({
      description: "Create Vue+Vite project",
      prompt: "x".repeat(3000),
      task_ids: ["a", "b"],
      timeout_ms: 1000,
    });
    assert.deepEqual(cleaned, {
      description: "Create Vue+Vite project",
      task_ids: ["a", "b"],
    });
    assert.equal(sanitizeToolRawInput({ prompt: "only prompt" }), undefined);
  });
});
