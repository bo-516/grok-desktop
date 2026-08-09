import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDictation,
  joinDictationDraft,
} from "@/lib/voiceDictation";

describe("voiceDictation", () => {
  it("reports unsupported without SpeechRecognition (node test env)", () => {
    const handle = createDictation(() => undefined);
    assert.equal(handle.supported, false);
    if (!handle.supported) {
      assert.match(handle.reason, /not available/i);
    }
  });

  it("joinDictationDraft freezes prefix and spaces the transcript once", () => {
    assert.equal(joinDictationDraft("", "hello"), "hello");
    assert.equal(joinDictationDraft("Ask ", "Grok"), "Ask Grok");
    assert.equal(joinDictationDraft("Ask", "Grok"), "Ask Grok");
    assert.equal(joinDictationDraft("Ask", ""), "Ask");
    assert.equal(joinDictationDraft("Ask", "  "), "Ask");
  });
});
