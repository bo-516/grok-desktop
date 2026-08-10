/**
 * Turn-end change summary: "Edited N files +A −R" → open changeset preview.
 */

import type { ChangeSet } from "@/lib/changeSet";

export type TurnChangeSummaryViewProps = {
  /** Aggregated change set for this turn. */
  changeSet: ChangeSet;
  /** Open the preview drawer on the turn changeset. */
  onOpen: () => void;
};

/**
 * Compact turn footer when the turn produced any file edits.
 * @param props Change set + open handler.
 */
export function TurnChangeSummaryView(props: TurnChangeSummaryViewProps) {
  const { changeSet, onOpen } = props;
  if (changeSet.fileCount === 0) {
    return null;
  }
  const fileLabel =
    changeSet.fileCount === 1
      ? "1 file"
      : `${changeSet.fileCount} files`;
  return (
    <button
      type="button"
      className="turn-change-summary"
      data-kind="turn-change-summary"
      onClick={onOpen}
      title="Open change set preview"
    >
      <span className="turn-change-summary-label">
        Edited {fileLabel}
      </span>
      <span className="preview-count-add">+{changeSet.added}</span>
      <span className="preview-count-del">−{changeSet.removed}</span>
      <span className="edit-summary-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
