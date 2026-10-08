/**
 * Stateless one-letter git status badge (A / M / D / R / C / T / U / ?),
 * colored by kind through `git-status-*` shortcuts (diff add / del tokens).
 */

import cs from "classnames";
import type { GitFileKind } from "@/lib/gitTypes";

/** Letter + accessible label per kind. */
const BADGES: Record<GitFileKind, { letter: string; label: string }> = {
  added: { letter: "A", label: "Added" },
  untracked: { letter: "U", label: "Untracked" },
  modified: { letter: "M", label: "Modified" },
  deleted: { letter: "D", label: "Deleted" },
  renamed: { letter: "R", label: "Renamed" },
  copied: { letter: "C", label: "Copied" },
  typechange: { letter: "T", label: "Type changed" },
  conflicted: { letter: "!", label: "Conflicted" },
  unmerged: { letter: "!", label: "Unmerged" },
  unknown: { letter: "?", label: "Changed" },
};

export type GitStatusBadgeViewProps = {
  /** File kind from git status / diff. */
  kind: GitFileKind;
};

/**
 * Status letter with a tooltip.
 * @param props Kind.
 * @returns Badge span.
 */
export function GitStatusBadgeView(props: GitStatusBadgeViewProps) {
  const badge = BADGES[props.kind];
  return (
    <span
      className={cs("git-status-badge", {
        "git-status-add": props.kind === "added" || props.kind === "untracked",
        "git-status-del": props.kind === "deleted",
        "git-status-mod": props.kind === "modified" || props.kind === "typechange",
        "git-status-move": props.kind === "renamed" || props.kind === "copied",
        "git-status-conflict": props.kind === "conflicted" || props.kind === "unmerged",
      })}
      title={badge.label}
      aria-label={badge.label}
    >
      {badge.letter}
    </span>
  );
}
