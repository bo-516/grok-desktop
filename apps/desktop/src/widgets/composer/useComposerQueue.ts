/**
 * Composer follow-up queue: canvas-scoped rows + Send now / Edit / Cancel.
 * Lives beside useComposerWidget so that hook stays under the line cap.
 * Edit writes back through the caller's draft setter (high-frequency field
 * state stays in the completion hook, not the session store).
 */

import { useCallback, useMemo, type RefObject } from "react";
import { queueForSession, type PromptQueueItem } from "@/lib/promptQueue";
import { useSessionStore } from "../../store/sessionStore";

export type UseComposerQueueArgs = {
  /** Live composer draft; non-empty text is re-queued when Edit loads another row. */
  draft: string;
  /**
   * Replace the field and place the caret (Edit).
   * @param value Next draft.
   * @param caret Collapsed caret after paint.
   */
  setDraftWithCaret: (value: string, caret: number) => void;
  /** Field to refocus after Edit so the user can keep typing. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export type UseComposerQueueResult = {
  /** Follow-ups for the open canvas only. */
  items: PromptQueueItem[];
  /**
   * Interrupt the live turn so this row drains next (or send if idle).
   * @param id Queue row id.
   */
  sendNow: (id: string) => void;
  /**
   * Move the row back into the composer; parks any current draft at the tail.
   * @param id Queue row id.
   */
  edit: (id: string) => void;
  /**
   * Drop the row.
   * @param id Queue row id.
   */
  cancel: (id: string) => void;
};

/**
 * Subscribe to the canvas prompt queue and bind the three grok-build actions.
 * @param args Draft writers from the completion hook; missing textarea is a no-op on focus.
 * @returns Rows for {@link ComposerQueueView} plus click handlers.
 */
export function useComposerQueue(
  args: UseComposerQueueArgs,
): UseComposerQueueResult {
  const { draft, setDraftWithCaret, textareaRef } = args;
  const promptQueue = useSessionStore((state) => state.promptQueue);
  const sessionId = useSessionStore((state) => state.session.id);
  const viewingSessionId = useSessionStore((state) => state.viewingSessionId);
  const enqueuePrompt = useSessionStore((state) => state.enqueuePrompt);
  const sendQueuedPromptNow = useSessionStore(
    (state) => state.sendQueuedPromptNow,
  );
  const removeQueuedPrompt = useSessionStore(
    (state) => state.removeQueuedPrompt,
  );

  const canvasId = sessionId.trim() || viewingSessionId?.trim() || "";
  const items = useMemo(
    () => queueForSession(promptQueue, canvasId),
    [promptQueue, canvasId],
  );

  /**
   * Send now: cancel-and-send this follow-up (store decides interrupt vs idle).
   * @param id Queue row id.
   */
  const sendNow = useCallback(
    (id: string) => {
      sendQueuedPromptNow(id);
    },
    [sendQueuedPromptNow],
  );

  /**
   * Edit: dequeue this row into the field. A non-empty draft is enqueued so
   * the user does not lose text they had started typing.
   * @param id Queue row id.
   */
  const edit = useCallback(
    (id: string) => {
      const text = removeQueuedPrompt(id);
      if (text == null) {
        return;
      }
      const current = draft.trim();
      if (current) {
        enqueuePrompt(current);
      }
      setDraftWithCaret(text, text.length);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [draft, enqueuePrompt, removeQueuedPrompt, setDraftWithCaret, textareaRef],
  );

  /**
   * Cancel: drop the follow-up without sending.
   * @param id Queue row id.
   */
  const cancel = useCallback(
    (id: string) => {
      removeQueuedPrompt(id);
    },
    [removeQueuedPrompt],
  );

  return { items, sendNow, edit, cancel };
}
