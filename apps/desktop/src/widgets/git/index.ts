/**
 * Git chrome public surface: top-nav branch chip, change-panel action bar
 * (commit / push / PR dialogs) and the shared status badge.
 * Upper layers import from `@/widgets/git` only.
 */

export { GitBranchChipWidget, useGitBranchChipWidget } from "./GitBranchChipWidget";
export { GitBranchChipView } from "./GitBranchChipView";
export type { GitBranchChipViewProps } from "./GitBranchChipView";
export { GitActionBarWidget } from "./GitActionBarWidget";
export type { GitActionBarWidgetProps } from "./GitActionBarWidget";
export { GitActionBarView } from "./GitActionBarView";
export type { GitActionBarViewProps } from "./GitActionBarView";
export { GitCommitDialogView } from "./GitCommitDialogView";
export type { GitCommitDialogViewProps } from "./GitCommitDialogView";
export { GitPrDialogView, prBlocker } from "./GitPrDialogView";
export type { GitPrDialogViewProps, GitPrDraft } from "./GitPrDialogView";
export { GitStatusBadgeView } from "./GitStatusBadgeView";
export { useGitStatusRefresh } from "./useGitStatusRefresh";
