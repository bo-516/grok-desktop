/**
 * Window model-catalog cache and composer source selection.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  MODEL_CATALOG_STORAGE_KEY,
  loadModelCatalog,
  mergeModelCatalog,
  resolveComposerModelSources,
  saveModelCatalog,
  type ModelCatalogSnapshot,
} from "@/lib/modelCatalog";
import { resolveThinkingOptions } from "@/widgets/composer/composerThinking";

const stored: ModelCatalogSnapshot = {
  model: "grok-4.7",
  availableModels: [
    {
      id: "grok-4.7",
      name: "Grok 4.7",
      reasoningEffort: "xhigh",
      reasoningEfforts: [
        { id: "high", label: "High", default: true },
        { id: "xhigh", label: "Extra High" },
      ],
    },
  ],
  configOptions: [{ id: "reasoning_effort", currentValue: "xhigh" }],
};

function memoryStorage(): Storage {
  const bag = new Map<string, string>();
  return {
    get length() {
      return bag.size;
    },
    clear: () => bag.clear(),
    getItem: (key: string) => bag.get(key) ?? null,
    key: (index: number) => [...bag.keys()][index] ?? null,
    removeItem: (key: string) => {
      bag.delete(key);
    },
    setItem: (key: string, value: string) => {
      bag.set(key, value);
    },
  };
}

describe("model catalog storage", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("ignores empty incoming fields and corrupt JSON", () => {
    const storage = memoryStorage();
    (globalThis as { localStorage?: Storage }).localStorage = storage;
    assert.equal(saveModelCatalog(stored), true);
    const loaded = loadModelCatalog();
    assert.equal(loaded.model, "grok-4.7");
    assert.equal(loaded.availableModels[0]?.reasoningEffort, "xhigh");
    const kept = mergeModelCatalog(loaded, {
      model: "",
      availableModels: [],
      configOptions: [],
    });
    assert.equal(kept.model, "grok-4.7");
    assert.equal(kept.availableModels.length, 1);
    assert.equal(kept.configOptions.length, 1);
    storage.setItem(MODEL_CATALOG_STORAGE_KEY, "{");
    assert.deepEqual(loadModelCatalog(), {
      model: "",
      availableModels: [],
      configOptions: [],
    });
  });
});

describe("resolveComposerModelSources", () => {
  it("uses the cache when the painted session has no catalog", () => {
    const resolved = resolveComposerModelSources({
      sessionModel: "",
      sessionModels: [],
      sessionConfig: [],
      cachedModel: stored.model,
      cachedModels: stored.availableModels,
      cachedConfig: stored.configOptions,
    });
    assert.equal(resolved.model, "grok-4.7");
    assert.equal(resolved.availableModels[0]?.id, "grok-4.7");
    const options = resolveThinkingOptions(
      resolved.configOptions,
      resolved.model,
      resolved.availableModels,
    );
    assert.deepEqual(
      options.map((row) => row.id),
      ["high", "xhigh"],
    );
  });

  it("prefers a live session catalog over the cache", () => {
    const resolved = resolveComposerModelSources({
      sessionModel: "grok-4.5",
      sessionModels: [{ id: "grok-4.5", name: "Grok 4.5" }],
      sessionConfig: [{ id: "model", currentValue: "grok-4.5" }],
      cachedModel: stored.model,
      cachedModels: stored.availableModels,
      cachedConfig: stored.configOptions,
    });
    assert.equal(resolved.model, "grok-4.5");
    assert.equal(resolved.availableModels[0]?.id, "grok-4.5");
    assert.equal(resolved.configOptions.length, 1);
    const first = resolved.configOptions[0] as { currentValue?: string };
    assert.equal(first.currentValue, "grok-4.5");
  });

  it("does not apply cached config once the session has its own models", () => {
    const resolved = resolveComposerModelSources({
      sessionModel: "grok-4.7",
      sessionModels: [
        { id: "grok-4.7", name: "Grok 4.7", reasoningEffort: "xhigh" },
      ],
      sessionConfig: [],
      cachedModel: "grok-4.5",
      cachedModels: stored.availableModels,
      cachedConfig: [{ id: "reasoning_effort", currentValue: "low" }],
    });
    assert.equal(resolved.configOptions.length, 0);
    assert.equal(resolved.availableModels[0]?.reasoningEffort, "xhigh");
  });
});
