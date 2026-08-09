import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  credentialSourceLabel,
  resolveCredentialSource,
} from "@/lib/authCredentialPriority";

describe("authCredentialPriority", () => {
  it("prefers model.api_key over XAI_API_KEY", () => {
    assert.equal(
      resolveCredentialSource({ modelApiKey: true, xaiApiKey: true }),
      "model.api_key",
    );
  });

  it("labels sources", () => {
    assert.match(credentialSourceLabel("xai_api_key"), /XAI_API_KEY/);
  });
});
