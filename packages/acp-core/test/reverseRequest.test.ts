/**
 * TC-REV-06 / F-REV-08: unknown reverse methods must return JSON-RPC -32601 with method name.
 * Drives real AcpClient.handleIncomingRequest via onAgentRequest throws.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcpClient } from "../src/client.js";
import { createMockAcpPair } from "../src/mockAgent.js";

describe("AcpClient reverse request errors", () => {
  it("returns -32601 with method name when onAgentRequest throws method-not-found", async () => {
    const pair = createMockAcpPair({ emitPermission: false, chunkDelayMs: 1 });
    const client = new AcpClient({
      transport: pair.clientTransport,
      onAgentRequest: async (method) => {
        const err = new Error(`Method not found: ${method}`) as Error & {
          code?: number;
        };
        err.code = -32601;
        throw err;
      },
    });

    const captured: Array<Record<string, unknown>> = [];
    const clientWrite = pair.clientTransport.write.bind(pair.clientTransport);
    pair.clientTransport.write = (data: string) => {
      try {
        const msg = JSON.parse(data.trim()) as Record<string, unknown>;
        if (msg.id === 99) {
          captured.push(msg);
        }
      } catch {
        /* ignore */
      }
      return clientWrite(data);
    };

    client.dispatchMessage({
      jsonrpc: "2.0",
      id: 99,
      method: "terminal/unknown_probe",
      params: {},
    });

    await new Promise((r) => setTimeout(r, 20));

    const errResp = captured.find((m) => m.id === 99);
    assert.ok(errResp, "expected reverse response for id 99");
    const error = errResp.error as { code: number; message: string };
    assert.equal(error.code, -32601);
    assert.match(error.message, /terminal\/unknown_probe/);

    client.dispose();
    pair.dispose();
  });

  it("does not silent-succeed empty object for unimplemented reverse methods when no handler", async () => {
    const pair = createMockAcpPair({ emitPermission: false, chunkDelayMs: 1 });
    const client = new AcpClient({
      transport: pair.clientTransport,
      // no onAgentRequest
    });

    const captured: Array<Record<string, unknown>> = [];
    const clientWrite = pair.clientTransport.write.bind(pair.clientTransport);
    pair.clientTransport.write = (data: string) => {
      try {
        const msg = JSON.parse(data.trim()) as Record<string, unknown>;
        if (msg.id === 42) {
          captured.push(msg);
        }
      } catch {
        /* ignore */
      }
      return clientWrite(data);
    };

    client.dispatchMessage({
      jsonrpc: "2.0",
      id: 42,
      method: "fs/not_a_real_method",
      params: {},
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(captured.length, 1);
    const error = captured[0]!.error as { code: number; message: string };
    assert.equal(error.code, -32601);
    assert.match(error.message, /fs\/not_a_real_method/);

    client.dispose();
    pair.dispose();
  });
});
