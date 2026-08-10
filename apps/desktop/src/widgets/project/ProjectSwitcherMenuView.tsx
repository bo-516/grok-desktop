/**
 * Codex-style project switcher menu: search, project list with checkmark,
 * Create project, Work without a project. Pure presentation.
 */

import cs from "classnames";
import { Check, Folder, Plus, X } from "lucide-react";
import { workspaceDisplayName } from "@/lib/workspacePrefs";

export type ProjectSwitcherMenuViewProps = {
  /** Filter query for project names / paths. */
  query: string;
  /** Absolute workspace paths to list. */
  projects: string[];
  /** Currently selected / session workspace (empty = no project). */
  activeWorkspace: string;
  /** When true, selection rows are non-interactive (session has content). */
  locked: boolean;
  onQueryChange: (value: string) => void;
  /** Pick an existing project path. */
  onSelectProject: (workspace: string) => void;
  /** Open create-project dialog. */
  onCreateProject: () => void;
  /** Clear workspace (work outside any project). */
  onClearProject: () => void;
};

/**
 * Floating menu body for the project switcher (no trigger).
 * @param props Search, list, and footer actions from the parent widget.
 */
export function ProjectSwitcherMenuView(props: ProjectSwitcherMenuViewProps) {
  const {
    query,
    projects,
    activeWorkspace,
    locked,
    onQueryChange,
    onSelectProject,
    onCreateProject,
    onClearProject,
  } = props;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => {
        const name = workspaceDisplayName(p).toLowerCase();
        return name.includes(q) || p.toLowerCase().includes(q);
      })
    : projects;
  const noProjectActive = !activeWorkspace.trim();

  return (
    <div className="project-switcher-menu" role="menu">
      <label className="project-switcher-search-wrap">
        <span className="project-switcher-search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          className="project-switcher-search"
          type="search"
          placeholder="Search projects"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search projects"
          autoFocus
        />
      </label>

      <div className="project-switcher-list">
        {filtered.length === 0 ? (
          <div className="project-switcher-empty">
            {q ? "No matching projects" : "No projects yet"}
          </div>
        ) : (
          filtered.map((path) => {
            const selected = path === activeWorkspace;
            const label = workspaceDisplayName(path);
            return (
              <button
                key={path}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cs("project-switcher-item", {
                  "project-switcher-item-active": selected,
                  "project-switcher-item-locked": locked && !selected,
                })}
                title={
                  locked && !selected
                    ? `${path} — workspace locked after messages (New chat to switch)`
                    : path
                }
                disabled={locked && !selected}
                onClick={() => {
                  if (!locked) {
                    onSelectProject(path);
                  }
                }}
              >
                <Folder
                  className="project-switcher-item-icon"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="project-switcher-item-label">{label}</span>
                {selected ? (
                  <Check
                    className="project-switcher-item-check"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <div className="project-switcher-footer">
        <button
          type="button"
          role="menuitem"
          className={cs("project-switcher-item", {
            "project-switcher-item-locked": locked,
          })}
          disabled={locked}
          title={
            locked
              ? "Workspace locked after messages — New chat first"
              : "Create a project from a folder"
          }
          onClick={onCreateProject}
        >
          <Plus
            className="project-switcher-item-icon"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="project-switcher-item-label">Create project</span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={noProjectActive}
          className={cs("project-switcher-item", {
            "project-switcher-item-active": noProjectActive,
            "project-switcher-item-locked": locked && !noProjectActive,
          })}
          disabled={locked && !noProjectActive}
          title={
            locked && !noProjectActive
              ? "Workspace locked after messages — New chat first"
              : "Work without a project folder"
          }
          onClick={() => {
            if (!locked) {
              onClearProject();
            }
          }}
        >
          <X
            className="project-switcher-item-icon"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="project-switcher-item-label">
            Work without a project
          </span>
          {noProjectActive ? (
            <Check
              className="project-switcher-item-check"
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : null}
        </button>
      </div>
    </div>
  );
}
