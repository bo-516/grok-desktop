/**
 * Diff review comments public surface: the panel entry hook, the per-file
 * context model, row-level gutter / slot widgets and the review tray.
 * Upper layers import from `@/widgets/review` only.
 */

export { useReviewCommentsWidget } from "./useReviewCommentsWidget";
export type { ReviewCommentsModel } from "./useReviewCommentsWidget";
export { useDiffCommentFileModel } from "./useDiffCommentFileModel";
export type { DiffCommentFileInput } from "./useDiffCommentFileModel";
export { DiffCommentFileContext, useDiffCommentFile } from "./DiffCommentContext";
export type { DiffCommentFileModel } from "./DiffCommentContext";
export { DiffCommentGutterWidget } from "./DiffCommentGutterWidget";
export type { DiffCommentGutterWidgetProps } from "./DiffCommentGutterWidget";
export { DiffCommentSlotWidget } from "./DiffCommentSlotWidget";
export type { DiffCommentSlotWidgetProps } from "./DiffCommentSlotWidget";
export { ReviewCommentCardView } from "./ReviewCommentCardView";
export type { ReviewCommentCardViewProps } from "./ReviewCommentCardView";
export { ReviewCommentComposerView } from "./ReviewCommentComposerView";
export type { ReviewCommentComposerViewProps } from "./ReviewCommentComposerView";
export { ReviewTrayView } from "./ReviewTrayView";
export type { ReviewTrayViewProps } from "./ReviewTrayView";
