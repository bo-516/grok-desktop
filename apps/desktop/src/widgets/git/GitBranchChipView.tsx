/**
 * Stateless top-nav git chip: branch name + changed-file count. Clicking it
 * opens the git change panel. Renders nothing outside a repository.
 */

import { GitBranch } from "lucide-react";
import type { GitChipModel } from "@/lib/gitPanelModel";

export type GitBranchChipViewProps = {
  /** Chip label / count / tooltip; `visible: false` renders nothing. */
  chip: GitChipModel;
  /** Open the change panel. */
  onOpen: () => void;
};

/**
 * Branch chip button.
 * @param props Chip model + open handler.
 * @returns Button, or null when not in a repo.
 */
export function GitBranchChipView(props: GitBranchChipViewProps) {
  const { chip, onOpen } = props;
  if (!chip.visible) {
    return null;
  }
  return (
    <button
      type="button"
      className="git-chip"
      title={`${chip.title} — open changes`}
      aria-label={`Git: ${chip.title}. Open changes`}
      onClick={onOpen}
      data-kind="git-branch-chip"
    >
      <GitBranch size={12} strokeWidth={1.75} aria-hidden="true" />
      <span className="git-chip-branch">{chip.branch}</span>
      {chip.dirty > 0 ? (
        <span className="git-chip-dirty" aria-hidden="true">
          {chip.dirty}
        </span>
      ) : null}
    </button>
  );
}
