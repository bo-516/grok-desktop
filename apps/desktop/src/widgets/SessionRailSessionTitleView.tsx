/**
 * Session rail title: display span or borderless inline input.
 * Switching span → input keeps the same 20px text-nav box so the 36px row
 * does not jump. The parent grid track is `1fr`, so width is also stable.
 */

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { SESSION_TITLE_MAX_LEN } from "@/lib/sessionTitleEdit";

/** Props for the rail title cell (display vs rename). */
export type SessionRailSessionTitleViewProps = {
  /** Visible label (displaySessionTitle or locked custom name). */
  label: string;
  /** Raw catalog title for the native tooltip when it differs from label. */
  rawTitle: string;
  /** True while this row is the one being renamed. */
  editing: boolean;
  /**
   * Optional handle so the trailing Save control can read the typed value
   * on mousedown (before blur would unmount the input).
   */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Enter edit (double-click). */
  onBeginRename: () => void;
  /**
   * Commit the typed value. Empty / unchanged is the action's job to ignore.
   * @param nextTitle Current input value (unsanitized).
   */
  onCommitRename: (nextTitle: string) => void;
  /** Leave edit without writing (Escape). */
  onCancelRename: () => void;
};

/**
 * True while an IME is composing so Enter confirms a candidate, not the rename.
 * @param event Key event from the title input.
 */
function isTitleImeKey(
  event: Pick<KeyboardEvent<HTMLInputElement>, "keyCode"> & {
    nativeEvent: Pick<
      KeyboardEvent<HTMLInputElement>["nativeEvent"],
      "isComposing"
    >;
  },
): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Title cell for one rail row.
 * Uncontrolled input: keystrokes stay local so the rail does not re-render.
 * @param props Label + edit handlers; missing commit leaves the catalog unchanged.
 * @returns Span (rest) or borderless text input (editing).
 */
export function SessionRailSessionTitleView(
  props: SessionRailSessionTitleViewProps,
) {
  const {
    label,
    rawTitle,
    editing,
    inputRef: inputRefProp,
    onBeginRename,
    onCommitRename,
    onCancelRename,
  } = props;
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = inputRefProp ?? localRef;
  /**
   * Escape unmounts the input, which fires blur. Skip that blur so cancel
   * does not immediately persist the draft.
   */
  const ignoreBlurRef = useRef(false);

  /**
   * Focus + select when this row enters edit so the user can type over the
   * current name. `editing` flipping on the same node is enough — no remount.
   */
  useEffect(() => {
    if (!editing) {
      return;
    }
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.focus();
    el.select();
    // select() can scroll a long title to the caret at the end; pin the
    // start so the row does not appear to jump when edit begins.
    el.scrollLeft = 0;
  }, [editing, inputRef]);

  /**
   * Read the live input and hand it to the store. Called from Enter and blur.
   * The trailing Save control reads the same ref on mousedown instead.
   */
  const commit = () => {
    if (ignoreBlurRef.current) {
      ignoreBlurRef.current = false;
      return;
    }
    onCommitRename(inputRef.current?.value ?? "");
  };

  /**
   * Start rename from a double-click without selecting the session again or
   * letting the browser highlight a word under the pointer.
   * @param e Title double-click.
   */
  const handleDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editing) {
      onBeginRename();
    }
  };

  /**
   * Enter commits, Escape cancels; IME Enter is left to the input method.
   * @param e Title input keydown.
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (isTitleImeKey(e)) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      ignoreBlurRef.current = true;
      onCancelRename();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="sess-title sess-title-input"
        type="text"
        defaultValue={label}
        maxLength={SESSION_TITLE_MAX_LEN}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        aria-label="Rename session"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    );
  }

  return (
    <span
      className="sess-title select-none"
      title={rawTitle || label}
      onDoubleClick={handleDoubleClick}
    >
      {label}
    </span>
  );
}
