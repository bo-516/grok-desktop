/**
 * Stateless pull-request dialog: gh availability notice, title / body / base
 * / draft fields, inline gh error, and the resulting PR link once created.
 * The parent widget owns every value.
 */

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { GitPrPreflight } from "@/lib/gitTypes";

/** Editable PR fields. */
export type GitPrDraft = { title: string; body: string; base: string; draft: boolean };

export type GitPrDialogViewProps = {
  /** Preflight snapshot; null while loading. */
  preflight: GitPrPreflight | null;
  /** Preflight load error ("" when none). */
  preflightError: string;
  /** Current field values. */
  values: GitPrDraft;
  /** Create request in flight. */
  busy: boolean;
  /** gh error verbatim ("" when none). */
  error: string;
  /** Created / existing PR (null before success). */
  result: { url: string; existing: boolean } | null;
  /** Patch one or more fields. */
  onChange: (patch: Partial<GitPrDraft>) => void;
  /** Create the PR. */
  onSubmit: () => void;
  /** Open a URL in the system browser. */
  onOpenUrl: (url: string) => void;
  /** Close request. */
  onClose: () => void;
};

/**
 * Explain why gh cannot be used, or "" when it can.
 * @param preflight Snapshot (null while loading).
 * @param loadError Preflight request error.
 * @returns User-facing blocker text.
 */
export function prBlocker(preflight: GitPrPreflight | null, loadError: string): string {
  if (loadError) {
    return loadError;
  }
  if (!preflight) {
    return "";
  }
  if (!preflight.ghAvailable || !preflight.ghAuthenticated) {
    return preflight.ghMessage || "GitHub CLI is not ready — run `gh auth login`.";
  }
  return "";
}

/**
 * PR form inside a shadcn Dialog.
 * @param props Values + handlers from GitPrDialogWidget.
 * @returns Open dialog.
 */
export function GitPrDialogView(props: GitPrDialogViewProps) {
  const { preflight, values, busy, error, result } = props;
  const blocker = prBlocker(preflight, props.preflightError);
  const ready = preflight !== null && blocker === "";
  const canSubmit = ready && !busy && !result && values.title.trim() !== "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      props.onSubmit();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent aria-describedby="git-pr-desc">
        <form className="flex flex-col gap-3.5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create pull request</DialogTitle>
            <DialogDescription id="git-pr-desc">
              {preflight?.branch
                ? `From ${preflight.upstream || preflight.branch} via the GitHub CLI (gh).`
                : "Checking the GitHub CLI…"}
            </DialogDescription>
          </DialogHeader>
          {blocker ? <pre className="git-dialog-error">{blocker}</pre> : null}
          <label className="flex flex-col gap-1.5">
            <span className="git-field-label">Title</span>
            <Input
              value={values.title}
              disabled={busy || Boolean(result)}
              autoFocus
              onChange={(e) => props.onChange({ title: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="git-field-label">Description</span>
            <Textarea
              value={values.body}
              className="max-h-[220px]"
              placeholder="What changed and why (optional)"
              disabled={busy || Boolean(result)}
              onChange={(e) => props.onChange({ body: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[160px] flex-1 flex-col gap-1.5">
              <span className="git-field-label">Base branch</span>
              <Input
                value={values.base}
                list="git-pr-bases"
                placeholder="repository default"
                disabled={busy || Boolean(result)}
                onChange={(e) => props.onChange({ base: e.target.value })}
              />
              <datalist id="git-pr-bases">
                {(preflight?.bases ?? []).map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <Checkbox
              label="Draft"
              checked={values.draft}
              disabled={busy || Boolean(result)}
              onChange={() => props.onChange({ draft: !values.draft })}
            />
          </div>
          {error ? <pre className="git-dialog-error">{error}</pre> : null}
          {result ? (
            <div className="git-pr-result">
              <span>{result.existing ? "A pull request already exists:" : "Pull request created:"}</span>
              <button type="button" className="git-pr-link" onClick={() => props.onOpenUrl(result.url)}>
                {result.url}
              </button>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {result ? "Close" : "Cancel"}
            </Button>
            {result ? (
              <Button type="button" onClick={() => props.onOpenUrl(result.url)}>
                Open on GitHub
              </Button>
            ) : (
              <Button type="submit" disabled={!canSubmit}>
                {busy ? "Creating…" : "Create pull request"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
