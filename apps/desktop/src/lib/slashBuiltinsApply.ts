/**
 * Apply desktop `/model` / `/effort` intents to composer chrome.
 * Kept separate from parse/match so slashBuiltins.ts stays under the line cap.
 */

import {
  isDesktopSlashArgCommand,
  parseSlashInvocation,
  type LocalSlashIntent,
  type SlashChoice,
} from "@/lib/slashBuiltins";
import { parseLocalSlash } from "@/lib/slashBuiltinsParse";

/** Result of applying {@link LocalSlashIntent} so the composer can clear or keep the draft. */
export type LocalSlashApplyResult = "none" | "applied" | "error";

/**
 * Writers the composer supplies so this module never imports the session store.
 * Unused kinds are ignored when the intent does not need them.
 */
export type LocalSlashActions = {
  /** Apply a catalog model id (ACP setModel + local preference). */
  selectModel: (id: string) => void;
  /** Apply a reasoning-effort wire id (local preference / next spawn). */
  selectEffort: (id: string) => void;
  /** Open the visual model submenu when `/model` has no argument. */
  openModelMenu: () => void;
  /** Open the visual thinking submenu when `/effort` has no argument. */
  openThinkingMenu: () => void;
  /** Status-line notice; warn stays until the next send. */
  showNotice: (text: string, tone: "info" | "warn") => void;
  /**
   * Desktop session fork (same RPC as the ⋯ menu / ⌘K).
   * Omitted leaves a bare `/fork` as `none` so tests without a store still send.
   */
  forkSession?: () => void;
  /**
   * Open the rewind confirm dialog (same event as ⌘K Rewind…).
   * Omitted leaves a bare `/rewind` as `none`.
   */
  openRewind?: () => void;
};

/** Notice channel plus draft clear used by {@link bindTryLocalSlash}. */
export type LocalSlashIO = {
  showNotice: (text: string, tone: "info" | "warn") => void;
  /** Wipe the composer after a successful local command. */
  clearDraft: () => void;
};

/** Composer bar slice needed to intercept `/model` / `/effort` on send. */
export type LocalSlashBar = {
  models: SlashChoice[];
  thinkingOptions: SlashChoice[];
  /** Live session model id for bare `/effort`. */
  model: string;
  /**
   * Agent-advertised efforts for a model id. Empty means that model has none.
   * Must not return family fallbacks or injected Extra High.
   */
  effortsForModel: (modelId: string) => SlashChoice[];
  selectModel: (id: string) => void;
  selectEffort: (id: string) => void;
  openModelMenu: () => void;
  openThinkingMenu: () => void;
  /** Optional; same as {@link LocalSlashActions.forkSession}. */
  forkSession?: () => void;
  /** Optional; same as {@link LocalSlashActions.openRewind}. */
  openRewind?: () => void;
};

/**
 * Status-line copy after a ⌘K slash stub lands in the composer.
 * `/model` / `/effort` are chrome picks (Enter applies), not prompts to send.
 * @param text Prefill draft; empty should be ignored by the caller before this runs.
 * @returns Short hint; never empty.
 */
export function noticeForComposerPrefill(text: string): string {
  const invocation = parseSlashInvocation(text);
  if (invocation && isDesktopSlashArgCommand(invocation.name)) {
    return invocation.name === "effort"
      ? "Choose reasoning effort"
      : "Choose a model";
  }
  return "Edit the prompt, then Enter to send";
}

/**
 * Apply a parsed desktop slash intent through composer callbacks.
 * `none` is a no-op so the caller can fall through to sendPrompt.
 * @param intent Result of {@link parseLocalSlash}.
 * @param actions Store / menu / notice writers; unused kinds are ignored.
 * @returns `applied` (clear draft), `error` (keep draft), or `none` (send).
 */
export function applyLocalSlashIntent(
  intent: LocalSlashIntent,
  actions: LocalSlashActions,
): LocalSlashApplyResult {
  if (intent.kind === "none") {
    return "none";
  }
  if (intent.kind === "error") {
    actions.showNotice(intent.message, "warn");
    return "error";
  }
  if (intent.kind === "open_model_menu") {
    actions.openModelMenu();
    actions.showNotice("Choose a model", "info");
    return "applied";
  }
  if (intent.kind === "open_effort_menu") {
    actions.openThinkingMenu();
    actions.showNotice("Choose reasoning effort", "info");
    return "applied";
  }
  if (intent.kind === "set_model") {
    actions.selectModel(intent.modelId);
    if (intent.effortId) {
      actions.selectEffort(intent.effortId);
    }
    const effortBit = intent.effortLabel ? ` · ${intent.effortLabel}` : "";
    actions.showNotice(`Model set to ${intent.modelLabel}${effortBit}`, "info");
    return "applied";
  }
  if (intent.kind === "set_effort") {
    actions.selectEffort(intent.effortId);
    actions.showNotice(`Reasoning effort set to ${intent.effortLabel}`, "info");
    return "applied";
  }
  if (intent.kind === "fork") {
    if (!actions.forkSession) {
      return "none";
    }
    actions.forkSession();
    actions.showNotice("Forking session…", "info");
    return "applied";
  }
  if (!actions.openRewind) {
    return "none";
  }
  actions.openRewind();
  return "applied";
}

/** Catalogs {@link parseLocalSlash} needs; empty lists still claim `/model`/`/effort`. */
export type LocalSlashCatalogs = {
  models: SlashChoice[];
  efforts: SlashChoice[];
  effortsForModel?: (modelId: string) => SlashChoice[];
  currentModel?: string;
};

/**
 * Parse a draft and apply it as a desktop slash.
 * Does not clear the composer — callers decide (submit vs argument pick).
 * @param draft Raw or mention-marked `/model` / `/effort` line.
 * @param catalogs Live picker rows; empty catalogs still claim the commands.
 * @param actions Store / menu / notice writers.
 * @returns `applied` / `error` / `none` from {@link applyLocalSlashIntent}.
 */
export function applyLocalSlashDraft(
  draft: string,
  catalogs: LocalSlashCatalogs,
  actions: LocalSlashActions,
): LocalSlashApplyResult {
  const intent = parseLocalSlash(draft, catalogs.models, catalogs.efforts, {
    effortsForModel: catalogs.effortsForModel,
    currentModel: catalogs.currentModel,
  });
  return applyLocalSlashIntent(intent, actions);
}

/**
 * Apply a pick-built `/model` / `/effort` draft through the composer bar.
 * The completion hook clears the field only after this returns `applied`.
 * @param draft Line after replacing the active argument token.
 * @param bar Live catalogs and the same writers the visual menus use.
 * @param showNotice Status-line writer for success / error copy.
 * @returns `applied` when chrome changed, `error` when the claimed slash failed, `none` when the agent should receive it.
 */
export function applyLocalSlashDraftFromBar(
  draft: string,
  bar: LocalSlashBar,
  showNotice: (text: string, tone: "info" | "warn") => void,
): LocalSlashApplyResult {
  return applyLocalSlashDraft(
    draft,
    {
      models: bar.models,
      efforts: bar.thinkingOptions,
      effortsForModel: bar.effortsForModel,
      currentModel: bar.model,
    },
    {
      selectModel: bar.selectModel,
      selectEffort: bar.selectEffort,
      openModelMenu: bar.openModelMenu,
      openThinkingMenu: bar.openThinkingMenu,
      forkSession: bar.forkSession,
      openRewind: bar.openRewind,
      showNotice,
    },
  );
}

/**
 * Bind parse + apply with the live model / effort catalogs.
 * @param catalogs Current picker rows; empty catalogs still claim `/model`/`/effort`.
 * @param actions Store / menu writers (notice lives on `io`).
 * @param io Notice + draft clear.
 * @returns True when submit should stop (applied or error).
 */
export function bindTryLocalSlash(
  catalogs: LocalSlashCatalogs,
  actions: Omit<LocalSlashActions, "showNotice">,
  io: LocalSlashIO,
): (draft: string) => boolean {
  return (draft: string) => {
    const outcome = applyLocalSlashDraft(draft, catalogs, {
      ...actions,
      showNotice: io.showNotice,
    });
    if (outcome === "applied") {
      io.clearDraft();
      return true;
    }
    return outcome === "error";
  };
}

/**
 * One-line composer bind: bar catalogs + writers + notice/draft IO.
 * @param bar Live model/effort catalogs and the same writers the visual menus use.
 * @param showNotice Composer status-line writer.
 * @param clearDraft Wipe the draft after a successful local command.
 * @returns True when submit should stop (applied or error).
 */
export function bindTryLocalSlashFromBar(
  bar: LocalSlashBar,
  showNotice: (text: string, tone: "info" | "warn") => void,
  clearDraft: () => void,
): (draft: string) => boolean {
  return bindTryLocalSlash(
    {
      models: bar.models,
      efforts: bar.thinkingOptions,
      effortsForModel: bar.effortsForModel,
      currentModel: bar.model,
    },
    {
      selectModel: bar.selectModel,
      selectEffort: bar.selectEffort,
      openModelMenu: bar.openModelMenu,
      openThinkingMenu: bar.openThinkingMenu,
      forkSession: bar.forkSession,
      openRewind: bar.openRewind,
    },
    { showNotice, clearDraft },
  );
}
