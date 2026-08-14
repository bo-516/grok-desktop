/**
 * Composer bar chrome: agent mode popover + model/thinking menu.
 * `/model` and `/effort` (no args) open the same submenus as the pills.
 * Extracted from useComposerWidget so the main entry stays under the 440-line limit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentMode, AvailableModel } from "@grok-desktop/acp-core";
import { advertisedEffortsForModel } from "@/lib/slashBuiltins";
import {
  defaultComposerControls,
  formatModelLabel,
  formatThinkingLabel,
  loadPreferredModel,
  loadThinkingEffortRaw,
  resolveAgentDefaultModel,
  resolveModelOptions,
  resolveThinkingEffort,
  resolveThinkingOptions,
  savePreferredModel,
  saveThinkingEffort,
  type ThinkingEffort,
} from "./composerModels";
import type { ComposerMenuPanel } from "./ComposerModelMenuView";
import {
  AGENT_MODE_OPTIONS,
  nextMode,
  normalizeAgentMode,
} from "./composerModes";

export type UseComposerBarControlsArgs = {
  /** Confirmed session mode from the store. */
  mode: string | null | undefined;
  /** Optimistic pending mode while bridge applies setMode. */
  pendingMode: AgentMode | null;
  /** Session model id from the store. */
  model: string;
  /** Agent config_option_update snapshot. */
  configOptions: unknown[];
  /** Agent availableModels catalog. */
  availableModels: AvailableModel[];
  /** Store writer for setMode. */
  setMode: (mode: AgentMode) => void;
  /** Store writer for setModel. */
  setModel: (id: string) => void;
};

/**
 * Local mode/model/thinking menus and selection handlers for the composer bar.
 * Thinking options prefer grok-build `config_option_update`, then the matching
 * model's advertised `reasoningEfforts`. No family fallback.
 * @param args Session mode/model + store writers; missing model falls back to preference/catalog.
 * @returns Labels, open state, and handlers for ComposerModeControlView + ComposerModelMenuView.
 */
export function useComposerBarControls(args: UseComposerBarControlsArgs) {
  const {
    mode,
    pendingMode,
    model,
    configOptions,
    availableModels,
    setMode,
    setModel,
  } = args;

  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  /**
   * First paint: session.model is often still empty after refresh. Use the
   * stored preferred model so catalog matching can find advertised efforts.
   */
  const [effort, setEffort] = useState<ThinkingEffort>(() => {
    const initialModel =
      args.model || loadPreferredModel() || args.availableModels[0]?.id || "";
    return resolveThinkingEffort(
      undefined,
      resolveThinkingOptions(undefined, initialModel, args.availableModels),
      loadThinkingEffortRaw(),
      initialModel,
    );
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<ComposerMenuPanel>(null);

  const preferredModel = useMemo(() => loadPreferredModel(), []);
  const effectiveModel =
    model || preferredModel || availableModels[0]?.id || "";
  const models = useMemo(
    () => resolveModelOptions(configOptions, availableModels, effectiveModel),
    [configOptions, availableModels, effectiveModel],
  );
  /** grok-build advertised effort ladder (config, then matching catalog row). */
  const thinkingOptions = useMemo(
    () => resolveThinkingOptions(configOptions, effectiveModel, availableModels),
    [availableModels, configOptions, effectiveModel],
  );
  const modelLabel =
    models.find((m) => m.id === effectiveModel)?.label ??
    formatModelLabel(effectiveModel);
  const effortLabel = formatThinkingLabel(effort, thinkingOptions);
  const confirmedMode = normalizeAgentMode(mode);

  /**
   * When grok-build pushes config options (or the model changes the effort menu),
   * clamp the selected effort to a valid advertised id. Drops stale local prefs
   * the current model does not advertise (e.g. Extra High on Grok 4.5).
   * Never write localStorage here — an empty first-paint menu must not persist
   * a clamp before the catalog arrives.
   */
  useEffect(() => {
    setEffort((prev) =>
      resolveThinkingEffort(
        configOptions,
        thinkingOptions,
        loadThinkingEffortRaw() ?? prev,
        effectiveModel,
      ),
    );
  }, [configOptions, effectiveModel, thinkingOptions]);

  /**
   * Select a mode explicitly from the popover (or ⇧Tab cycle).
   * @param next Target mode.
   */
  const selectMode = useCallback(
    (next: AgentMode) => {
      setModeMenuOpen(false);
      setMode(next);
    },
    [setMode],
  );

  /** Cycle mode via nextMode helper (⇧Tab when composer focused). */
  const cycleMode = useCallback(() => {
    const base = pendingMode ?? confirmedMode;
    selectMode(nextMode(base));
  }, [confirmedMode, pendingMode, selectMode]);

  const closeModeMenu = useCallback(() => {
    setModeMenuOpen(false);
  }, []);

  const toggleModeMenu = useCallback(() => {
    if (pendingMode !== null) {
      return;
    }
    setModeMenuOpen((o) => !o);
  }, [pendingMode]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPanel(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => {
      if (open) {
        setMenuPanel(null);
        return false;
      }
      setMenuPanel("root");
      return true;
    });
  }, []);

  const openPanel = useCallback((panel: ComposerMenuPanel) => {
    setMenuPanel(panel);
  }, []);

  /**
   * Open the model submenu from `/model` with no argument.
   * Closes the mode popover so two chrome menus are never up together.
   */
  const openModelMenu = useCallback(() => {
    setModeMenuOpen(false);
    setMenuOpen(true);
    setMenuPanel("model");
  }, []);

  /**
   * Open the thinking-effort submenu from `/effort` with no argument.
   * Closes the mode popover so two chrome menus are never up together.
   */
  const openThinkingMenu = useCallback(() => {
    setModeMenuOpen(false);
    setMenuOpen(true);
    setMenuPanel("thinking");
  }, []);

  /**
   * Advertised reasoning efforts for one catalog model.
   * Empty when grok-build omitted reasoningEfforts on that row — never a family demo list.
   * @param modelId Target model id or name from `/model` / `/effort`.
   */
  const effortsForModel = useCallback(
    (modelId: string) => advertisedEffortsForModel(modelId, availableModels),
    [availableModels],
  );

  /**
   * Selects a model for the session chrome and persists the preference.
   * @param id Model id from the submenu.
   */
  const selectModel = useCallback(
    (id: string) => {
      setModel(id);
      savePreferredModel(id);
      setMenuPanel("root");
    },
    [setModel],
  );

  /**
   * Selects thinking intensity and persists it for the next open.
   * @param id Effort level id.
   */
  const selectEffort = useCallback((id: ThinkingEffort) => {
    setEffort(id);
    saveThinkingEffort(id);
    setMenuPanel("root");
  }, []);

  /**
   * Resets model + thinking to agent defaults and closes the menu.
   * Effort uses agent currentValue when present, else the advertised default.
   */
  const resetControls = useCallback(() => {
    const agentDefault = resolveAgentDefaultModel(
      configOptions,
      models,
      model,
    );
    const defaults = defaultComposerControls(
      agentDefault,
      configOptions,
      availableModels,
    );
    if (defaults.modelId) {
      setModel(defaults.modelId);
      savePreferredModel(defaults.modelId);
    }
    setEffort(defaults.effort);
    saveThinkingEffort(defaults.effort);
    closeMenu();
  }, [availableModels, closeMenu, configOptions, model, models, setModel]);

  return {
    confirmedMode,
    modeMenuOpen,
    modeOptions: AGENT_MODE_OPTIONS,
    selectMode,
    cycleMode,
    closeModeMenu,
    toggleModeMenu,
    effort,
    effortLabel,
    menuOpen,
    menuPanel,
    model: effectiveModel,
    modelLabel,
    models,
    openPanel,
    openModelMenu,
    openThinkingMenu,
    effortsForModel,
    resetControls,
    selectEffort,
    selectModel,
    closeMenu,
    toggleMenu,
    thinkingOptions,
  };
}
