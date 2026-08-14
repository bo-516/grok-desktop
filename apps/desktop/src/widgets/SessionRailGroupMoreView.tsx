/**
 * Preview toggle under a project / no-project session list.
 * "Show N more" expands past the preview cap; "Show less" restores it.
 * Both share the same chip so radius and hit target stay consistent.
 */

export type SessionRailGroupMoreViewProps = {
  /** Hidden row count while previewing. Ignored for "Show less". */
  remaining: number;
  /** Render the expand chip ("Show N more"). */
  showMore: boolean;
  /** Render the collapse chip ("Show less"). */
  showLess: boolean;
  /** Persist expand (full list past preview). Missing leaves the list clamped. */
  onShowMore: () => void;
  /** Persist collapse back to the preview cap. Missing leaves the list open. */
  onShowLess: () => void;
};

/**
 * One chip: either "Show N more" or "Show less", never both.
 * Renders nothing when the list is short enough that neither applies.
 * @param props Remaining count, which chip to show, and persist handlers.
 * @returns Preview toggle button, or null.
 */
export function SessionRailGroupMoreView(props: SessionRailGroupMoreViewProps) {
  if (props.showMore) {
    return (
      <button
        type="button"
        className="project-group-more"
        onClick={() => props.onShowMore()}
      >
        Show {props.remaining} more
      </button>
    );
  }
  if (props.showLess) {
    return (
      <button
        type="button"
        className="project-group-more"
        onClick={() => props.onShowLess()}
      >
        Show less
      </button>
    );
  }
  return null;
}
