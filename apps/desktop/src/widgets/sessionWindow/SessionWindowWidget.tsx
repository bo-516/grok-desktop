/**
 * Stateful mount for session-window title sync and the open-in-window event.
 * Renders nothing: the effect must not sit on App, or a title change would
 * re-render the whole shell. Boot selection of `?session=` stays in the
 * shell lifecycle hook.
 */

import { useSessionWindowWidget } from "./useSessionWindowWidget";

/**
 * Mount {@link useSessionWindowWidget} once near the shell root.
 * @returns Null. There is no presentation.
 */
export function SessionWindowWidget() {
  useSessionWindowWidget();
  return null;
}
