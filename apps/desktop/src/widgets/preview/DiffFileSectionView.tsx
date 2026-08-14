/**
 * Stateless collapsible file section header for multi-file change lists.
 * Sticky head stays visible while the body scrolls; collapsed shows head only.
 * Path uses PathLabelView so the file name is never the truncated half.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { PathDisplay } from "@/lib/pathDisplay";
import { PathLabelView } from "@/widgets/shared";

export type DiffFileSectionViewProps = {
  /**
   * Path display parts from toPathDisplay; when omitted, falls back to raw
   * `path` string (tests / callers without workspace).
   */
  pathDisplay?: PathDisplay;
  /** Absolute or workspace-relative file path (title + tooltip / fallback). */
  path: string;
  /** Right-side meta (+N −M, status tags). */
  meta?: ReactNode;
  /** Whether the file body is expanded. */
  expanded: boolean;
  /** Toggle expand/collapse. */
  onToggle: () => void;
  /** Diff body (or fallback actions) rendered only when expanded. */
  children?: ReactNode;
};

/**
 * One collapsible file block: sticky header + optional body.
 * @param props Path, meta, expand state, body.
 */
export function DiffFileSectionView(props: DiffFileSectionViewProps) {
  const { path, pathDisplay, meta, expanded, onToggle, children } = props;
  return (
    <section
      className="preview-change-file"
      data-kind="diff-file-section"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="preview-change-file-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="shrink-0 text-fg-muted" aria-hidden="true">
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.75} />
          )}
        </span>
        {pathDisplay ? (
          <PathLabelView
            display={pathDisplay}
            className="preview-change-file-path"
          />
        ) : (
          <span className="preview-change-file-path" title={path}>
            {path}
          </span>
        )}
        {meta ? (
          <span className="preview-change-file-meta">{meta}</span>
        ) : null}
      </button>
      {expanded ? children : null}
    </section>
  );
}
