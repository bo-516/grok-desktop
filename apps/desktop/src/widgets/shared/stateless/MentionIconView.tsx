/**
 * Single icon funnel for mention chips.
 *
 * All mention/command glyphs come from lucide-react through this component so
 * business code never inlines SVG and every surface (composer mirror, timeline
 * bubble, completion menu) stays on the same icon set and stroke weight.
 */

import { Blocks, FileText, Folder, SquareSlash } from "lucide-react";
import type { MentionKind } from "@/lib/mentionTokens";

/** Kinds this funnel can draw; `skill` only exists in the completion menu. */
export type MentionIconKind = MentionKind | "skill";

type MentionIconViewProps = {
  /** What the token refers to; unknown-ish values fall back to the command glyph. */
  kind: MentionIconKind;
  /** Extra classes (sizing/color); colors must come from token-backed classes. */
  className?: string;
};

/**
 * Renders the glyph matching a mention kind.
 * @param props Token kind and optional sizing/color classes.
 * @returns A decorative icon (aria-hidden) — the adjacent label carries the meaning,
 *   so a missing/unknown kind degrades to the command glyph rather than empty space.
 */
export function MentionIconView(props: MentionIconViewProps) {
  const { kind, className } = props;
  const shared = {
    className,
    "aria-hidden": true,
    focusable: false,
    strokeWidth: 1.75,
  } as const;

  if (kind === "file") {
    return <FileText {...shared} />;
  }
  if (kind === "directory") {
    return <Folder {...shared} />;
  }
  // Skills are agent-registered blocks, not built-in slash verbs — worth a
  // distinct glyph in the menu so users can tell where a command came from.
  if (kind === "skill") {
    return <Blocks {...shared} />;
  }
  return <SquareSlash {...shared} />;
}
