/**
 * Stateful shell for one structured file diff: gap reveal state, layout prefs,
 * word-emph memo, optional keyboard jump between change runs. Hands a pure
 * props bag to PreviewDiffView. Reveal and focus stay local — not in the store.
 *
 * Display options (⋯) float over the scroll area instead of a full-width
 * toolbar band so the narrow drawer keeps vertical space for code.
 * When viewPrefs are controlled by a parent (Changes list chrome), local
 * storage is not used for those fields so all files share one setting.
 *
 * State and effects live in usePreviewDiffWidget; the menu renders through
 * PreviewDiffMenuView. This component only assembles the two.
 */

import type { HunkDecision } from "@/lib/diffHunkApply";
import { PreviewDiffMenuView } from "./PreviewDiffMenuView";
import { PreviewDiffView } from "./PreviewDiffView";
import {
  usePreviewDiffWidget,
  type PreviewDiffWidgetProps,
} from "./usePreviewDiffWidget";

/**
 * Highlight both sides, own expand/prefs state, render structured hunks.
 * @param props Diff, path, texts, optional review / controlled prefs.
 * @returns Focusable diff surface with the optional ⋯ menu above the body.
 */
export function PreviewDiffWidget(props: PreviewDiffWidgetProps) {
  const { onKeyDown, menuProps, diffViewProps } = usePreviewDiffWidget(props);

  return (
    <div
      className="flex flex-col min-h-0 flex-1 relative"
      data-kind="preview-diff-widget"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {menuProps ? <PreviewDiffMenuView {...menuProps} /> : null}
      <PreviewDiffView {...diffViewProps} />
    </div>
  );
}

export type { PreviewDiffWidgetProps };

/** Decision record helper for review shells. */
export type { HunkDecision };
