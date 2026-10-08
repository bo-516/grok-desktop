/**
 * Entry hook for the git action bar: status entry for the workspace, action
 * gates, the in-flight action, the last result notice, which dialog is open,
 * and the commit / push / PR calls. Every action refreshes the shared status
 * afterwards, which also makes the open change panel refetch its diff.
 */

import { useCallback, useMemo, useState } from "react";
import { runGitCommit, runGitPrCreate, runGitPush } from "@/lib/gitBridge";
import { gitActionGates } from "@/lib/gitPanelModel";
import type { GitPrResult } from "@/lib/gitTypes";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { EMPTY_GIT_ENTRY, liveGitRunner, useGitStore } from "@/store/gitStore";
import { useSessionStore } from "@/store/sessionStore";
import type { GitPrDraft } from "./GitPrDialogView";

/** Which action is running. */
export type GitBusyAction = "commit" | "push" | "pr" | null;

/** Result line under the buttons. */
export type GitActionNotice = { tone: "ok" | "error"; text: string };

/**
 * @param e Caught value.
 * @returns Its message.
 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Compose action-bar state for one workspace.
 * @param cwd Session workspace.
 * @returns Status, gates, busy / notice / dialog state and handlers.
 */
export function useGitActionBarWidget(cwd: string) {
  const entry = useGitStore((s) => s.byCwd[cwd] ?? EMPTY_GIT_ENTRY);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const connected = useSessionStore(
    (s) => s.connectionMode === "live-bridge" && Boolean(s.live),
  );
  const [busy, setBusy] = useState<GitBusyAction>(null);
  const [notice, setNotice] = useState<GitActionNotice | null>(null);
  const [dialog, setDialog] = useState<"commit" | "pr" | null>(null);
  const status = entry.status;
  const gates = useMemo(
    () => gitActionGates(status, { connected, busy: busy !== null }),
    [status, connected, busy],
  );

  const onPush = useCallback(async () => {
    setBusy("push");
    setNotice(null);
    try {
      const r = await runGitPush(liveGitRunner(), cwd);
      setNotice({
        tone: "ok",
        text: `${r.setUpstream ? "Published" : "Pushed"} ${r.branch} → ${r.upstream}`,
      });
    } catch (e) {
      setNotice({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
      void refreshStatus(cwd);
    }
  }, [cwd, refreshStatus]);

  const onCommit = useCallback(
    async (req: { message: string; paths: string[] }): Promise<string | null> => {
      setBusy("commit");
      try {
        const r = await runGitCommit(liveGitRunner(), cwd, req);
        setNotice({ tone: "ok", text: `Committed ${r.commit.slice(0, 7)} — ${r.summary}` });
        setDialog(null);
        return null;
      } catch (e) {
        return errorText(e);
      } finally {
        setBusy(null);
        void refreshStatus(cwd);
      }
    },
    [cwd, refreshStatus],
  );

  const onCreatePr = useCallback(
    async (req: GitPrDraft): Promise<GitPrResult | { error: string }> => {
      setBusy("pr");
      try {
        const r = await runGitPrCreate(liveGitRunner(), cwd, req);
        setNotice({ tone: "ok", text: `${r.existing ? "Existing" : "Opened"} pull request ${r.url}` });
        return r;
      } catch (e) {
        return { error: errorText(e) };
      } finally {
        setBusy(null);
      }
    },
    [cwd],
  );

  const onRefresh = useCallback(() => {
    void refreshStatus(cwd);
  }, [cwd, refreshStatus]);

  return {
    status,
    loading: entry.loading,
    error: entry.error,
    gates,
    busy,
    notice,
    dialog,
    openCommit: () => setDialog("commit"),
    openPr: () => setDialog("pr"),
    closeDialog: () => setDialog(null),
    dismissNotice: () => setNotice(null),
    onPush,
    onCommit,
    onCreatePr,
    onRefresh,
    onOpenUrl: (url: string) => {
      void openExternalUrl(url);
    },
  };
}
