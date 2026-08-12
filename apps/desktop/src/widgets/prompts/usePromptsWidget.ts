/**
 * Unified entry hook for the Rules & prompts page.
 * Composes userPrompts store + environment inspect evidence + session runCli.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEntry,
  overriddenEntryIds,
  removeEntry,
  reorderEntries,
  updateEntry,
  type PromptCategory,
  type PromptScope,
} from "@/lib/userPrompts";
import {
  useEnvironmentStore,
  formatLoadedAgo,
} from "@/store/environmentStore";
import { useSessionStore } from "@/store/sessionStore";
import { useUserPromptsStore } from "@/store/userPromptsStore";
import type { PromptScopeSectionViewProps } from "./PromptScopeSectionView";

const SCOPES: PromptScope[] = ["global", "project", "projectLocal"];

/**
 * Shorten absolute paths for section headers (§6.4: path explains scope).
 * Global prefers `~/.grok/…`; project prefers path relative to projectRoot.
 * @param abs Absolute path from bridge.
 * @param projectRoot Project root for relative display.
 * @param scope Scope id.
 */
export function formatPromptPathLabel(
  abs: string,
  projectRoot: string | null,
  scope: PromptScope,
): string {
  if (!abs) {
    return "";
  }
  if (scope === "global") {
    // Prefer ~/.grok/… when the path lives under a .grok tree.
    const idx = abs.replace(/\\/g, "/").indexOf("/.grok/");
    if (idx >= 0) {
      return `~/.grok/${abs.slice(idx + "/.grok/".length)}`;
    }
    // Custom GROK_HOME (tests / sandbox): show trailing rules/file.
    const rulesIdx = abs.replace(/\\/g, "/").lastIndexOf("/rules/");
    if (rulesIdx >= 0) {
      return `…${abs.slice(rulesIdx)}`;
    }
    return abs;
  }
  if (projectRoot) {
    const normAbs = abs.replace(/\\/g, "/");
    const normRoot = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
    if (normAbs === normRoot || normAbs.startsWith(`${normRoot}/`)) {
      const rel = normAbs.slice(normRoot.length).replace(/^\//, "");
      return rel || abs;
    }
  }
  return abs;
}

/**
 * Rough token label from byte length (~4 chars/token).
 * @param bytes File bytes.
 */
export function tokenLabelFromBytes(bytes: number): string | null {
  if (!bytes || bytes <= 0) {
    return null;
  }
  const tok = Math.max(1, Math.round(bytes / 4));
  return `${tok} tok`;
}

type Drafts = Record<PromptScope, string>;
type DraftCats = Record<PromptScope, PromptCategory | "">;

/**
 * Assemble prompts page model for PromptsPageWidget.
 */
export function usePromptsWidget() {
  const runCli = useSessionStore((s) => s.runCli);
  const workspace = useSessionStore((s) => s.session.workspace);

  const snapshot = useUserPromptsStore((s) => s.snapshot);
  const status = useUserPromptsStore((s) => s.status);
  const error = useUserPromptsStore((s) => s.error);
  const pending = useUserPromptsStore((s) => s.pending);
  const load = useUserPromptsStore((s) => s.load);
  const setScope = useUserPromptsStore((s) => s.setScope);
  const clearScope = useUserPromptsStore((s) => s.clearScope);
  const moveEntry = useUserPromptsStore((s) => s.moveEntry);
  const clearError = useUserPromptsStore((s) => s.clearError);

  const envSnapshot = useEnvironmentStore((s) => s.snapshot);
  const envStatus = useEnvironmentStore((s) => s.status);
  const envLoadedAt = useEnvironmentStore((s) => s.loadedAt);
  const envLoad = useEnvironmentStore((s) => s.load);

  const [drafts, setDrafts] = useState<Drafts>({
    global: "",
    project: "",
    projectLocal: "",
  });
  const [draftCats, setDraftCats] = useState<DraftCats>({
    global: "",
    project: "",
    projectLocal: "",
  });

  useEffect(() => {
    void load(runCli);
  }, [load, runCli, workspace]);

  const overridden = useMemo(() => {
    if (!snapshot) {
      return new Set<string>();
    }
    return overriddenEntryIds([
      snapshot.global.entries,
      snapshot.project.entries,
      snapshot.projectLocal.entries,
    ]);
  }, [snapshot]);

  const overridingIds = useMemo(() => {
    const set = new Set<string>();
    if (!snapshot) {
      return set;
    }
    const layers = [
      snapshot.global.entries,
      snapshot.project.entries,
      snapshot.projectLocal.entries,
    ];
    for (let li = 1; li < layers.length; li++) {
      const earlierCats = new Set<string>();
      for (let j = 0; j < li; j++) {
        for (const e of layers[j] ?? []) {
          if (e.category) {
            earlierCats.add(e.category);
          }
        }
      }
      for (const e of layers[li] ?? []) {
        if (e.category && earlierCats.has(e.category)) {
          set.add(e.id);
        }
      }
    }
    return set;
  }, [snapshot]);

  // projectRoot null → project scopes unavailable; empty string root is still a path.
  const projectUnavailable = snapshot != null && snapshot.projectRoot == null;
  const projectName = snapshot?.projectRoot
    ? snapshot.projectRoot.split(/[/\\]/).filter(Boolean).pop() ?? null
    : null;

  /**
   * Best-effort "open in editor": copy absolute path (web cannot reliably open
   * local files). Wails users can paste into their editor; path is the oracle.
   */
  const copyPath = useCallback(async (filePath: string) => {
    if (!filePath || typeof navigator === "undefined") {
      return;
    }
    try {
      await navigator.clipboard?.writeText(filePath);
    } catch {
      // ignore
    }
  }, []);

  const makeHandlers = useCallback(
    (scope: PromptScope) => {
      const state = snapshot?.[scope];
      const onToggleEnabled = (id: string, enabled: boolean) => {
        if (!state) {
          return;
        }
        const next = updateEntry(state.entries, id, { enabled });
        void setScope(runCli, scope, next);
      };
      const onCommitText = (id: string, text: string) => {
        if (!state) {
          return;
        }
        try {
          const next = updateEntry(state.entries, id, { text });
          void setScope(runCli, scope, next);
        } catch (err) {
          useUserPromptsStore.setState({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      const onCommitCategory = (
        id: string,
        category: PromptCategory | undefined,
      ) => {
        if (!state) {
          return;
        }
        // Pass category key even when undefined so updateEntry can clear it.
        const next = updateEntry(state.entries, id, { category });
        void setScope(runCli, scope, next);
      };
      const onDelete = (id: string) => {
        if (!state) {
          return;
        }
        const next = removeEntry(state.entries, id);
        if (next.length === 0) {
          void clearScope(runCli, scope);
        } else {
          void setScope(runCli, scope, next);
        }
      };
      const onMoveTo = (id: string, to: PromptScope) => {
        if (!state) {
          return;
        }
        const idx = state.entries.findIndex((e) => e.id === id);
        if (idx < 0) {
          return;
        }
        void moveEntry(runCli, scope, to, idx);
      };
      const onReorder = (fromIndex: number, toIndex: number) => {
        if (!state) {
          return;
        }
        const next = reorderEntries(state.entries, fromIndex, toIndex);
        void setScope(runCli, scope, next);
      };
      const onAdd = () => {
        if (!state) {
          return;
        }
        const text = drafts[scope];
        const cat = draftCats[scope];
        try {
          const next = addEntry(
            state.entries,
            text,
            cat ? cat : undefined,
          );
          setDrafts((d) => ({ ...d, [scope]: "" }));
          setDraftCats((d) => ({ ...d, [scope]: "" }));
          void setScope(runCli, scope, next);
        } catch (err) {
          useUserPromptsStore.setState({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      const onClear = () => {
        void clearScope(runCli, scope);
      };
      return {
        onToggleEnabled,
        onCommitText,
        onCommitCategory,
        onDelete,
        onMoveTo,
        onReorder,
        onAdd,
        onClear,
      };
    },
    [
      snapshot,
      setScope,
      clearScope,
      moveEntry,
      runCli,
      drafts,
      draftCats,
    ],
  );

  const sections: PromptScopeSectionViewProps[] = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return SCOPES.map((scope) => {
      const st = snapshot[scope];
      const handlers = makeHandlers(scope);
      return {
        scope,
        path: st.path,
        pathLabel: formatPromptPathLabel(
          st.path,
          snapshot.projectRoot,
          scope,
        ),
        tokenLabel: tokenLabelFromBytes(st.bytes),
        exists: st.exists,
        foreign: st.foreign,
        entries: st.entries,
        overriddenIds: overridden,
        overridingIds,
        projectUnavailable: scope !== "global" && projectUnavailable,
        showGitBadge: scope === "project" && snapshot.gitRepo,
        projectName: scope === "global" ? null : projectName,
        pending: Boolean(pending[scope]),
        draftText: drafts[scope],
        draftCategory: draftCats[scope],
        onDraftChange: (text: string) =>
          setDrafts((d) => ({ ...d, [scope]: text })),
        onDraftCategoryChange: (category: PromptCategory | "") =>
          setDraftCats((d) => ({ ...d, [scope]: category })),
        onOpenForeign: st.foreign
          ? () => {
              void copyPath(st.path);
            }
          : undefined,
        onCopyPath: () => {
          void copyPath(st.path);
        },
        ...handlers,
      };
    });
  }, [
    snapshot,
    makeHandlers,
    overridden,
    overridingIds,
    projectUnavailable,
    projectName,
    pending,
    drafts,
    draftCats,
    copyPath,
  ]);

  const instructionCount = envSnapshot?.instructions.length ?? 0;
  const approxTokens = useMemo(() => {
    const list = envSnapshot?.instructions ?? [];
    if (!list.length) {
      return null;
    }
    let sum = 0;
    let any = false;
    for (const row of list) {
      const t = (row as { approxTokens?: number }).approxTokens;
      if (typeof t === "number") {
        sum += t;
        any = true;
      }
    }
    return any ? sum : null;
  }, [envSnapshot]);

  const refreshEvidence = useCallback(() => {
    void envLoad(runCli, { force: true });
  }, [envLoad, runCli]);

  return {
    status,
    error,
    clearError,
    sections,
    loading: status === "loading" && !snapshot,
    evidence: {
      instructionCount,
      approxTokens,
      loading: envStatus === "loading",
      loadedLabel: formatLoadedAgo(envLoadedAt),
      onRefresh: refreshEvidence,
    },
  };
}
