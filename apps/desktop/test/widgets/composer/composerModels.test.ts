/**
 * Composer model catalog resolution — agent sources only, no product fallback list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultComposerControls,
  formatModelLabel,
  modelsFromAvailableModels,
  resolveAgentDefaultModel,
  resolveModelOptions,
} from "@/widgets/composer/composerModels";

describe("formatModelLabel", () => {
  it("title-cases grok ids without a hardcoded catalog", () => {
    assert.equal(formatModelLabel("grok-4.5"), "Grok 4.5");
    assert.equal(formatModelLabel("grok-4-heavy"), "Grok 4 Heavy");
  });
});

describe("resolveModelOptions", () => {
  it("uses agent availableModels when config options are empty", () => {
    const models = resolveModelOptions(
      undefined,
      [
        { id: "grok-4.5", name: "Grok 4.5" },
        { id: "grok-4", name: "Grok 4" },
      ],
      "grok-4.5",
    );
    assert.deepEqual(models, [
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4", label: "Grok 4" },
    ]);
  });

  it("prefers config_option_update model options over availableModels", () => {
    const models = resolveModelOptions(
      [
        {
          id: "model",
          currentValue: "live-a",
          options: [
            { value: "live-a", name: "Live A" },
            { value: "live-b", name: "Live B" },
          ],
        },
      ],
      [{ id: "stale", name: "Stale" }],
      "live-a",
    );
    assert.deepEqual(models, [
      { id: "live-a", label: "Live A" },
      { id: "live-b", label: "Live B" },
    ]);
  });

  it("does not invent a product catalog when agent sent nothing", () => {
    assert.deepEqual(resolveModelOptions(undefined, undefined, ""), []);
    assert.deepEqual(resolveModelOptions([], [], ""), []);
  });

  it("prepends the live session model when it is missing from the agent list", () => {
    const models = resolveModelOptions(
      undefined,
      [{ id: "grok-4", name: "Grok 4" }],
      "custom-local",
    );
    assert.equal(models[0]?.id, "custom-local");
    assert.equal(models[1]?.id, "grok-4");
  });
});

describe("modelsFromAvailableModels", () => {
  it("falls back to formatModelLabel when name is absent", () => {
    assert.deepEqual(modelsFromAvailableModels([{ id: "grok-3-mini" }]), [
      { id: "grok-3-mini", label: "Grok 3 Mini" },
    ]);
  });
});

describe("resolveAgentDefaultModel / defaultComposerControls", () => {
  it("prefers config current, then first catalog entry", () => {
    assert.equal(
      resolveAgentDefaultModel(
        [{ id: "model", currentValue: "from-config", options: ["from-config"] }],
        [{ id: "first", label: "First" }],
        "session",
      ),
      "from-config",
    );
    assert.equal(
      resolveAgentDefaultModel(
        undefined,
        [{ id: "first", label: "First" }],
        "session",
      ),
      "first",
    );
    assert.deepEqual(defaultComposerControls("grok-4.5"), {
      modelId: "grok-4.5",
      effort: "high",
    });
  });
});
