/**
 * Stateless commit dialog: message, changed-file checklist (all selected by
 * default), inline git error. The parent widget owns every value.
 */

import cs from "classnames";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { GitStatusFile } from "@/lib/gitTypes";
import { GitStatusBadgeView } from "./GitStatusBadgeView";

export type GitCommitDialogViewProps = {
  /** Branch the commit lands on ("" when detached). */
  branch: string;
  /** Changed files from git status (repo-relative). */
  files: GitStatusFile[];
  /** Selected current paths. */
  selected: ReadonlySet<string>;
  /** Commit message draft. */
  message: string;
  /** Commit request in flight (disables the form). */
  busy: boolean;
  /** Last git error, verbatim; "" when none. */
  error: string;
  /** Message edits. */
  onMessageChange: (next: string) => void;
  /** Toggle one path. */
  onToggle: (path: string) => void;
  /** Select all (true) or none (false). */
  onToggleAll: (all: boolean) => void;
  /** Submit (button or ⌘/Ctrl+Enter). */
  onSubmit: () => void;
  /** Close request (Escape / overlay / Cancel). */
  onClose: () => void;
};

/**
 * Commit form inside a shadcn Dialog.
 * @param props Values + handlers from GitCommitDialogWidget.
 * @returns Open dialog.
 */
export function GitCommitDialogView(props: GitCommitDialogViewProps) {
  const { files, selected, message, busy, error } = props;
  const count = files.filter((f) => selected.has(f.path)).length;
  const allSelected = count === files.length && files.length > 0;
  const canSubmit = !busy && count > 0 && message.trim() !== "";
  /** Form submit and ⌘/Ctrl+Enter share one guarded path. */
  const submit = (e: Pick<FormEvent, "preventDefault">) => {
    e.preventDefault();
    if (canSubmit) {
      props.onSubmit();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent aria-describedby="git-commit-desc">
        <form className="flex flex-col gap-3.5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription id="git-commit-desc">
              {props.branch ? `On ${props.branch}. ` : "Detached HEAD. "}
              Hooks run as usual; other staged changes stay staged.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={message}
            placeholder="Commit message"
            aria-label="Commit message"
            className="max-h-[200px] font-mono"
            disabled={busy}
            autoFocus
            onChange={(e) => props.onMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                submit(e);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="git-field-label">
              {count} of {files.length} file{files.length === 1 ? "" : "s"} selected
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy || files.length === 0}
              onClick={() => props.onToggleAll(!allSelected)}
            >
              {allSelected ? "Select none" : "Select all"}
            </Button>
          </div>
          <div className="git-commit-files" role="group" aria-label="Files to commit">
            {files.map((f) => (
              <div
                key={f.path}
                className={cs("git-commit-file", { "opacity-60": !selected.has(f.path) })}
              >
                <Checkbox
                  checked={selected.has(f.path)}
                  disabled={busy}
                  onChange={() => props.onToggle(f.path)}
                  aria-label={`Include ${f.path}`}
                />
                <GitStatusBadgeView kind={f.kind} />
                <span className="git-commit-file-path" title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
                  {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                </span>
              </div>
            ))}
          </div>
          {error ? <pre className="git-dialog-error">{error}</pre> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "Committing…" : `Commit ${count} file${count === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
