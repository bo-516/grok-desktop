/**
 * Session-window side effects for one UI instance.
 *
 * Keeps the native title (and document.title) aligned with the session on
 * the canvas, and listens for {@link OPEN_SESSION_WINDOW_EVENT} from the
 * rail menu, ⌘⇧N, and the command palette. Does not own boot selection —
 * that stays in the shell lifecycle so a URL session is not raced by the
 * newest-chat open.
 */

import { useEffect } from "react";
import { railSessionTitle } from "@/lib/sessionTitleEdit";
import {
  DEFAULT_WINDOW_TITLE,
  OPEN_SESSION_WINDOW_EVENT,
  formatSessionWindowTitle,
  openSessionInNewWindow,
  pushNativeWindowTitle,
  resolveSessionWindowTarget,
  type OpenSessionWindowDetail,
} from "@/lib/sessionWindow";
import { useSessionStore } from "@/store/sessionStore";

/**
 * Title for the session currently on the canvas.
 * A draft with no id stays {@link DEFAULT_WINDOW_TITLE}. A catalog row uses
 * the rail label so a locked rename matches the sidebar.
 * @param sessionId Canvas session id. Empty on New chat.
 * @param sessionTitle Canvas title when the row is not in the catalog yet.
 * @param catalogTitle Rail label when the row exists.
 * @returns The string to put in the title bar.
 */
function canvasWindowTitle(
  sessionId: string,
  sessionTitle: string,
  catalogTitle: string | undefined,
): string {
  if (!sessionId.trim()) {
    return DEFAULT_WINDOW_TITLE;
  }
  if (catalogTitle) {
    return catalogTitle;
  }
  return formatSessionWindowTitle(sessionTitle, true);
}

/**
 * Sync the window title and open sessions in a new window on request.
 * Call once from {@link SessionWindowWidget}. Subscribes to the session
 * title only, so catalog churn that does not change this title does not
 * re-render the shell.
 */
export function useSessionWindowWidget(): void {
  const titleLabel = useSessionStore((state) => {
    const id = state.session.id;
    const row = id
      ? state.catalog.find((entry) => entry.id === id)
      : undefined;
    const catalogTitle = row ? railSessionTitle(row) : undefined;
    return canvasWindowTitle(id, state.session.title ?? "", catalogTitle);
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = titleLabel;
    }
    void pushNativeWindowTitle(titleLabel);
  }, [titleLabel]);

  useEffect(() => {
    /**
     * Open the session named on the event, or the one on the canvas.
     * @param event Custom event. Detail may be missing for the shortcut.
     */
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSessionWindowDetail>).detail;
      const state = useSessionStore.getState();
      const target = resolveSessionWindowTarget({
        requestedId: detail?.sessionId,
        requestedTitle: detail?.title,
        viewingSessionId: state.viewingSessionId,
        canvasSessionId: state.session.id,
        canvasTitle: state.session.title ?? "",
        titleForId: (id) => {
          const row = state.catalog.find((entry) => entry.id === id);
          return row ? railSessionTitle(row) : undefined;
        },
      });
      if (!target) {
        return;
      }
      void openSessionInNewWindow(target.sessionId, target.title);
    };
    window.addEventListener(OPEN_SESSION_WINDOW_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_SESSION_WINDOW_EVENT, onOpen);
    };
  }, []);
}
