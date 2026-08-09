import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictation } from "@/lib/voiceDictation";

describe("voiceDictation", () => {
  it("reports unsupported without SpeechRecognition (node test env)", () => {
    const handle = createDictation(() => undefined);
    assert.equal(handle.supported, false);
    if (!handle.supported) {
      assert.match(handle.reason, /not available/i);
    }
  });
});
