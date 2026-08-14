/** Composer feature export; consumers should only use this entry for the stateful surface. */

export { ComposerWidget } from "./ComposerWidget";
export { useComposerWidget } from "./useComposerWidget";
export { useComposerSlashCatalog } from "./useComposerSlashCatalog";
export { isComposerImeKey } from "./composerIme";
export { ComposerQueueView } from "./ComposerQueueView";
export type { ComposerQueueViewProps } from "./ComposerQueueView";
export { useComposerQueue } from "./useComposerQueue";
export { ComposerModeControlView } from "./ComposerModeControlView";
export {
  AGENT_MODE_OPTIONS,
  modeLabel,
  nextMode,
  normalizeAgentMode,
} from "./composerModes";
export {
  DEFAULT_THINKING_OPTIONS,
  formatModelLabel,
  modelsFromAvailableModels,
  resolveAgentDefaultModel,
  resolveModelOptions,
  resolveThinkingEffort,
  resolveThinkingOptions,
  THINKING_OPTIONS,
} from "./composerModels";
