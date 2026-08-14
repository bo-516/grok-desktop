/**
 * Composer model catalog + thinking effort resolution — agent sources when present.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_THINKING_OPTIONS,
  GROK_46_THINKING_OPTIONS,
  defaultComposerControls,
  formatEffortIdLabel,
  formatModelLabel,
  formatThinkingLabel,
  loadThinkingEffort,
  modelsFromAvailableModels,
  resolveAgentDefaultModel,
  resolveModelOptions,
  resolveThinkingEffort,
  resolveThinkingOptions,
  saveThinkingEffort,
  thinkingFromConfigOptions,
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

describe("resolveThinkingOptions / thinkingFromConfigOptions", () => {
  it("returns [] when grok-build has not advertised an effort menu", () => {
    assert.deepEqual(resolveThinkingOptions(undefined), []);
    assert.deepEqual(resolveThinkingOptions([]), []);
    assert.deepEqual(resolveThinkingOptions(undefined, "grok-4.6"), []);
    assert.deepEqual(
      resolveThinkingOptions(undefined, "grok-4.6", [
        { id: "grok-4.5", name: "Grok 4.5", reasoningEfforts: [{ id: "high" }] },
      ]),
      [],
    );
    assert.equal(
      DEFAULT_THINKING_OPTIONS.some((o) => o.id === "xhigh" || o.id === "max"),
      false,
    );
    assert.equal(
      GROK_46_THINKING_OPTIONS.some((o) => o.id === "max"),
      false,
    );
  });

  it("uses catalog reasoningEfforts when present", () => {
    const options = resolveThinkingOptions(undefined, "grok-4.6", [
      {
        id: "grok-4.6",
        name: "Grok 4.6",
        reasoningEfforts: [
          { id: "xhigh", label: "Extra High Effort", default: true },
          { id: "high", label: "High Effort" },
        ],
      },
    ]);
    assert.deepEqual(options.map((o) => o.id), ["xhigh", "high"]);
    assert.equal(options[0]?.label, "Extra High");
    assert.equal(options[0]?.default, true);
  });

  it("prefers effort options from config_option_update when the agent advertises them", () => {
    const options = resolveThinkingOptions([
      {
        id: "reasoning_effort",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra high" },
        ],
      },
    ]);
    assert.deepEqual(options.map((o) => o.id), [
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    assert.equal(options.find((o) => o.id === "xhigh")?.label, "Extra high");
  });

  it("ignores model config rows when extracting effort", () => {
    assert.deepEqual(
      thinkingFromConfigOptions([
        {
          id: "model",
          options: [{ value: "grok-4.5", name: "Grok 4.5" }],
        },
      ]),
      [],
    );
  });

  it("maps bare string effort options with friendly labels", () => {
    assert.deepEqual(
      thinkingFromConfigOptions([
        { id: "effort", options: ["low", "high", "xhigh"] },
      ]),
      [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    );
  });

  it("does not inject Extra High when grok-build listed only the 4.5 ladder", () => {
    const options = resolveThinkingOptions(
      [
        {
          id: "reasoning_effort",
          currentValue: "high",
          options: ["low", "medium", "high"],
        },
      ],
      "grok-4.6",
    );
    assert.deepEqual(options.map((o) => o.id), ["low", "medium", "high"]);
    assert.equal(
      options.some((o) => o.id === "xhigh"),
      false,
    );
  });
});

describe("resolveThinkingEffort", () => {
  const official = DEFAULT_THINKING_OPTIONS;

  it("keeps a valid local preference", () => {
    assert.equal(resolveThinkingEffort(undefined, official, "low"), "low");
  });

  it("drops Extra High / Max when the advertised list does not include them", () => {
    assert.equal(
      resolveThinkingEffort(undefined, official, "xhigh", "grok-4.5"),
      "high",
    );
    assert.equal(
      resolveThinkingEffort(undefined, official, "max", "grok-4.5"),
      "high",
    );
    assert.equal(
      resolveThinkingEffort(undefined, official, "xhigh", "grok-4.6"),
      "high",
    );
  });

  it("keeps stored Extra High when the menu is still unknown (empty list)", () => {
    assert.equal(resolveThinkingEffort(undefined, [], "xhigh"), "xhigh");
    assert.equal(resolveThinkingEffort(undefined, [], "xhigh", ""), "xhigh");
  });

  it("defaults Grok 4.6 to Extra High when no preference is stored", () => {
    assert.equal(
      resolveThinkingEffort(undefined, GROK_46_THINKING_OPTIONS, null),
      "xhigh",
    );
    assert.equal(
      resolveThinkingEffort(undefined, GROK_46_THINKING_OPTIONS, "high"),
      "high",
    );
  });

  it("uses agent currentValue when preference is missing or invalid", () => {
    const config = [
      {
        id: "effort",
        currentValue: "medium",
        options: ["low", "medium", "high"],
      },
    ];
    const opts = resolveThinkingOptions(config, "grok-4.5");
    assert.equal(
      resolveThinkingEffort(config, opts, null, "grok-4.5"),
      "medium",
    );
    assert.equal(
      resolveThinkingEffort(config, opts, "xhigh", "grok-4.5"),
      "medium",
    );
  });
});

describe("formatThinkingLabel / formatEffortIdLabel", () => {
  it("uses option labels and falls back to friendly wire ids", () => {
    assert.equal(formatThinkingLabel("high"), "High");
    assert.equal(formatEffortIdLabel("xhigh"), "Extra High");
    assert.equal(formatEffortIdLabel("max"), "Max");
    assert.equal(
      formatThinkingLabel("xhigh", [{ id: "xhigh", label: "Extra high" }]),
      "Extra high",
    );
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
      effort: "",
    });
    assert.deepEqual(defaultComposerControls("grok-4.6"), {
      modelId: "grok-4.6",
      effort: "",
    });
    assert.deepEqual(
      defaultComposerControls("grok-4.6", undefined, [
        {
          id: "grok-4.6",
          name: "Grok 4.6",
          reasoningEfforts: [
            { id: "xhigh", default: true },
            { id: "high" },
          ],
        },
      ]),
      { modelId: "grok-4.6", effort: "xhigh" },
    );
  });

  it("reset effort follows agent currentValue when advertised", () => {
    assert.deepEqual(
      defaultComposerControls("grok-4.5", [
        {
          id: "effort",
          currentValue: "low",
          options: ["low", "medium", "high"],
        },
      ]),
      { modelId: "grok-4.5", effort: "low" },
    );
  });
});

describe("loadThinkingEffort / saveThinkingEffort refresh", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (previous) {
      Object.defineProperty(globalThis, "localStorage", previous);
      return;
    }
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  /**
   * Install a Map-backed Storage so Node can exercise the persist path.
   * @param initial Seed key/value pairs.
   */
  function installMemoryStorage(initial: Record<string, string> = {}): void {
    const map = new Map<string, string>(Object.entries(initial));
    const storage: Storage = {
      get length() {
        return map.size;
      },
      clear() {
        map.clear();
      },
      getItem(key: string) {
        return map.has(key) ? (map.get(key) as string) : null;
      },
      key(index: number) {
        return [...map.keys()][index] ?? null;
      },
      removeItem(key: string) {
        map.delete(key);
      },
      setItem(key: string, value: string) {
        map.set(key, String(value));
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: storage,
    });
  }

  it("reload keeps Extra High only until an advertised list rejects it", () => {
    installMemoryStorage();
    saveThinkingEffort("xhigh");
    assert.equal(loadThinkingEffort([]), "xhigh");
    assert.equal(loadThinkingEffort([], "grok-4.6"), "xhigh");
    assert.equal(loadThinkingEffort(DEFAULT_THINKING_OPTIONS, "grok-4.5"), "high");
    assert.equal(loadThinkingEffort(GROK_46_THINKING_OPTIONS, "grok-4.6"), "xhigh");
  });
});
