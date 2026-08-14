/**
 * Two-part path label: dimmed directory + file name. Default is a single
 * row that ellipsizes only the directory. `wrap` switches both halves to
 * break so a narrow title (preview head) can grow onto more lines instead
 * of clipping the file name. Callers own width, click and copy — this view
 * only picks which overflow strategy the two halves use.
 */

import cs from "classnames";
import type { PathDisplay } from "@/lib/pathDisplay";

export type PathLabelViewProps = {
  /** Split parts from `toPathDisplay`; `full` stays untouched for copy/tooltips. */
  display: PathDisplay;
  /** Layout-only extra classes for the wrapper. */
  className?: string;
  /**
   * When true, both halves wrap (`path-label-*-wrap`) instead of
   * ellipsizing the directory. False (default) keeps the one-line chip
   * used on tool rows and change-list heads.
   */
  wrap?: boolean;
};

/**
 * Renders `dir/` + `base` as two spans so CSS can shrink or wrap each half.
 * @param props Split path parts, optional wrap mode, and wrapper classes.
 * @returns Inline flex label; a bare file name renders without a dir span.
 */
export function PathLabelView(props: PathLabelViewProps) {
  const { display, className, wrap = false } = props;
  return (
    <span className={cs("path-label", { "path-label-wrap": wrap }, className)}>
      {display.dir ? (
        <span className={wrap ? "path-label-dir-wrap" : "path-label-dir"}>
          {display.dir}/
        </span>
      ) : null}
      <span className={wrap ? "path-label-base-wrap" : "path-label-base"}>
        {display.base}
      </span>
    </span>
  );
}
