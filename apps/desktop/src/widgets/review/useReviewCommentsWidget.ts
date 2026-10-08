/**
 * Entry hook for diff review comments in the git change panel. Owns the
 * session's comment list (persisted per session in localStorage), the one
 * active gutter selection, and "Send to agent" (composer send path, which
 * queues while a turn streams). Mounted by GitChangeListWidget; file bodies
 * read it through useDiffCommentFileModel and the tray through its fields.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiffRow } from "@/lib/diffCore";
import {
  buildReviewComment,
  selectionRows,
  type DiffLineSelection,
  type ReviewComment,
} from "@/lib/reviewComments";
import {
  loadReviewComments,
  reviewSessionKey,
  saveReviewComments,
} from "@/lib/reviewCommentsStorage";
import { formatReviewPrompt } from "@/lib/reviewPrompt";
import { useSessionStore } from "@/store/sessionStore";

/** Comment list bound to the storage key it was loaded from. */
type KeyedComments = {
  /** reviewSessionKey the list belongs to. */
  key: string;
  /** Comments in creation order. */
  comments: ReviewComment[];
};

/** Public model returned by {@link useReviewCommentsWidget}. */
export type ReviewCommentsModel = {
  /** Session comments in creation order. */
  comments: readonly ReviewComment[];
  /** Active gutter selection (any file), or null. */
  selection: DiffLineSelection | null;
  /** True while the prompt is being handed to the composer send path. */
  sending: boolean;
  /** True while a turn streams (Send queues behind it). */
  turnBusy: boolean;
  /** Last send outcome / hint ("" when none). */
  notice: string;
  /**
   * Gutter click: start a one-line selection, or extend the current one in
   * the same file when `extend` (Shift-click) is set.
   */
  onGutter: (path: string, rowKey: string, extend: boolean) => void;
  /** Drop the active selection without adding a comment. */
  onCancel: () => void;
  /**
   * Add a comment for the active selection of `path`.
   * @param path File the composer belongs to.
   * @param rows Full ordered rows of that file (fullDiffRows).
   * @param body Comment text (blank → ignored).
   */
  onSubmit: (path: string, rows: readonly DiffRow[], body: string) => void;
  /** Remove one comment by id. */
  onRemove: (id: string) => void;
  /** Remove every comment of the session. */
  onClear: () => void;
  /** Compose and send (or queue) the review prompt; clears on success. */
  onSend: () => void;
};

/** Sequence for comment ids (module scope: not render state). */
let commentSeq = 0;

/**
 * Next comment id, unique within the page lifetime and across reloads.
 * @returns Id string.
 */
function nextCommentId(): string {
  commentSeq += 1;
  return `rc-${Date.now().toString(36)}-${commentSeq}`;
}

/**
 * Review comments for the current session.
 * @returns Comments, selection, send state and handlers.
 */
export function useReviewCommentsWidget(): ReviewCommentsModel {
  const sessionId = useSessionStore((s) => s.session.id);
  const workspace = useSessionStore((s) => s.session.workspace) ?? "";
  const status = useSessionStore((s) => s.session.status);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const key = reviewSessionKey(sessionId, workspace);
  const [keyed, setKeyed] = useState<KeyedComments>(() => ({ key, comments: loadReviewComments(key) }));
  const [selection, setSelection] = useState<DiffLineSelection | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const turnBusy = status === "streaming" || status === "waiting_permission";

  // Session switch: reload that session's saved comments during render
  // (derived-state pattern) so the old list never paints under the new key.
  if (keyed.key !== key) {
    setKeyed({ key, comments: loadReviewComments(key) });
    setSelection(null);
    setNotice("");
  }

  useEffect(() => {
    saveReviewComments(keyed.key, keyed.comments);
  }, [keyed]);

  const onGutter = useCallback((path: string, rowKey: string, extend: boolean) => {
    setSelection((prev) =>
      extend && prev && prev.path === path
        ? { ...prev, focusKey: rowKey }
        : { path, anchorKey: rowKey, focusKey: rowKey },
    );
  }, []);

  const onCancel = useCallback(() => setSelection(null), []);

  const onSubmit = useCallback(
    (path: string, rows: readonly DiffRow[], body: string) => {
      if (!selection || selection.path !== path) {
        return;
      }
      const comment = buildReviewComment({
        id: nextCommentId(),
        path,
        rows: selectionRows(rows, selection.anchorKey, selection.focusKey),
        body,
        now: Date.now(),
      });
      if (!comment) {
        return;
      }
      setKeyed((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
      setSelection(null);
      setNotice("");
    },
    [selection],
  );

  const onRemove = useCallback((id: string) => {
    setKeyed((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== id) }));
  }, []);

  const onClear = useCallback(() => {
    setKeyed((prev) => ({ ...prev, comments: [] }));
    setNotice("");
  }, []);

  const onSend = useCallback(() => {
    const text = formatReviewPrompt(keyed.comments);
    const sentKey = keyed.key;
    const sentIds = new Set(keyed.comments.map((c) => c.id));
    if (!text || sending) {
      return;
    }
    setSending(true);
    void sendPrompt(text).then(
      (ok) => {
        setSending(false);
        if (!ok) {
          setNotice("Could not send — your comments are kept.");
          return;
        }
        // Drop only what was sent (comments added meanwhile stay).
        setKeyed((prev) =>
          prev.key === sentKey ? { ...prev, comments: prev.comments.filter((c) => !sentIds.has(c.id)) } : prev,
        );
        setNotice(turnBusy ? "Queued — sends after the current turn." : "Sent to the agent.");
      },
      () => {
        setSending(false);
        setNotice("Could not send — your comments are kept.");
      },
    );
  }, [keyed, sending, sendPrompt, turnBusy]);

  // Stable identity while nothing changed, so file bodies keep their memo.
  return useMemo(
    () => ({
      comments: keyed.comments,
      selection,
      sending,
      turnBusy,
      notice,
      onGutter,
      onCancel,
      onSubmit,
      onRemove,
      onClear,
      onSend,
    }),
    [keyed.comments, selection, sending, turnBusy, notice, onGutter, onCancel, onSubmit, onRemove, onClear, onSend],
  );
}
