/**
 * WS local auth: token + Origin checks (shipped authorizeWsConnection path).
 */

import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import {
  authorizeWsConnection,
  bridgeWsUrl,
  extractTokenFromRequest,
  isOriginAllowed,
  resolveAllowedOrigins,
  resolveBridgeToken,
  resolveListenPort,
} from "../src/wsAuth.js";

function fakeReq(opts: {
  url?: string;
  origin?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const headers: Record<string, string | string[] | undefined> = {
    host: "127.0.0.1:8765",
    ...(opts.headers ?? {}),
  };
  if (opts.origin !== undefined) {
    headers.origin = opts.origin;
  }
  return {
    url: opts.url ?? "/",
    headers,
  } as IncomingMessage;
}

describe("resolveListenPort", () => {
  it("defaults and accepts injectable port including 0 (ephemeral)", () => {
    assert.equal(resolveListenPort(undefined), 8765);
    assert.equal(resolveListenPort("9876"), 9876);
    assert.equal(resolveListenPort("0"), 0);
    assert.equal(resolveListenPort("not-a-port"), 8765);
  });
});

describe("resolveBridgeToken", () => {
  it("uses env token when set", () => {
    assert.equal(resolveBridgeToken("secret-1"), "secret-1");
  });

  it("generates a non-empty random token when unset", () => {
    const a = resolveBridgeToken(undefined);
    const b = resolveBridgeToken("");
    assert.ok(a.length >= 16);
    assert.ok(b.length >= 16);
    assert.notEqual(a, b);
  });
});

describe("isOriginAllowed / resolveAllowedOrigins", () => {
  it("allows missing Origin (non-browser clients)", () => {
    assert.equal(isOriginAllowed(undefined, ["http://localhost:5173"]), true);
  });

  it("allows listed Origins and rejects others", () => {
    const allowed = resolveAllowedOrigins(
      "http://localhost:5173,null,file://",
    );
    assert.equal(isOriginAllowed("http://localhost:5173", allowed), true);
    assert.equal(isOriginAllowed("null", allowed), true);
    assert.equal(isOriginAllowed("file://", allowed), true);
    assert.equal(isOriginAllowed("https://evil.example", allowed), false);
  });
});

describe("extractTokenFromRequest", () => {
  it("reads query token", () => {
    assert.equal(
      extractTokenFromRequest(fakeReq({ url: "/?token=abc" })),
      "abc",
    );
  });

  it("reads X-Bridge-Token and Bearer", () => {
    assert.equal(
      extractTokenFromRequest(
        fakeReq({ headers: { "x-bridge-token": "hdr" } }),
      ),
      "hdr",
    );
    assert.equal(
      extractTokenFromRequest(
        fakeReq({ headers: { authorization: "Bearer tok" } }),
      ),
      "tok",
    );
  });
});

describe("authorizeWsConnection", () => {
  const config = {
    token: "good-token",
    allowedOrigins: ["http://localhost:5173", "null"],
  };

  it("accepts valid token without Origin", () => {
    const r = authorizeWsConnection(
      fakeReq({ url: "/?token=good-token" }),
      config,
    );
    assert.equal(r.ok, true);
  });

  it("rejects missing token", () => {
    const r = authorizeWsConnection(fakeReq({ url: "/" }), config);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
    }
  });

  it("rejects wrong token", () => {
    const r = authorizeWsConnection(
      fakeReq({ url: "/?token=bad" }),
      config,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 401);
    }
  });

  it("rejects illegal Origin even with good token", () => {
    const r = authorizeWsConnection(
      fakeReq({
        url: "/?token=good-token",
        origin: "https://evil.example",
      }),
      config,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 403);
    }
  });

  it("accepts good token + allowed Origin", () => {
    const r = authorizeWsConnection(
      fakeReq({
        url: "/?token=good-token",
        origin: "http://localhost:5173",
      }),
      config,
    );
    assert.equal(r.ok, true);
  });
});

describe("bridgeWsUrl", () => {
  it("embeds token in query", () => {
    assert.equal(
      bridgeWsUrl(9000, "t/x", "127.0.0.1"),
      "ws://127.0.0.1:9000?token=t%2Fx",
    );
  });
});
