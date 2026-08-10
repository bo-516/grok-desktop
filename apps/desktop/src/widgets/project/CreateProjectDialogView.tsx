/**
 * Codex-style Create project modal: project name + source folder path.
 * Stateless — parent owns open state, field values, and submit/cancel.
 * Browser cannot expose a real absolute path from a directory picker, so the
 * source folder is an absolute-path text field (paste / type).
 */

import cs from "classnames";
import { FolderPlus, X } from "lucide-react";
import { FadeContent } from "@/components/react-bits";

export type CreateProjectDialogViewProps = {
  open: boolean;
  /** Project display name (defaults to folder basename when parent sets it). */
  name: string;
  /** Absolute filesystem path for the agent cwd. */
  folderPath: string;
  /** True while create / setWorkspace is in flight. */
  submitting?: boolean;
  onNameChange: (value: string) => void;
  onFolderPathChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

/**
 * Modal for naming a project and binding an absolute source folder.
 * @param props Controlled fields + handlers; returns null when closed.
 */
export function CreateProjectDialogView(props: CreateProjectDialogViewProps) {
  if (!props.open) {
    return null;
  }
  const pathOk = props.folderPath.trim().length > 0;
  const nameOk = props.name.trim().length > 0;
  const canSubmit = pathOk && nameOk && !props.submitting;

  return (
    <div className="modal-backdrop" role="presentation">
      <FadeContent immediate durationMs={240}>
        <div
          className="create-project-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
        >
          <div className="create-project-dialog-head">
            <h2 id="create-project-title" className="modal-title">
              Create project
            </h2>
            <button
              type="button"
              className="create-project-dialog-close"
              title="Close"
              aria-label="Close create project"
              onClick={props.onCancel}
            >
              <X className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <label className="create-project-field">
            <span className="create-project-field-label">Project name</span>
            <span className="create-project-name-row">
              <FolderPlus
                className="create-project-name-icon"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <input
                className="create-project-name-input"
                type="text"
                placeholder="Project name"
                value={props.name}
                onChange={(e) => props.onNameChange(e.target.value)}
                autoFocus
              />
            </span>
          </label>

          <div className="create-project-folder-block">
            <span className="create-project-field-label">Source folder</span>
            <label className="create-project-folder-zone">
              <FolderPlus
                className="create-project-folder-icon"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="create-project-folder-hint">
                Absolute path Grok can read and edit
              </span>
              <input
                className="create-project-folder-input"
                type="text"
                placeholder="/Users/you/code/my-project"
                value={props.folderPath}
                onChange={(e) => props.onFolderPathChange(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={props.onCancel}
              disabled={props.submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cs("btn btn-primary", {
                "opacity-45 cursor-not-allowed": !canSubmit,
              })}
              disabled={!canSubmit}
              onClick={props.onSubmit}
            >
              {props.submitting ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </FadeContent>
    </div>
  );
}
