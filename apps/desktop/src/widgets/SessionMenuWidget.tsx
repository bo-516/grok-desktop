/**
 * Stateful session ⋯ menu: session-only ops (+ narrow New chat / ⌘K fallbacks).
 * Fork uses the structured store RPC (restore empty ≥1s → switch to child);
 * drawer / theme / slash media live in sidebar footer and command palette.
 */

import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  SessionActionsMenuView,
  type SessionMenuActionId,
  type SessionMenuItem,
} from "./SessionActionsMenuView";

/** Session-only rows; New chat / ⌘K keep narrow viewport reachable when rail is off-canvas. */
const SESSION_MENU_ITEMS: SessionMenuItem[] = [
  { id: "fork", label: "Fork session", hint: "/fork" },
  { id: "rewind", label: "Rewind…", hint: "destructive", danger: true },
  { id: "sync", label: "Sync sessions", hint: "CLI list" },
  { id: "copy_id", label: "Copy session id" },
  { id: "delete", label: "Delete session…", danger: true },
  { id: "new_chat", label: "New chat", hint: "⌘N" },
  { id: "palette", label: "Command palette", hint: "⌘K" },
];

export type SessionMenuWidgetProps = {
  /** Open rewind confirm dialog. */
  onRequestRewind: () => void;
  /**
   * Request delete confirm for the active session.
   * @param id Session id.
   * @param title Display title.
   */
  onRequestDelete: (id: string, title: string) => void;
};

/**
 * Owns menu open state and dispatches session actions via store + shell events.
 * @param props Confirm hooks from the shell; missing onRequestDelete drops delete.
 * @returns SessionActionsMenuView bound to live session.
 */
export function SessionMenuWidget(props: SessionMenuWidgetProps) {
  const session = useSessionStore((s) => s.session);
  const catalog = useSessionStore((s) => s.catalog);
  const selectSession = useSessionStore((s) => s.selectSession);
  const newSession = useSessionStore((s) => s.newSession);
  const syncRemoteSessions = useSessionStore((s) => s.syncRemoteSessions);
  const forkSession = useSessionStore((s) => s.forkSession);
  const [open, setOpen] = useState(false);

  /**
   * Run a session ⋯ action then close the menu.
   * @param id Menu action id from SessionActionsMenuView.
   */
  const runSessionMenuAction = (id: SessionMenuActionId) => {
    setOpen(false);
    if (id === "fork") {
      // Centered restore empty, then canvas switches to the forked branch.
      void forkSession();
      return;
    }
    if (id === "rewind") {
      props.onRequestRewind();
      return;
    }
    if (id === "sync") {
      void syncRemoteSessions().then((r) => {
        if (!r.ok || r.count === 0) {
          return;
        }
        // First successful sync with an empty local catalog opens the newest row.
        if (catalog.length === 0) {
          const first = useSessionStore.getState().catalog[0];
          if (first) {
            selectSession(first.id);
          }
        }
      });
      return;
    }
    if (id === "copy_id") {
      const idText = session.id || "";
      if (idText && typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(idText).catch(() => undefined);
      }
      return;
    }
    if (id === "delete") {
      const title =
        catalog.find((c) => c.id === session.id)?.title ||
        session.title ||
        "this session";
      if (session.id) {
        props.onRequestDelete(session.id, title);
      }
      return;
    }
    if (id === "new_chat") {
      void newSession();
      return;
    }
    if (id === "palette") {
      window.dispatchEvent(new CustomEvent("grok-desktop:open-palette"));
    }
  };

  return (
    <SessionActionsMenuView
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClose={() => setOpen(false)}
      onSelect={runSessionMenuAction}
      items={SESSION_MENU_ITEMS}
    />
  );
}
