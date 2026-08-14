/**
 * Desktop `/model` / `/effort` parse + apply.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENTION_SLASH_MARK } from "@/lib/mentionTokens";
import {
  advertisedEffortsForModel,
  desktopSlashCommands,
  isDesktopSlashArgCommand,
  matchEffortExact,
  matchSlashChoice,
  parseSlashInvocation,
  splitModelAndEffort,
} from "@/lib/slashBuiltins";
import { parseLocalSlash } from "@/lib/slashBuiltinsParse";
import {
  applyLocalSlashDraftFromBar,
  applyLocalSlashIntent,
  bindTryLocalSlashFromBar,
  noticeForComposerPrefill,
} from "@/lib/slashBuiltinsApply";

const MODELS = [
  { id: "grok-4.6", label: "Grok 4.6" },
  { id: "grok-4.5", label: "Grok 4.5" },
];

const EFFORTS_46 = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
];

const AGENT_MODELS = [
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    reasoningEfforts: [
      { id: "low" },
      { id: "medium" },
      { id: "high" },
      { id: "xhigh", label: "Extra High" },
    ],
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    reasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
  },
];

/**
 * Per-model advertised lookup used by parse / apply (no family fallback).
 * @param modelId Target catalog id.
 */
function effortsForModel(modelId: string) {
  return advertisedEffortsForModel(modelId, AGENT_MODELS);
}

describe("desktopSlashCommands", () => {
  it("advertises model and effort without the /m alias", () => {
    const names = desktopSlashCommands().map((row) => row.name);
    assert.deepEqual(names, ["model", "effort"]);
    assert.equal(isDesktopSlashArgCommand("m"), true);
    assert.equal(isDesktopSlashArgCommand("review"), false);
  });
});

describe("parseSlashInvocation", () => {
  it("accepts a lone slash line and ignores mixed prose", () => {
    assert.deepEqual(parseSlashInvocation("/model grok-4.6 xhigh"), {
      name: "model",
      args: "grok-4.6 xhigh",
    });
    assert.equal(parseSlashInvocation("please /model grok-4.6"), null);
    assert.deepEqual(parseSlashInvocation("/review the model"), {
      name: "review",
      args: "the model",
    });
  });
});

describe("matchSlashChoice / effort peel", () => {
  it("matches exact id, exact label, and unique substring", () => {
    assert.equal(matchSlashChoice("grok-4.6", MODELS).status, "exact");
    assert.equal(matchSlashChoice("Grok 4.5", MODELS).status, "exact");
    const unique = matchSlashChoice("4.6", MODELS);
    assert.equal(unique.status, "unique");
    assert.equal(matchSlashChoice("grok", MODELS).status, "ambiguous");
    assert.equal(matchSlashChoice("opus", MODELS).status, "none");
  });

  it("peels a trailing effort only when a model query remains", () => {
    const peeled = splitModelAndEffort("grok-4.6 extra high", EFFORTS_46);
    assert.equal(peeled.modelQuery, "grok-4.6");
    assert.equal(peeled.effort?.id, "xhigh");
    const bare = splitModelAndEffort("high", EFFORTS_46);
    assert.equal(bare.modelQuery, "high");
    assert.equal(bare.effort, undefined);
    assert.equal(matchEffortExact("x-high", EFFORTS_46)?.id, "xhigh");
  });
});

describe("advertisedEffortsForModel", () => {
  it("returns only the target model's catalog rows (4.5 has no xhigh)", () => {
    const from45 = advertisedEffortsForModel("grok-4.5", AGENT_MODELS);
    assert.deepEqual(
      from45.map((row) => row.id),
      ["low", "medium", "high"],
    );
    const from46 = advertisedEffortsForModel("grok-4.6", AGENT_MODELS);
    assert.ok(from46.some((row) => row.id === "xhigh"));
    assert.deepEqual(advertisedEffortsForModel("missing", AGENT_MODELS), []);
  });
});

describe("parseLocalSlash", () => {
  it("sets model and optional effort, including the /m alias and slash marks", () => {
    const withEffort = parseLocalSlash("/model grok-4.6 xhigh", MODELS, [], {
      effortsForModel,
    });
    assert.deepEqual(withEffort, {
      kind: "set_model",
      modelId: "grok-4.6",
      modelLabel: "Grok 4.6",
      effortId: "xhigh",
      effortLabel: "Extra High",
    });
    const aliased = parseLocalSlash(`${MENTION_SLASH_MARK}m 4.5`, MODELS, [], {
      effortsForModel,
    });
    assert.equal(aliased.kind, "set_model");
    if (aliased.kind === "set_model") {
      assert.equal(aliased.modelId, "grok-4.5");
      assert.equal(aliased.effortId, undefined);
    }
  });

  it("rejects xhigh on grok-4.5 because that catalog row does not advertise it", () => {
    const rejected = parseLocalSlash("/model grok-4.5 xhigh", MODELS, EFFORTS_46, {
      effortsForModel,
    });
    assert.equal(rejected.kind, "error");
    if (rejected.kind === "error") {
      assert.match(rejected.message, /xhigh/);
      assert.doesNotMatch(rejected.message, /xhigh, /);
    }
    const ok = parseLocalSlash("/model grok-4.5 high", MODELS, [], {
      effortsForModel,
    });
    assert.deepEqual(ok, {
      kind: "set_model",
      modelId: "grok-4.5",
      modelLabel: "Grok 4.5",
      effortId: "high",
      effortLabel: "High",
    });
  });

  it("opens the visual menu on a bare command and errors on unknown args", () => {
    assert.equal(
      parseLocalSlash("/model", MODELS, [], { effortsForModel }).kind,
      "open_model_menu",
    );
    assert.equal(
      parseLocalSlash("/effort", MODELS, [], {
        effortsForModel,
        currentModel: "grok-4.6",
      }).kind,
      "open_effort_menu",
    );
    const unknown = parseLocalSlash("/effort max", MODELS, [], {
      effortsForModel,
      currentModel: "grok-4.6",
    });
    assert.equal(unknown.kind, "error");
    const set = parseLocalSlash("/effort extra high", MODELS, [], {
      effortsForModel,
      currentModel: "grok-4.6",
    });
    assert.deepEqual(set, {
      kind: "set_effort",
      effortId: "xhigh",
      effortLabel: "Extra High",
    });
    const on45 = parseLocalSlash("/effort xhigh", MODELS, EFFORTS_46, {
      effortsForModel,
      currentModel: "grok-4.5",
    });
    assert.equal(on45.kind, "error");
    assert.equal(parseLocalSlash("/compact", MODELS, []).kind, "none");
    assert.equal(parseLocalSlash("/fork", MODELS, []).kind, "fork");
    assert.equal(parseLocalSlash("/rewind", MODELS, []).kind, "rewind");
    assert.equal(parseLocalSlash("/fork now", MODELS, []).kind, "none");
  });
});

describe("applyLocalSlashIntent / bindTryLocalSlashFromBar", () => {
  it("writes model + effort and clears the draft on success", () => {
    const calls: string[] = [];
    const bar = {
      models: MODELS,
      thinkingOptions: EFFORTS_46,
      model: "grok-4.6",
      effortsForModel,
      selectModel: (id: string) => {
        calls.push(`model:${id}`);
      },
      selectEffort: (id: string) => {
        calls.push(`effort:${id}`);
      },
      openModelMenu: () => {
        calls.push("open-model");
      },
      openThinkingMenu: () => {
        calls.push("open-effort");
      },
    };
    const notices: string[] = [];
    let draft = "/model grok-4.6 high";
    const tryLocal = bindTryLocalSlashFromBar(
      bar,
      (text) => {
        notices.push(text);
      },
      () => {
        draft = "";
      },
    );
    assert.equal(tryLocal("/model grok-4.6 high"), true);
    assert.deepEqual(calls, ["model:grok-4.6", "effort:high"]);
    assert.equal(draft, "");
    assert.match(notices[0] ?? "", /Grok 4\.6/);
    assert.equal(tryLocal("/review files"), false);
    draft = "/model nope";
    assert.equal(tryLocal("/model nope"), true);
    assert.equal(draft, "/model nope");
    const errorOutcome = applyLocalSlashIntent(
      { kind: "error", message: "Unknown model" },
      {
        ...bar,
        showNotice: (text) => {
          notices.push(text);
        },
      },
    );
    assert.equal(errorOutcome, "error");
  });

  it("applyLocalSlashDraftFromBar sets the model without requiring clearDraft", () => {
    const calls: string[] = [];
    const bar = {
      models: MODELS,
      thinkingOptions: EFFORTS_46,
      model: "grok-4.5",
      effortsForModel,
      selectModel: (id: string) => {
        calls.push(`model:${id}`);
      },
      selectEffort: (id: string) => {
        calls.push(`effort:${id}`);
      },
      openModelMenu: () => {
        calls.push("open-model");
      },
      openThinkingMenu: () => {
        calls.push("open-effort");
      },
    };
    const notices: string[] = [];
    const outcome = applyLocalSlashDraftFromBar(
      "/model grok-4.6 ",
      bar,
      (text) => {
        notices.push(text);
      },
    );
    assert.equal(outcome, "applied");
    assert.deepEqual(calls, ["model:grok-4.6"]);
    assert.match(notices[0] ?? "", /Grok 4\.6/);
  });

  it("runs fork / rewind when those writers are provided", () => {
    const calls: string[] = [];
    const bar = {
      models: MODELS,
      thinkingOptions: EFFORTS_46,
      model: "grok-4.6",
      effortsForModel,
      selectModel: () => undefined,
      selectEffort: () => undefined,
      openModelMenu: () => undefined,
      openThinkingMenu: () => undefined,
      forkSession: () => {
        calls.push("fork");
      },
      openRewind: () => {
        calls.push("rewind");
      },
    };
    assert.equal(
      applyLocalSlashDraftFromBar("/fork", bar, () => undefined),
      "applied",
    );
    assert.equal(
      applyLocalSlashDraftFromBar("/rewind", bar, () => undefined),
      "applied",
    );
    assert.deepEqual(calls, ["fork", "rewind"]);
  });
});

describe("noticeForComposerPrefill", () => {
  it("tells the user to pick chrome for /model and /effort stubs", () => {
    assert.equal(noticeForComposerPrefill("/model "), "Choose a model");
    assert.equal(noticeForComposerPrefill("/m "), "Choose a model");
    assert.equal(
      noticeForComposerPrefill("/effort "),
      "Choose reasoning effort",
    );
    assert.equal(
      noticeForComposerPrefill("/imagine a cat"),
      "Edit the prompt, then Enter to send",
    );
  });
});
