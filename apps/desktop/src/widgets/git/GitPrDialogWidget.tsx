/**
 * Stateful PR dialog: loads the gh preflight on mount, owns the form fields
 * (title prefilled from the session title, base from the remote default
 * branch) and the created-PR result. Mounted only while open.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchGitPrPreflight } from "@/lib/gitBridge";
import { defaultPrTitle } from "@/lib/gitPanelModel";
import type { GitPrPreflight, GitPrResult } from "@/lib/gitTypes";
import { liveGitRunner } from "@/store/gitStore";
import { GitPrDialogView, type GitPrDraft } from "./GitPrDialogView";

export type GitPrDialogWidgetProps = {
  /** Workspace cwd for the preflight request. */
  cwd: string;
  /** Chat title used to prefill the PR title. */
  sessionTitle: string;
  /** Current branch (title fallback). */
  branch: string;
  /** Create request in flight. */
  busy: boolean;
  /**
   * Create the PR.
   * @param req Field values.
   * @returns Result, or `{ error }` to show inline.
   */
  onCreate: (req: GitPrDraft) => Promise<GitPrResult | { error: string }>;
  /** Open a URL externally. */
  onOpenUrl: (url: string) => void;
  /** Close the dialog. */
  onClose: () => void;
};

/**
 * PR dialog with preflight + local form state.
 * @param props Workspace, prefill sources and callbacks.
 * @returns GitPrDialogView.
 */
export function GitPrDialogWidget(props: GitPrDialogWidgetProps) {
  const { cwd, onCreate } = props;
  const [preflight, setPreflight] = useState<GitPrPreflight | null>(null);
  const [preflightError, setPreflightError] = useState("");
  const [values, setValues] = useState<GitPrDraft>(() => ({
    title: defaultPrTitle(props.sessionTitle, props.branch),
    body: "",
    base: "",
    draft: false,
  }));
  const [error, setError] = useState("");
  const [result, setResult] = useState<GitPrResult | null>(null);

  // One preflight per opening; prefill base only if the user has not typed one.
  useEffect(() => {
    let cancelled = false;
    fetchGitPrPreflight(liveGitRunner(), cwd).then(
      (p) => {
        if (cancelled) {
          return;
        }
        setPreflight(p);
        setValues((v) => (v.base ? v : { ...v, base: p.defaultBase }));
      },
      (e: unknown) => {
        if (!cancelled) {
          setPreflightError(e instanceof Error ? e.message : String(e));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const onChange = useCallback((patch: Partial<GitPrDraft>) => {
    setValues((v) => ({ ...v, ...patch }));
  }, []);

  const onSubmit = useCallback(() => {
    setError("");
    void onCreate(values).then((r) => {
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setResult(r);
    });
  }, [onCreate, values]);

  return (
    <GitPrDialogView
      preflight={preflight}
      preflightError={preflightError}
      values={values}
      busy={props.busy}
      error={error}
      result={result}
      onChange={onChange}
      onSubmit={onSubmit}
      onOpenUrl={props.onOpenUrl}
      onClose={props.onClose}
    />
  );
}
