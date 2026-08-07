/**
 * Unit tests for NDJSON JSON-RPC codec — calls real shipped encode/decode/classify.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMessage,
  decodeLine,
  encodeNotification,
  encodeRequest,
  encodeResponse,
  splitNdjsonBuffer,
} from "../src/codec.js";

describe("codec", () => {
  it("encodeRequest produces NDJSON with trailing newline and pairs by id", () => {
    const line = encodeRequest(7, "initialize", { protocolVersion: 1 });
    assert.equal(line.endsWith("\n"), true);
    const decoded = decodeLine(line);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) {return;}
    const kind = classifyMessage(decoded.message);
    assert.equal(kind.kind, "request");
    if (kind.kind !== "request") {return;}
    assert.equal(kind.id, 7);
    assert.equal(kind.method, "initialize");
    assert.deepEqual(kind.params, { protocolVersion: 1 });
  });

  it("classifies responses for pending map resolution", () => {
    const line = encodeResponse(3, { sessionId: "s1" });
    const decoded = decodeLine(line);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) {return;}
    const kind = classifyMessage(decoded.message);
    assert.equal(kind.kind, "response");
    if (kind.kind !== "response") {return;}
    assert.equal(kind.id, 3);
    assert.deepEqual(kind.result, { sessionId: "s1" });
  });

  it("classifies session/update notifications", () => {
    const line = encodeNotification("session/update", {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      },
    });
    const decoded = decodeLine(line.trim());
    assert.equal(decoded.ok, true);
    if (!decoded.ok) {return;}
    const kind = classifyMessage(decoded.message);
    assert.equal(kind.kind, "notification");
    if (kind.kind !== "notification") {return;}
    assert.equal(kind.method, "session/update");
  });

  it("classifies agent→client reverse requests (permission)", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "session/request_permission",
      params: { toolCall: { title: "write" } },
    });
    const decoded = decodeLine(raw);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) {return;}
    const kind = classifyMessage(decoded.message);
    assert.equal(kind.kind, "request");
    if (kind.kind !== "request") {return;}
    assert.equal(kind.method, "session/request_permission");
    assert.equal(kind.id, 42);
  });

  it("tolerates non-JSON lines", () => {
    const bad = decodeLine("not-json{");
    assert.equal(bad.ok, false);
  });

  it("splitNdjsonBuffer keeps incomplete tail", () => {
    const { lines, rest } = splitNdjsonBuffer('{"a":1}\n{"b":');
    assert.deepEqual(lines, ['{"a":1}']);
    assert.equal(rest, '{"b":');
  });
});
