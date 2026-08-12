/**
 * Stateless collapsible unmodified-lines band.
 * Icon shape is driven by gap position (leading / trailing / middle) so every
 * band always shows a clickable affordance — never plain static text.
 */

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import {
  REVEAL_DUAL_ABOVE,
  REVEAL_STEP,
  type GapBandPosition,
  type GapReveal,
} from "@/lib/diffGapExpand";
import type { DiffGap } from "@/lib/diffCore";

export type DiffGapBandViewProps = {
  /** Gap metadata (count + 1-based starts for title / aria). */
  gap: DiffGap;
  /**
   * Where this gap sits in the file block list.
   * leading → ⌃ only; trailing → ⌄ only; middle → ⇕ or dual edges when large.
   */
  position: GapBandPosition;
  /**
   * Current reveal for this gap (informational; band shows remaining count).
   * Parent already applied reveal before deciding to still show the band.
   */
  reveal?: GapReveal;
  /**
   * Edge/label expand handlers. Omitted when the band is non-interactive
   * (should not happen for structured diffs with expand support).
   */
  onRevealTop?: () => void;
  onRevealBottom?: () => void;
  onRevealAll?: () => void;
  /**
   * When true, remaining band is at a reconstructed fragment boundary — label
   * notes that expand cannot leave the fragment window.
   */
  fragmentBoundary?: boolean;
};

/**
 * Human label for a fold band.
 * @param count Remaining unmodified lines.
 * @param multiStep When true, band still supports edge steps (large residual).
 * @param fragmentBoundary When true, append fragment-boundary hint.
 */
function gapBandLabel(
  count: number,
  multiStep: boolean,
  fragmentBoundary: boolean,
): string {
  let base: string;
  if (multiStep) {
    base = count === 1 ? "1 unmodified line" : `${count} unmodified lines`;
  } else {
    base = count === 1 ? "Expand 1 line" : `Expand ${count} lines`;
  }
  if (fragmentBoundary) {
    return `${base} · 片段边界`;
  }
  return base;
}

/**
 * Interactive fold band for one unmodified gap.
 * Always paints at least one icon so small gaps (≤30) still look expandable.
 * @param props Gap + position + optional reveal handlers.
 */
export function DiffGapBandView(props: DiffGapBandViewProps) {
  const {
    gap,
    position,
    onRevealTop,
    onRevealBottom,
    onRevealAll,
    fragmentBoundary = false,
  } = props;
  /** Middle dual edges only above REVEAL_DUAL_ABOVE; independent of reveal-all. */
  const showDualMiddle = position === "middle" && gap.count > REVEAL_DUAL_ABOVE;
  const step = Math.min(REVEAL_STEP, gap.count);
  const title = `Unmodified lines starting at old ${gap.oldStart} / new ${gap.newStart}`;
  const label = gapBandLabel(gap.count, showDualMiddle, fragmentBoundary);

  return (
    <div
      className="preview-diff-gap"
      data-kind="diff-gap"
      data-gap-count={gap.count}
      data-gap-position={position}
      title={title}
    >
      {position === "leading" ? (
        <button
          type="button"
          className="preview-diff-gap-btn"
          aria-label={`Reveal ${step} lines from bottom of leading gap`}
          title={`Reveal ${step} lines above`}
          onClick={onRevealBottom}
        >
          <ChevronUp size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      {position === "trailing" ? (
        <button
          type="button"
          className="preview-diff-gap-btn"
          aria-label={`Reveal ${step} lines from top of trailing gap`}
          title={`Reveal ${step} lines below`}
          onClick={onRevealTop}
        >
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      {showDualMiddle ? (
        <button
          type="button"
          className="preview-diff-gap-btn"
          aria-label={`Reveal ${step} lines from top`}
          title={`Reveal ${step} lines below`}
          onClick={onRevealTop}
        >
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      {position === "middle" && !showDualMiddle ? (
        <button
          type="button"
          className="preview-diff-gap-btn"
          aria-label={`Expand all ${gap.count} unmodified lines`}
          title={label}
          onClick={onRevealAll}
        >
          <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="preview-diff-gap-label"
        aria-label={
          showDualMiddle
            ? `Expand all ${gap.count} unmodified lines`
            : label
        }
        onClick={onRevealAll}
      >
        {label}
      </button>
      {showDualMiddle ? (
        <button
          type="button"
          className="preview-diff-gap-btn"
          aria-label={`Reveal ${step} lines from bottom`}
          title={`Reveal ${step} lines above`}
          onClick={onRevealBottom}
        >
          <ChevronUp size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
