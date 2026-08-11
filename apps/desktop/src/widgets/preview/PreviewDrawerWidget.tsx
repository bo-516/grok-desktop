/**
 * Stateful preview companion drawer (always mounted alongside plan rail chrome).
 * Owns width drag local state; commits to previewStore on pointer-up.
 * Body is driven by usePreviewSource from the active PreviewTarget.
 */

import cs from "classnames";
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DrawerLayout } from "@/lib/contextDrawerPrefs";
import { toPathDisplay } from "@/lib/pathDisplay";
import {
  clampPreviewWidth,
  PREVIEW_WIDTH_MAX,
  PREVIEW_WIDTH_MIN,
  usePreviewStore,
} from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import { useCopyFeedback } from "@/widgets/shared";
import { DiffReviewView } from "./DiffReviewView";
import { PreviewChangeListView } from "./PreviewChangeListView";
import { PreviewCodeWidget } from "./PreviewCodeWidget";
import { PreviewDiffWidget } from "./PreviewDiffWidget";
import { PreviewHeadView } from "./PreviewHeadView";
import { usePreviewSource } from "./usePreviewSource";

export type PreviewDrawerWidgetProps = {
  /** Whether the preview rail is the active context rail. */
  open: boolean;
  /** Effective layout after narrow-window clamp. */
  effectiveLayout: DrawerLayout;
  /** Close the rail (shell marks user-dismissed). */
  onClose: () => void;
};

/**
 * Always-mounted right preview drawer with resize handle and target body.
 * Closed state uses inert + off-screen translate (same chrome language as plan).
 * @param props Open flag, layout, close handler.
 */
export function PreviewDrawerWidget(props: PreviewDrawerWidgetProps) {
  const target = usePreviewStore((s) => s.target);
  const storedWidth = usePreviewStore((s) => s.width);
  const setWidth = usePreviewStore((s) => s.setWidth);
  const closePreview = usePreviewStore((s) => s.closePreview);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const source = usePreviewSource(target);
  /** Workspace root shortens the head path only; empty keeps it absolute. */
  const workspace = useSessionStore((s) => s.session.workspace);
  const { copiedKey, copy } = useCopyFeedback();

  /** Live drag width; null when not dragging. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(storedWidth);

  const width = dragWidth ?? storedWidth;
  const isOverlay = props.effectiveLayout === "overlay";

  const handleClose = useCallback(() => {
    closePreview();
    props.onClose();
  }, [closePreview, props]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") {
      return;
    }
    if (!props.open) {
      return;
    }
    e.stopPropagation();
    handleClose();
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = width;
    setDragWidth(width);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth == null) {
      return;
    }
    // Dragging the left edge: moving left increases width.
    const delta = dragStartX.current - e.clientX;
    setDragWidth(clampPreviewWidth(dragStartW.current + delta));
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragWidth == null) {
      return;
    }
    setWidth(dragWidth);
    setDragWidth(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // Push padding / top-nav rail width are driven by App via --rail-right-width
  // on main-column (shell.railWidthPx). This drawer only owns its own width style.

  const head = headFromSource(source, target?.kind);
  // Only file/diff heads carry a path; "Changes" and placeholders stay plain text.
  const headDisplay = head.path
    ? toPathDisplay(head.path, workspace)
    : undefined;

  return (
    <aside
      id="preview-rail"
      className={cs("context-drawer", {
        "context-drawer-open": props.open,
        "context-drawer-closed": !props.open,
        "context-drawer-overlay": isOverlay,
      })}
      style={{ width: `${width}px`, maxWidth: "100%" }}
      aria-label="Preview"
      inert={!props.open ? true : undefined}
      onKeyDown={onKeyDown}
      data-preview-width={width}
      data-preview-min={PREVIEW_WIDTH_MIN}
      data-preview-max={PREVIEW_WIDTH_MAX}
    >
      <div
        className="preview-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
      <PreviewHeadView
        title={head.title}
        display={headDisplay}
        copied={Boolean(headDisplay) && copiedKey === headDisplay?.full}
        onCopyPath={() => {
          if (headDisplay) {
            copy(headDisplay.full, headDisplay.full);
          }
        }}
        subtitle={head.subtitle}
        added={head.added}
        removed={head.removed}
        onClose={handleClose}
      />
      <div className="context-drawer-body preview-body">
        <PreviewBody
          source={source}
          onOpenFile={(path) => openPreview({ kind: "file", path })}
        />
      </div>
    </aside>
  );
}

/**
 * Dispatch body content by load status.
 * @param props Source load state + file open fallback.
 */
function PreviewBody(props: {
  source: ReturnType<typeof usePreviewSource>;
  onOpenFile: (path: string) => void;
}) {
  const { source, onOpenFile } = props;
  if (source.status === "idle") {
    return (
      <div className="preview-empty">
        Open a file mention or edit summary to preview.
      </div>
    );
  }
  if (source.status === "loading") {
    return <div className="preview-empty">Loading…</div>;
  }
  if (source.status === "error") {
    return <div className="preview-error">{source.message}</div>;
  }
  if (source.status === "file") {
    return (
      <PreviewCodeWidget
        path={source.path}
        content={source.content}
        truncated={source.truncated}
        focusLine={source.focusLine}
      />
    );
  }
  if (source.status === "diff") {
    return (
      <div className="preview-diff-stack">
        <PreviewDiffWidget
          fileDiff={source.fileDiff}
          path={source.path}
          oldText={source.oldText}
          newText={source.newText}
        />
        <DiffReviewView
          key={`${source.toolCallId}:${source.path}`}
          path={source.path}
          oldText={source.oldText}
          newText={source.newText}
        />
      </div>
    );
  }
  if (source.status === "changeset") {
    return (
      <PreviewChangeListView
        changeSet={source.changeSet}
        onOpenFile={onOpenFile}
      />
    );
  }
  return null;
}

/**
 * Derive head chrome labels from the current source.
 * @param source Load state.
 * @param kind Target kind for fallback title.
 * @returns Title text plus, for file/diff targets, the absolute `path` the head
 *   should render as a shortened dir + file-name label. Callers that ignore
 *   `path` still get a usable title, so the head never renders empty.
 */
function headFromSource(
  source: ReturnType<typeof usePreviewSource>,
  kind: string | undefined,
): {
  title: string;
  path?: string;
  subtitle?: string;
  added?: number;
  removed?: number;
} {
  if (source.status === "file") {
    return { title: source.path, path: source.path, subtitle: "File preview" };
  }
  if (source.status === "diff") {
    return {
      title: source.path,
      path: source.path,
      subtitle: "Diff preview",
      added: source.fileDiff.added,
      removed: source.fileDiff.removed,
    };
  }
  if (source.status === "changeset") {
    return {
      title: "Changes",
      subtitle: `${source.changeSet.fileCount} file(s)`,
      added: source.changeSet.added,
      removed: source.changeSet.removed,
    };
  }
  if (kind === "changeset") {
    return { title: "Changes" };
  }
  if (kind === "file") {
    return { title: "File" };
  }
  if (kind === "diff") {
    return { title: "Diff" };
  }
  return { title: "Preview" };
}
