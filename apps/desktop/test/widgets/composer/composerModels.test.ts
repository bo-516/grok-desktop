/**
 * Composer model catalog + thinking effort resolution — agent sources when present.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_THINKING_OPTIONS,
  defaultComposerControls,
  formatEffortIdLabel,
  formatModelLabel,
  formatThinkingLabel,
  modelsFromAvailableModels,
  resolveAgentDefaultModel,
  resolveModelOptions,
  resolveThinkingEffort,
  resolveThinkingOptions,
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
  it("defaults to official Grok 4.5 low/medium/high without Max", () => {
    assert.deepEqual(resolveThinkingOptions(undefined), DEFAULT_THINKING_OPTIONS);
    assert.deepEqual(resolveThinkingOptions([]), DEFAULT_THINKING_OPTIONS);
    assert.equal(
      DEFAULT_THINKING_OPTIONS.some((o) => o.id === "xhigh" || o.id === "max"),
      false,
    );
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
        { id: "xhigh", label: "Max" },
      ],
    );
  });
});

describe("resolveThinkingEffort", () => {
  const official = DEFAULT_THINKING_OPTIONS;

  it("keeps a valid local preference", () => {
    assert.equal(resolveThinkingEffort(undefined, official, "low"), "low");
  });

  it("drops unsupported legacy Max/xhigh when the agent only lists official tiers", () => {
    assert.equal(
      resolveThinkingEffort(undefined, official, "xhigh"),
      "high",
    );
    assert.equal(resolveThinkingEffort(undefined, official, "max"), "high");
  });

  it("uses agent currentValue when preference is missing or invalid", () => {
    const config = [
      {
        id: "effort",
        currentValue: "medium",
        options: ["low", "medium", "high"],
      },
    ];
    const opts = resolveThinkingOptions(config);
    assert.equal(resolveThinkingEffort(config, opts, null), "medium");
    assert.equal(resolveThinkingEffort(config, opts, "xhigh"), "medium");
  });
});

describe("formatThinkingLabel / formatEffortIdLabel", () => {
  it("uses option labels and falls back to friendly wire ids", () => {
    assert.equal(formatThinkingLabel("high"), "High");
    assert.equal(formatEffortIdLabel("xhigh"), "Max");
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
      effort: "high",
    });
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
