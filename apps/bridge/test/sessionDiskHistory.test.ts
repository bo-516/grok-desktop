/**
 * On-disk session transcript reader for cold-open hydrate.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  encodeWorkspaceDirName,
  findSessionDir,
  parseHistoryLine,
  readSessionHistoryFromDisk,
} from "../src/sessionDiskHistory.js";

describe("sessionDiskHistory", () => {
  it("encodeWorkspaceDirName matches grok-build percent-encoded folders", () => {
    assert.equal(
      encodeWorkspaceDirName("/Users/me/demo"),
      "%2FUsers%2Fme%2Fdemo",
    );
  });

  it("parseHistoryLine accepts session/update and _x.ai/session/update", () => {
    const acp = parseHistoryLine({
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "user_message_chunk", content: { text: "hi" } },
        _meta: { eventId: "e1" },
      },
    });
    assert.equal(acp?.update.sessionUpdate, "user_message_chunk");
    assert.equal(acp?.eventId, "e1");

    const ext = parseHistoryLine({
      method: "_x.ai/session/update",
      params: {
        update: { sessionUpdate: "turn_completed" },
      },
    });
    assert.equal(ext?.update.sessionUpdate, "turn_completed");
    assert.equal(ext?.eventId, undefined);

    assert.equal(parseHistoryLine({ method: "session/new" }), null);
  });

  it("readSessionHistoryFromDisk prefers chat_history over updates", async () => {
    const grokHome = await mkdtemp(path.join(tmpdir(), "grok-hist-"));
    const sid = "019fe000-0000-7000-8000-000000000010";
    const cwd = "/tmp/demo-hist";
    const dir = path.join(
      grokHome,
      "sessions",
      encodeWorkspaceDirName(cwd),
      sid,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "chat_history.jsonl"),
      `${JSON.stringify({ type: "user", content: "hello from disk" })}\n`,
    );
    await writeFile(
      path.join(dir, "updates.jsonl"),
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: { sessionUpdate: "agent_message_chunk", content: { text: "no" } },
        },
      })}\n`,
    );

    const found = await findSessionDir({ sessionId: sid, cwd, grokHome });
    assert.equal(found, dir);

    const hist = await readSessionHistoryFromDisk({
      sessionId: sid,
      cwd,
      grokHome,
    });
    assert.equal(hist.sessionId, sid);
    assert.equal(hist.cwd, cwd);
    assert.equal(hist.chatHistory.length, 1);
    assert.equal(hist.updates.length, 0);
    assert.equal((hist.chatHistory[0] as { type: string }).type, "user");
  });

  it("readSessionHistoryFromDisk falls back to updates.jsonl", async () => {
    const grokHome = await mkdtemp(path.join(tmpdir(), "grok-hist-u-"));
    const sid = "019fe000-0000-7000-8000-000000000011";
    const cwd = "/tmp/demo-upd";
    const dir = path.join(
      grokHome,
      "sessions",
      encodeWorkspaceDirName(cwd),
      sid,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "updates.jsonl"),
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "from updates" },
          },
          _meta: { eventId: "u1" },
        },
      })}\n`,
    );

    const hist = await readSessionHistoryFromDisk({
      sessionId: sid,
      grokHome,
    });
    assert.equal(hist.updates.length, 1);
    assert.equal(hist.updates[0]?.eventId, "u1");
    assert.equal(hist.chatHistory.length, 0);
  });

  it("missing session returns empty payload", async () => {
    const grokHome = await mkdtemp(path.join(tmpdir(), "grok-hist-miss-"));
    const hist = await readSessionHistoryFromDisk({
      sessionId: "no-such-session",
      grokHome,
    });
    assert.equal(hist.count, 0);
    assert.deepEqual(hist.chatHistory, []);
    assert.deepEqual(hist.updates, []);
  });
});
