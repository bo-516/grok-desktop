import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalMemoryKey,
  stillAskDespiteRemember,
} from "@/lib/rememberApprovals";

describe("rememberApprovals", () => {
  it("re-asks for git push and rm -rf", () => {
    assert.equal(stillAskDespiteRemember("git push origin main"), true);
    assert.equal(stillAskDespiteRemember("rm -rf /tmp/x"), true);
    assert.equal(stillAskDespiteRemember("ls -la"), false);
  });

  it("builds stable keys", () => {
    assert.equal(approvalMemoryKey("Bash", "git *"), "approve:bash:git *");
  });
});
