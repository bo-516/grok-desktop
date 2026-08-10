#!/usr/bin/env node
/**
 * Deterministic ACP stdio agent for dual-bridge differential tests only.
 * Not a product path — used via GROK_BIN so Node and Go bridges see the same
 * agent outbound for the same client-inbound sequence (AC3 L1/L2).
 *
 * Modes (env GROK_FAKE_MODE — must be GROK_* to pass bridge env whitelist):
 *   default | parity  — fixed session + PARITY_OK agent text
 *   permission        — request_permission once, then complete after reply
 *   crash             — exit mid-stream after first tool_call
 *   partial-utf8      — emit a partial NDJSON line then a complete line
 *
 * Speaks JSON-RPC NDJSON on stdin/stdout like `grok agent stdio`.
 */

import fs from "node:fs";
import readline from "node:readline";

const MODE = process.env.GROK_FAKE_MODE || process.env.FAKE_GROK_MODE || "parity";
const FIXED_SESSION = "fixture-session-0001";
let nextEventSeq = 10;
let promptCount = 0;
let disposed = false;

/** Unbuffered NDJSON write so partial-line tests are not swallowed by pipe buffering. */
function writeRaw(s) {
  if (disposed) return;
  fs.writeSync(1, s);
}

function write(obj) {
  if (disposed) return;
  writeRaw(`${JSON.stringify(obj)}\n`);
}

function eventId() {
  const id = `${FIXED_SESSION}-${nextEventSeq}`;
  nextEventSeq += 1;
  return id;
}

function sessionUpdate(update, sessionId = FIXED_SESSION) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update,
      _meta: { eventId: eventId() },
    },
  });
}

function reply(id, result) {
  write({ jsonrpc: "2.0", id, result: result ?? {} });
}

function replyError(id, code, message) {
  write({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false },
        },
        authMethods: [{ id: "cached_token", name: "cached" }],
        _meta: {
          modelState: {
            currentModelId: "fixture-model",
            availableModels: [{ id: "fixture-model", name: "Fixture" }],
          },
          availableCommands: [],
        },
        availableModels: [{ id: "fixture-model", name: "Fixture" }],
      });
      return;
    case "authenticate":
      reply(id, {});
      return;
    case "session/new": {
      reply(id, {
        sessionId: FIXED_SESSION,
        _meta: {
          modelState: { currentModelId: "fixture-model" },
        },
      });
      return;
    }
    case "session/load": {
      const sid = params?.sessionId || FIXED_SESSION;
      // Emit one replayed user+agent pair under replaying (bridge suppresses state)
      sessionUpdate(
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed user" },
        },
        sid,
      );
      sessionUpdate(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "replayed agent" },
        },
        sid,
      );
      reply(id, { sessionId: sid });
      return;
    }
    case "session/prompt": {
      promptCount += 1;
      const sid = params?.sessionId || FIXED_SESSION;
      const userText =
        Array.isArray(params?.prompt) &&
        params.prompt.find((b) => b?.type === "text")?.text;

      if (MODE === "partial-utf8") {
        // Incomplete first frame (no trailing newline) then complete message —
        // exercises LineSplitter reassembly on both bridges.
        // Use the same write() path as parity (one complete NDJSON line) for the
        // payload, preceded by a deliberate incomplete fragment so the splitter
        // must buffer. Then a second complete line with PARTIAL_OK.
        writeRaw('{"partial":true'); // incomplete; no newline
        writeRaw("}\n"); // closes as invalid JSON line — codec ignores
        sessionUpdate(
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "PARTIAL_OK" },
          },
          sid,
        );
        reply(id, { stopReason: "end_turn" });
        return;
      }

      if (MODE === "crash") {
        sessionUpdate(
          {
            sessionUpdate: "tool_call",
            toolCallId: "crash-tool-1",
            title: "before-crash",
            kind: "execute",
            status: "pending",
          },
          sid,
        );
        // Hard exit so bridge must recover
        process.stdout.write("");
        process.exit(2);
      }

      if (MODE === "permission" && promptCount === 1) {
        // Reverse permission request; wait for response on stdin before finishing
        const permId = 9001;
        write({
          jsonrpc: "2.0",
          id: permId,
          method: "session/request_permission",
          params: {
            sessionId: sid,
            toolCall: {
              toolCallId: "perm-tool-1",
              title: "needs approval",
              kind: "execute",
            },
            options: [
              { optionId: "allow_once", name: "Allow once" },
              { optionId: "deny_once", name: "Deny" },
            ],
          },
        });
        // Store pending so the next response with id 9001 completes the prompt
        pendingPermission = { promptRpcId: id, sessionId: sid };
        return;
      }

      // Default parity stream: tool + agent text with fixed eventIds via eventId()
      sessionUpdate(
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: String(userText || "hi") },
        },
        sid,
      );
      sessionUpdate(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t-fixture-1",
          title: "list",
          kind: "read",
          status: "pending",
        },
        sid,
      );
      sessionUpdate(
        {
          sessionUpdate: "task_backgrounded",
          taskId: "bg-fixture-1",
          toolCallId: "t-fixture-1",
          command: "echo fixture",
          status: "running",
        },
        sid,
      );
      // Non-monotonic eventId reorder: bump seq then emit lower via manual id
      // (task_* already used next ids; tool_call_update uses an earlier one)
      const reorderId = `${FIXED_SESSION}-12`;
      // Ensure eventId() has advanced past 12
      while (nextEventSeq <= 13) eventId();
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sid,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t-fixture-1",
            status: "completed",
          },
          _meta: { eventId: reorderId },
        },
      });
      sessionUpdate(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PARITY_OK" },
        },
        sid,
      );
      reply(id, { stopReason: "end_turn" });
      return;
    }
    case "session/cancel":
      // notification-like if no id; if request, ack
      if (id !== undefined && id !== null) reply(id, {});
      return;
    case "session/set_model":
    case "session/set_mode":
      replyError(id, -32601, `Method not found: ${method}`);
      return;
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

let pendingPermission = null;

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  // Permission response from client
  if (
    pendingPermission &&
    msg.id === 9001 &&
    (msg.result !== undefined || msg.error)
  ) {
    const { promptRpcId, sessionId } = pendingPermission;
    pendingPermission = null;
    sessionUpdate(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "PERM_OK" },
      },
      sessionId,
    );
    reply(promptRpcId, { stopReason: "end_turn" });
    return;
  }
  if (msg.method && (msg.id !== undefined && msg.id !== null)) {
    await handleRequest(msg);
  }
});

rl.on("close", () => {
  disposed = true;
  process.exit(0);
});
