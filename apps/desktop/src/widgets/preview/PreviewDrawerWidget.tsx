/**
 * Stateful preview companion drawer (always mounted alongside plan rail chrome).
 * Owns width drag local state; commits to previewStore on pointer-up.
 * Body is driven by usePreviewSource from the active PreviewTarget.
 * File click-to-refresh keeps the last paint and frosts it (PreviewFileStackView).
 */

import cs from "classnames";
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { DrawerLayout } from "@/lib/contextDrawerPrefs";
import { toPathDisplay } from "@/lib/pathDisplay";
import {
  clampPreviewWidth,
  PREVIEW_WIDTH_MAX,
  PREVIEW_WIDTH_MIN,
  usePreviewStore,
  type PreviewTarget,
} from "@/store/previewStore";
import { useSessionStore } from "@/store/sessionStore";
import { useCopyFeedback } from "@/widgets/shared";
import type { CopyCursorPoint } from "./CopiedCursorFlashView";
import { DiffReviewWidget } from "./DiffReviewWidget";
import { PreviewChangeListView } from "./PreviewChangeListView";
import { PreviewFileStackView } from "./PreviewFileStackView";
import { PreviewFileWidget } from "./PreviewFileWidget";
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
  /**
   * File-body toolbar (mode toggle + copy) published by PreviewFileWidget.
   * Cleared when the body unmounts or leaves the file status.
   */
  const [fileToolbar, setFileToolbar] = useState<ReactNode | null>(null);
  /**
   * Pointer of the last path double-click. Held even after the flash expires
   * so a late clipboard resolve still has a place to park the chip.
   */
  const [pathCopyAt, setPathCopyAt] = useState<CopyCursorPoint | null>(null);

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

  const head = headFromSource(source, target);
  // Only file/diff heads carry a path; "Changes" and placeholders stay plain text.
  const headDisplay = head.path
    ? toPathDisplay(head.path, workspace)
    : undefined;
  const pathCopied = Boolean(headDisplay) && copiedKey === headDisplay?.full;

  /**
   * Record the double-click point then write the absolute path.
   * The chip only mounts after `copiedKey` matches (write succeeded).
   * @param point Viewport client coordinates from the heading double-click.
   */
  const handleCopyPath = useCallback(
    (point: CopyCursorPoint) => {
      if (!headDisplay) {
        return;
      }
      setPathCopyAt(point);
      copy(headDisplay.full, headDisplay.full);
    },
    [copy, headDisplay],
  );

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
        copied={pathCopied}
        copyAt={pathCopied ? pathCopyAt : null}
        onCopyPath={handleCopyPath}
        subtitle={head.subtitle}
        added={head.added}
        removed={head.removed}
        actions={source.status === "file" ? fileToolbar : null}
        onClose={handleClose}
      />
      <div className="context-drawer-body preview-body">
        <PreviewBody
          source={source}
          onOpenFile={(path) => openPreview({ kind: "file", path })}
          onFileToolbarChange={setFileToolbar}
        />
      </div>
    </aside>
  );
}

/**
 * Dispatch body content by load status.
 * @param props Source load state + file open fallback + toolbar publisher.
 */
function PreviewBody(props: {
  source: ReturnType<typeof usePreviewSource>;
  onOpenFile: (path: string) => void;
  /** Publish file head toolbar from PreviewFileWidget; null when not a file. */
  onFileToolbarChange: (node: ReactNode | null) => void;
}) {
  const { source, onOpenFile, onFileToolbarChange } = props;
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
    // Keep PreviewFileWidget mounted across click-to-refresh; the stack
    // frosts the last paint instead of swapping in the empty loading body.
    return (
      <PreviewFileStackView refreshing={Boolean(source.refreshing)}>
        <PreviewFileWidget
          path={source.path}
          content={source.content}
          truncated={source.truncated}
          focusLine={source.focusLine}
          onOpenFile={onOpenFile}
          onToolbarChange={onFileToolbarChange}
        />
      </PreviewFileStackView>
    );
  }
  if (source.status === "diff") {
    // Single paint: review shell owns decisions + Apply and the structured body.
    return (
      <DiffReviewWidget
        key={`${source.toolCallId}:${source.path}`}
        path={source.path}
        oldText={source.oldText}
        newText={source.newText}
      />
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
 * File targets use `target.path` even while the first read is still `loading`,
 * so the title does not flash the generic "File" placeholder.
 * @param source Load state.
 * @param target Active preview target; drives the file-path title during load.
 * @returns Title text plus, for file/diff targets, the absolute `path` the head
 *   should render as a shortened dir + file-name label. Callers that ignore
 *   `path` still get a usable title, so the head never renders empty.
 */
function headFromSource(
  source: ReturnType<typeof usePreviewSource>,
  target: PreviewTarget | null,
): {
  title: string;
  path?: string;
  subtitle?: string;
  added?: number;
  removed?: number;
} {
  if (target?.kind === "file") {
    return { title: target.path, path: target.path, subtitle: "File preview" };
  }
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
  if (target?.kind === "changeset") {
    return { title: "Changes" };
  }
  if (target?.kind === "diff") {
    return { title: "Diff" };
  }
  return { title: "Preview" };
}
