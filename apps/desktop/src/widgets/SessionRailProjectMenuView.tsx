/**
 * Right-click menu for one rail project folder header: "Remove project".
 *
 * Removing only takes the folder off the rail — grok-build's chat files are
 * untouched. Starting a chat in that folder again (project switcher, or
 * Create project with the same path) brings it back with every old chat,
 * which the row tooltip spells out. The row is disabled while a chat in the
 * folder is running, so a live stream or a pending approval never vanishes.
 *
 * Stateless: the shadcn ContextMenu (Radix) keeps its own open state; the
 * parent owns the action and the busy flag.
 */

import { FolderMinus } from "lucide-react";
import type { ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/** Props for {@link SessionRailProjectMenuView}. */
export type SessionRailProjectMenuViewProps = {
  /** Folder display name; names the menu for screen readers. */
  projectName: string;
  /**
   * Hide this folder from the rail. Missing disables the menu entirely
   * (right-click then does nothing; the browser menu stays suppressed).
   */
  onRemove?: () => void;
  /** A chat in this folder is running — the row is shown but disabled. */
  removeDisabled?: boolean;
  /**
   * The folder header element. It becomes the trigger via `asChild`, so it
   * must be one element that accepts a ref and spreads props (a `div`).
   */
  children: ReactElement;
};

/**
 * Wraps a folder header so a right-click opens the project menu at the
 * pointer. While open, Radix marks the header `data-state="open"`; the
 * `project-group-header` shortcut keeps it highlighted.
 * @param props Folder name, remove action, busy flag, and the header.
 * @returns The header plus its (portaled) context menu.
 */
export function SessionRailProjectMenuView(
  props: SessionRailProjectMenuViewProps,
) {
  const { projectName, onRemove, removeDisabled, children } = props;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!onRemove}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${projectName} actions`}>
        <ContextMenuItem
          variant="destructive"
          disabled={removeDisabled}
          title="Hide from the sidebar. Chats stay on disk — start a chat in this folder again to bring it back."
          onSelect={() => onRemove?.()}
        >
          <FolderMinus aria-hidden="true" />
          Remove project
          {removeDisabled ? (
            <ContextMenuShortcut className="font-sans">Running</ContextMenuShortcut>
          ) : null}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
