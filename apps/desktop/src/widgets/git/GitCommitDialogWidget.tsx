/**
 * Stateful commit dialog: owns the message draft and file selection (typing
 * stays local, never in a store). Mounted only while open, so every opening
 * starts from "all changed files selected" and an empty message.
 */

import { useCallback, useState } from "react";
import { commitPathsForSelection } from "@/lib/gitPanelModel";
import type { GitStatusFile } from "@/lib/gitTypes";
import { GitCommitDialogView } from "./GitCommitDialogView";

export type GitCommitDialogWidgetProps = {
  /** Branch shown in the description. */
  branch: string;
  /** Changed files at open time. */
  files: GitStatusFile[];
  /** Commit request in flight. */
  busy: boolean;
  /**
   * Run the commit.
   * @param req Message + paths (renames include their source).
   * @returns Error text to show inline, or null on success (parent closes).
   */
  onCommit: (req: { message: string; paths: string[] }) => Promise<string | null>;
  /** Close without committing. */
  onClose: () => void;
};

/**
 * Commit dialog with local form state.
 * @param props Files, busy flag and commit / close callbacks.
 * @returns GitCommitDialogView.
 */
export function GitCommitDialogWidget(props: GitCommitDialogWidgetProps) {
  const { files, onCommit } = props;
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(files.map((f) => f.path)),
  );
  const [error, setError] = useState("");

  const onToggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const onToggleAll = useCallback(
    (all: boolean) => setSelected(all ? new Set(files.map((f) => f.path)) : new Set()),
    [files],
  );

  const onSubmit = useCallback(() => {
    setError("");
    void onCommit({ message, paths: commitPathsForSelection(files, selected) }).then(
      (err) => {
        if (err) {
          setError(err);
        }
      },
    );
  }, [files, message, onCommit, selected]);

  return (
    <GitCommitDialogView
      branch={props.branch}
      files={files}
      selected={selected}
      message={message}
      busy={props.busy}
      error={error}
      onMessageChange={setMessage}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      onSubmit={onSubmit}
      onClose={props.onClose}
    />
  );
}
