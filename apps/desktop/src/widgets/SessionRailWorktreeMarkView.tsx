/**
 * Small worktree / branch mark on a session rail row.
 * Stateless. Sits on the same line as the title so the 36px row does not grow.
 */

import { GitBranch } from "lucide-react";

/** Props for {@link SessionRailWorktreeMarkView}. */
export type SessionRailWorktreeMarkViewProps = {
  /**
   * Single-line label (`name · branch`, or just the branch).
   * Empty renders nothing.
   */
  label: string;
};

/**
 * Muted branch chip inside the title track.
 * The native tooltip repeats the label when the chip is truncated.
 * @param props Label from {@link formatWorktreeIndicator}. Empty hides the mark.
 * @returns The chip, or null when there is nothing to show.
 */
export function SessionRailWorktreeMarkView(
  props: SessionRailWorktreeMarkViewProps,
) {
  if (!props.label) {
    return null;
  }
  return (
    <span className="sess-wt" title={props.label}>
      <GitBranch
        className="sess-wt-icon"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="sess-wt-label">{props.label}</span>
    </span>
  );
}
