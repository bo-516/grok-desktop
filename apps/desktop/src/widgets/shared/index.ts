/**
 * Cross-feature stateless presentation shared by composer, timeline, and menus.
 * Consumers import from `@/widgets/shared` — never from the stateless/ internals.
 */

export { MentionChipView } from "./stateless/MentionChipView";
export { MentionIconView } from "./stateless/MentionIconView";
export type { MentionIconKind } from "./stateless/MentionIconView";
export { MentionTextView } from "./stateless/MentionTextView";
