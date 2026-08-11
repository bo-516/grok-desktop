/**
 * Cross-feature stateless presentation (plus the small interaction hooks those
 * views need) shared by composer, timeline, and menus.
 * Consumers import from `@/widgets/shared` — never from the stateless/ internals.
 */

export { CollapsibleStepView } from "./stateless/CollapsibleStepView";
export type {
  CollapsibleStepVariant,
  CollapsibleStepViewProps,
} from "./stateless/CollapsibleStepView";
export { ImageLightboxView } from "./stateless/ImageLightboxView";
export type { ImageLightboxViewProps } from "./stateless/ImageLightboxView";
export { MentionChipView } from "./stateless/MentionChipView";
export { MentionIconView } from "./stateless/MentionIconView";
export type { MentionIconKind } from "./stateless/MentionIconView";
export { MentionTextView } from "./stateless/MentionTextView";
export { PathLabelView } from "./stateless/PathLabelView";
export type { PathLabelViewProps } from "./stateless/PathLabelView";
export { useCodeHighlight } from "./useCodeHighlight";
export { CodeLineView } from "./stateless/CodeLineView";
export type { CodeLineViewProps } from "./stateless/CodeLineView";
export { useCopyFeedback } from "./useCopyFeedback";
export type { CopyFeedback } from "./useCopyFeedback";
