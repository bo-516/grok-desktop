/**
 * Composer bar chrome: agent mode popover + model/thinking menu.
 * Extracted from useComposerWidget so the main entry stays under the 440-line limit.
 */

import { useCallback, useMemo, useState } from "react";
import type { AgentMode, AvailableModel } from "@grok-desktop/acp-core";
import {
  defaultComposerControls,
  formatModelLabel,
  formatThinkingLabel,
  loadPreferredModel,
  loadThinkingEffort,
  resolveAgentDefaultModel,
  resolveModelOptions,
  savePreferredModel,
  saveThinkingEffort,
  THINKING_OPTIONS,
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
  const [effort, setEffort] = useState<ThinkingEffort>(() => loadThinkingEffort());
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<ComposerMenuPanel>(null);

  const preferredModel = useMemo(() => loadPreferredModel(), []);
  const effectiveModel =
    model || preferredModel || availableModels[0]?.id || "";
  const models = useMemo(
    () => resolveModelOptions(configOptions, availableModels, effectiveModel),
    [configOptions, availableModels, effectiveModel],
  );
  const modelLabel =
    models.find((m) => m.id === effectiveModel)?.label ??
    formatModelLabel(effectiveModel);
  const effortLabel = formatThinkingLabel(effort);
  const confirmedMode = normalizeAgentMode(mode);

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
   * Resets model + thinking to agent/product defaults and closes the menu.
   */
  const resetControls = useCallback(() => {
    const agentDefault = resolveAgentDefaultModel(
      configOptions,
      models,
      model,
    );
    const defaults = defaultComposerControls(agentDefault);
    if (defaults.modelId) {
      setModel(defaults.modelId);
      savePreferredModel(defaults.modelId);
    }
    setEffort(defaults.effort);
    saveThinkingEffort(defaults.effort);
    closeMenu();
  }, [closeMenu, configOptions, model, models, setModel]);

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
    resetControls,
    selectEffort,
    selectModel,
    closeMenu,
    toggleMenu,
    thinkingOptions: THINKING_OPTIONS,
  };
}
