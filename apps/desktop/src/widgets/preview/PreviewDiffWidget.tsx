/**
 * Stateful shim for the structured diff body: tokenizes both sides of one file
 * edit and hands the result to the stateless PreviewDiffView.
 *
 * Both texts are highlighted whole rather than row-by-row so multi-line
 * constructs (block comments, template literals, heredocs) keep their context;
 * the view then indexes into each side by the row's own line number.
 */

import { useMemo } from "react";
import { languageForPath } from "@/lib/codeHighlightLanguages";
import type { FileDiff } from "@/lib/diffCore";
import { useCodeHighlight } from "@/widgets/shared";
import { PreviewDiffView } from "./PreviewDiffView";

export type PreviewDiffWidgetProps = {
  /** Structured diff already built from the two texts. */
  fileDiff: FileDiff;
  /** Absolute file path; its extension selects the grammar for both sides. */
  path: string;
  /** Pre-edit file text; empty for a newly created file. */
  oldText: string;
  /** Post-edit file text; empty for a deleted file. */
  newText: string;
  /**
   * Whether to print the path above the first hunk. False where the caller
   * already shows it (the change list's sticky per-file header); the grammar
   * still comes from `path` either way.
   */
  showPath?: boolean;
};

/**
 * Highlight both diff sides and render the structured hunks.
 * @param props Diff, path (grammar source), the two full texts, and whether the
 *   view should print the path label.
 */
export function PreviewDiffWidget(props: PreviewDiffWidgetProps) {
  const language = useMemo(() => languageForPath(props.path), [props.path]);
  const oldLines = useCodeHighlight(props.oldText, language);
  const newLines = useCodeHighlight(props.newText, language);
  return (
    <PreviewDiffView
      fileDiff={props.fileDiff}
      path={props.showPath === false ? undefined : props.path}
      oldLines={oldLines ?? undefined}
      newLines={newLines ?? undefined}
    />
  );
}
