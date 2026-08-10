/**
 * Stateful project switcher for the current chat (Codex-style).
 * Mounted on the composer bar (session context, not the rail catalog).
 * Empty sessions can switch project or create one; sessions with user/agent
 * messages lock the control so the cwd cannot change mid-conversation.
 * "No project" is sticky via prefs.noProject so bridge default cwd cannot
 * overwrite the selection after a few seconds.
 */

import cs from "classnames";
import { ChevronDown, Folder, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sessionHasConversationContent } from "@/lib/sessionContent";
import {
  collectProjectWorkspacePaths,
  loadWorkspacePrefs,
  resolvePreferredWorkspace,
  workspaceDisplayName,
} from "@/lib/workspacePrefs";
import { useSessionStore } from "@/store/sessionStore";
import { CreateProjectDialogView } from "./CreateProjectDialogView";
import { ProjectSwitcherMenuView } from "./ProjectSwitcherMenuView";

/**
 * Derive a project name from an absolute folder path (last segment).
 * @param folderPath Absolute path the user typed.
 * @returns Basename or empty when path is empty.
 */
function nameFromFolderPath(folderPath: string): string {
  return workspaceDisplayName(folderPath.trim()) === "No project"
    ? ""
    : workspaceDisplayName(folderPath.trim());
}

/**
 * Project switcher trigger + menu + create dialog, bound to the live store.
 * @returns Composer-bar control for the open session's workspace.
 */
export function ProjectSwitcherWidget() {
  const session = useSessionStore((s) => s.session);
  const catalog = useSessionStore((s) => s.catalog);
  const setWorkspace = useSessionStore((s) => s.setWorkspace);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPath, setCreatePath] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Bumps when prefs mutate so the list/label re-read localStorage. */
  const [prefsTick, setPrefsTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const locked = sessionHasConversationContent(session.timeline);
  const prefs = useMemo(() => loadWorkspacePrefs(), [prefsTick, menuOpen]);
  // Unlocked: prefs (incl. noProject) win. Locked: show the real chat cwd.
  const activeWorkspace = locked
    ? session.workspace.trim()
    : resolvePreferredWorkspace(prefs, session.workspace);
  const displayName = workspaceDisplayName(activeWorkspace);

  const projects = useMemo(() => {
    const fromCatalog = catalog
      .map((r) => r.workspace)
      .filter((w) => Boolean(w?.trim()));
    return collectProjectWorkspacePaths(
      prefs.knownWorkspaces,
      fromCatalog,
      activeWorkspace || prefs.activeWorkspace,
    );
  }, [catalog, activeWorkspace, prefs.knownWorkspaces, prefs.activeWorkspace]);

  /**
   * Close the floating menu (keeps create dialog independent).
   */
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      const el = rootRef.current;
      if (!el) {
        return;
      }
      if (!el.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  /**
   * Apply a project path when the session is empty.
   * @param path Absolute workspace or empty for no project.
   */
  const applyWorkspace = useCallback(
    async (path: string) => {
      if (locked) {
        return;
      }
      setSubmitting(true);
      try {
        await setWorkspace(path || null);
        setPrefsTick((n) => n + 1);
        closeMenu();
        setCreateOpen(false);
      } finally {
        setSubmitting(false);
      }
    },
    [locked, setWorkspace, closeMenu],
  );

  /**
   * Open create dialog from the menu footer.
   */
  const openCreate = useCallback(() => {
    if (locked) {
      return;
    }
    closeMenu();
    setCreateName("");
    setCreatePath("");
    setNameTouched(false);
    setCreateOpen(true);
  }, [locked, closeMenu]);

  /**
   * Submit create-project: remember path as known + activate when unlocked.
   */
  const submitCreate = useCallback(async () => {
    const path = createPath.trim();
    if (!path || locked) {
      return;
    }
    await applyWorkspace(path);
  }, [createPath, locked, applyWorkspace]);

  const triggerTitle = locked
    ? `${activeWorkspace || "No project"} — locked after messages (New chat to switch)`
    : activeWorkspace || "Choose a project for this chat";

  return (
    <div className="project-switcher" ref={rootRef}>
      <button
        type="button"
        className={cs("project-switcher-trigger", {
          "project-switcher-trigger-open": menuOpen,
          "project-switcher-trigger-locked": locked,
        })}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={
          locked
            ? `Project ${displayName} (locked)`
            : `Project ${displayName}`
        }
        title={triggerTitle}
        onClick={() => {
          setMenuOpen((o) => !o);
          setQuery("");
        }}
      >
        {locked ? (
          <Lock
            className="project-switcher-trigger-icon"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : (
          <Folder
            className="project-switcher-trigger-icon"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
        <span className="project-switcher-trigger-label">{displayName}</span>
        <ChevronDown
          className="project-switcher-trigger-chevron"
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {menuOpen ? (
        <ProjectSwitcherMenuView
          query={query}
          projects={projects}
          activeWorkspace={activeWorkspace}
          locked={locked}
          onQueryChange={setQuery}
          onSelectProject={(path) => void applyWorkspace(path)}
          onCreateProject={openCreate}
          onClearProject={() => void applyWorkspace("")}
        />
      ) : null}

      <CreateProjectDialogView
        open={createOpen}
        name={createName}
        folderPath={createPath}
        submitting={submitting}
        onNameChange={(v) => {
          setNameTouched(true);
          setCreateName(v);
        }}
        onFolderPathChange={(v) => {
          setCreatePath(v);
          if (!nameTouched) {
            setCreateName(nameFromFolderPath(v));
          }
        }}
        onSubmit={() => void submitCreate()}
        onCancel={() => {
          if (!submitting) {
            setCreateOpen(false);
          }
        }}
      />
    </div>
  );
}
