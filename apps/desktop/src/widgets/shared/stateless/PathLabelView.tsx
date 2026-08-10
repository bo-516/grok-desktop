/**
 * Two-part path label: dimmed directory that truncates first, then the file
 * name at full length. Callers own width, click and copy behaviour — this view
 * only decides which half is allowed to disappear when space runs out.
 */

import cs from "classnames";
import type { PathDisplay } from "@/lib/pathDisplay";

export type PathLabelViewProps = {
  /** Split parts from `toPathDisplay`; `full` stays untouched for copy/tooltips. */
  display: PathDisplay;
  /** Layout-only extra classes for the wrapper. */
  className?: string;
};

/**
 * Renders `dir/` + `base` as two spans so CSS can shrink the directory alone.
 * @param props Split path parts plus optional wrapper classes.
 * @returns Inline flex label; a bare file name renders without a dir span.
 */
export function PathLabelView(props: PathLabelViewProps) {
  const { display, className } = props;
  return (
    <span className={cs("path-label", className)}>
      {display.dir ? (
        <span className="path-label-dir">{display.dir}/</span>
      ) : null}
      <span className="path-label-base">{display.base}</span>
    </span>
  );
}
