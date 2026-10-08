/**
 * Stateful top-nav git chip. Owns the workspace status refresh triggers
 * (useGitStatusRefresh) because the top nav is always mounted, and opens the
 * git change panel (the session-scope changeset target) on click.
 */

import { useCallback, useMemo } from "react";
import { gitChipModel } from "@/lib/gitPanelModel";
import { useGitStore } from "@/store/gitStore";
import { usePreviewStore } from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import { GitBranchChipView } from "./GitBranchChipView";
import { useGitStatusRefresh } from "./useGitStatusRefresh";

/**
 * Entry hook: workspace → refreshed status → chip model + open action.
 * @returns Chip model and click handler.
 */
export function useGitBranchChipWidget() {
  /** Session workspace on screen; git status is keyed by it. */
  const cwd = useSessionStore((s) => s.session.workspace) ?? "";
  const status = useGitStore((s) => s.byCwd[cwd]?.status ?? null);
  const openPreview = usePreviewStore((s) => s.openPreview);
  useGitStatusRefresh(cwd);
  const chip = useMemo(() => gitChipModel(status), [status]);
  const onOpen = useCallback(() => {
    openPreview({ kind: "changeset", scope: "session" });
  }, [openPreview]);
  return { chip, onOpen };
}

/**
 * Branch + dirty-count chip for the top nav.
 * @returns Chip, or nothing outside a repository.
 */
export function GitBranchChipWidget() {
  const { chip, onOpen } = useGitBranchChipWidget();
  return <GitBranchChipView chip={chip} onOpen={onOpen} />;
}
