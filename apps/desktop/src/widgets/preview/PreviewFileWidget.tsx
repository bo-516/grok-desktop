/**
 * Thin stateful file orchestrator for the preview drawer.
 * Classifies path kind (doc vs code), holds rendered|source mode from prefs,
 * applies focusLine / size degrade rules, publishes head toolbar, and dispatches
 * to PreviewDocWidget or PreviewCodeWidget.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadDocViewPrefs,
  saveDocViewPrefs,
  type DocViewMode,
} from "@/lib/docViewPrefs";
import {
  DOC_RENDER_MAX_CHARS,
  previewFileKind,
} from "@/lib/previewFileKind";
import { useCopyFeedback } from "@/widgets/shared";
import { PreviewCodeWidget } from "./PreviewCodeWidget";
import { PreviewDocWidget } from "./PreviewDocWidget";
import { PreviewFileToolbarView } from "./PreviewFileToolbarView";

export type PreviewFileWidgetProps = {
  /** Absolute workspace path of the open file. */
  path: string;
  /** File text as read by the bridge (may already be 1MB-truncated). */
  content: string;
  /** When true, the bridge truncated the payload. */
  truncated?: boolean;
  /**
   * Optional 1-based line from `@file:N` mentions.
   * When set, the **first paint** forces source mode without writing prefs so
   * the line can be highlighted; the user may still switch to rendered.
   */
  focusLine?: number;
  /** Open another workspace path in the same drawer (doc relative links). */
  onOpenFile: (path: string) => void;
  /**
   * Publish the head toolbar node (mode toggle + copy) so the drawer can place
   * it in PreviewHeadView.actions. Receives null on unmount.
   */
  onToolbarChange?: (node: ReactNode | null) => void;
};

/**
 * Compute the effective body mode from kind, prefs, size force, and first-paint focus.
 * @param kind Document vs code classification for the path.
 * @param prefsMode Last user-persisted mode (ignored for non-doc).
 * @param localMode Explicit user toggle this session (overrides focusLine force).
 * @param oversize When true, always source (Streamdown cost gate).
 * @param focusLine Mention line — forces source until the user toggles.
 */
function effectiveDocMode(args: {
  kind: "doc" | "code";
  prefsMode: DocViewMode;
  localMode: DocViewMode | null;
  oversize: boolean;
  focusLine?: number;
}): DocViewMode {
  if (args.kind !== "doc") {
    return "source";
  }
  if (args.oversize) {
    return "source";
  }
  if (args.localMode != null) {
    return args.localMode;
  }
  // First paint with a focus line: source so the gutter highlight is visible.
  // Does not write prefs — localMode stays null until the user clicks toggle.
  if (args.focusLine != null) {
    return "source";
  }
  return args.prefsMode;
}

/**
 * File preview orchestrator: kind + mode + degrade → doc or code body.
 * @param props Path, content, chrome flags, open-file + toolbar publishers.
 */
export function PreviewFileWidget(props: PreviewFileWidgetProps) {
  const { path, content, truncated, focusLine, onOpenFile, onToolbarChange } =
    props;

  const kind = useMemo(() => previewFileKind(path), [path]);
  const oversize = content.length > DOC_RENDER_MAX_CHARS;
  /** Last persisted mode; seed once from localStorage. */
  const [prefsMode, setPrefsMode] = useState<DocViewMode>(
    () => loadDocViewPrefs().mode,
  );
  /**
   * Session override after the user clicks the mode toggle.
   * null means "no explicit choice yet" so focusLine first-paint can force source.
   */
  const [localMode, setLocalMode] = useState<DocViewMode | null>(null);

  // Reset the session override when the open path changes so a new file
  // re-applies focusLine / prefs defaults rather than the previous file's toggle.
  useEffect(() => {
    setLocalMode(null);
  }, [path]);

  const mode = effectiveDocMode({
    kind,
    prefsMode,
    localMode,
    oversize,
    focusLine,
  });

  const { copiedKey, copy } = useCopyFeedback();

  const handleModeChange = useCallback(
    (next: DocViewMode) => {
      if (oversize) {
        // Hard force: size gate wins; still record the preference for later files.
        setLocalMode(null);
        setPrefsMode(next);
        saveDocViewPrefs({ mode: next });
        return;
      }
      setLocalMode(next);
      setPrefsMode(next);
      saveDocViewPrefs({ mode: next });
    },
    [oversize],
  );

  const handleCopy = useCallback(() => {
    copy("file-full-text", content);
  }, [content, copy]);

  // Publish toolbar into the drawer head; clear on unmount or path change.
  useEffect(() => {
    if (!onToolbarChange) {
      return;
    }
    onToolbarChange(
      <PreviewFileToolbarView
        showModeToggle={kind === "doc"}
        mode={mode}
        modeLocked={kind === "doc" && oversize}
        onModeChange={handleModeChange}
        onCopy={handleCopy}
        copied={copiedKey === "file-full-text"}
      />,
    );
    return () => {
      onToolbarChange(null);
    };
  }, [
    onToolbarChange,
    kind,
    mode,
    oversize,
    handleModeChange,
    handleCopy,
    copiedKey,
  ]);

  const showDoc = kind === "doc" && mode === "rendered" && !oversize;

  if (showDoc) {
    return (
      <PreviewDocWidget
        path={path}
        content={content}
        truncated={truncated}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {kind === "doc" && oversize ? (
        <div className="preview-banner preview-banner-warn" role="status">
          Document too large for rendered view; showing source.
        </div>
      ) : null}
      <PreviewCodeWidget
        path={path}
        content={content}
        truncated={truncated}
        focusLine={focusLine}
      />
    </div>
  );
}
