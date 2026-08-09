import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterEnvForGrokChild,
  logDoesNotContainSecret,
} from "./envWhitelist.js";

describe("envWhitelist", () => {
  it("passes PATH and XAI_API_KEY, drops unrelated secrets", () => {
    const filtered = filterEnvForGrokChild({
      PATH: "/usr/bin",
      XAI_API_KEY: "sk-test",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      RANDOM_FOO: "nope",
      GROK_WEB_FETCH: "1",
    });
    assert.equal(filtered.PATH, "/usr/bin");
    assert.equal(filtered.XAI_API_KEY, "sk-test");
    assert.equal(filtered.GROK_WEB_FETCH, "1");
    assert.equal(filtered.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(filtered.RANDOM_FOO, undefined);
  });

  it("detects secret leakage in logs", () => {
    assert.equal(logDoesNotContainSecret("ok", "sk-secret-value"), true);
    assert.equal(
      logDoesNotContainSecret("key=sk-secret-value", "sk-secret-value"),
      false,
    );
  });
});
