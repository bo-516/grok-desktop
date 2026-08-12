/**
 * Initialize / session model catalog normalization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractAvailableModelsFromSessionResult,
  extractInitializeSessionMetadata,
  extractModelFromSessionResult,
  normalizeAvailableModels,
} from "../src/sessionMetadata.js";

describe("normalizeAvailableModels", () => {
  it("accepts id/name, modelId, bare strings, and dedupes", () => {
    const models = normalizeAvailableModels([
      { id: "grok-4.5", name: "Grok 4.5" },
      { modelId: "grok-4-heavy", name: "Grok 4 · Heavy" },
      "grok-3",
      { id: "grok-4.5", name: "duplicate" },
      { value: "  " },
      null,
    ]);
    assert.deepEqual(models, [
      { id: "grok-4.5", name: "Grok 4.5" },
      { id: "grok-4-heavy", name: "Grok 4 · Heavy" },
      { id: "grok-3" },
    ]);
  });

  it("preserves totalContextTokens from model _meta (grok-build shape)", () => {
    const models = normalizeAvailableModels([
      {
        modelId: "grok-4.5",
        name: "Grok 4.5",
        _meta: { totalContextTokens: 500000 },
      },
      { id: "no-meta", totalContextTokens: 128000 },
      { id: "bad-meta", _meta: { totalContextTokens: -1 } },
    ]);
    assert.equal(models[0]?.totalContextTokens, 500000);
    assert.equal(models[1]?.totalContextTokens, 128000);
    assert.equal(models[2]?.totalContextTokens, undefined);
  });

  it("returns empty for non-arrays", () => {
    assert.deepEqual(normalizeAvailableModels(undefined), []);
    assert.deepEqual(normalizeAvailableModels("grok"), []);
  });
});

describe("extractInitializeSessionMetadata", () => {
  it("reads top-level availableModels and commands", () => {
    const meta = extractInitializeSessionMetadata({
      availableModels: [{ id: "grok-4.5", name: "Grok 4.5" }],
      availableCommands: [{ name: "help", description: "Help" }],
    });
    assert.equal(meta.model, "grok-4.5");
    assert.deepEqual(meta.availableModels, [
      { id: "grok-4.5", name: "Grok 4.5" },
    ]);
    assert.equal(meta.availableCommands[0]?.name, "help");
  });

  it("prefers _meta.modelState currentModelId and catalog", () => {
    const meta = extractInitializeSessionMetadata({
      _meta: {
        modelState: {
          currentModelId: "grok-4",
          availableModels: [
            { modelId: "grok-4", name: "Grok 4" },
            { modelId: "grok-4.5", name: "Grok 4.5" },
          ],
        },
      },
    });
    assert.equal(meta.model, "grok-4");
    assert.equal(meta.availableModels.length, 2);
    assert.equal(meta.availableModels[1]?.id, "grok-4.5");
  });

  it("reads real grok-build slash catalog from _meta.availableCommands", () => {
    const meta = extractInitializeSessionMetadata({
      _meta: {
        modelState: {
          currentModelId: "grok-4.5",
          availableModels: [{ modelId: "grok-4.5", name: "Grok 4.5" }],
        },
        availableCommands: [
          {
            name: "compact",
            description: "Compress conversation history",
            input: { hint: "optional context" },
          },
          { name: "context", description: "Show context window usage", input: null },
        ],
      },
    });
    assert.equal(meta.model, "grok-4.5");
    assert.equal(meta.availableCommands.length, 2);
    assert.equal(meta.availableCommands[0]?.name, "compact");
    assert.equal(meta.availableCommands[1]?.name, "context");
  });

  it("ignores empty top-level commands so _meta catalog still wins", () => {
    const meta = extractInitializeSessionMetadata({
      availableCommands: [],
      _meta: {
        availableCommands: [{ name: "workflow", description: "Run workflow" }],
      },
    });
    assert.equal(meta.availableCommands[0]?.name, "workflow");
  });
});

describe("extractAvailableModelsFromSessionResult", () => {
  it("reads nested models.availableModels from session/new", () => {
    const models = extractAvailableModelsFromSessionResult({
      sessionId: "s1",
      models: {
        currentModelId: "grok-mock",
        availableModels: [{ modelId: "grok-mock", name: "Grok Mock" }],
      },
    });
    assert.deepEqual(models, [{ id: "grok-mock", name: "Grok Mock" }]);
    assert.equal(
      extractModelFromSessionResult({
        models: {
          currentModelId: "grok-mock",
          availableModels: [{ modelId: "grok-mock", name: "Grok Mock" }],
        },
      }),
      "grok-mock",
    );
  });
});
