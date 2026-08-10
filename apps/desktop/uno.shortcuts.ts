/**
 * Semantic UnoCSS shortcuts for grok-desktop shell / timeline / composer.
 * Colors always resolve through defineColor tokens via theme color names.
 * Domain slices live in uno.shortcuts.*.ts (file-size cap).
 */

import { sideNavShortcuts } from "./uno.shortcuts.sidenav";
import { shellShortcuts } from "./uno.shortcuts.shell";
import { timelineShortcuts } from "./uno.shortcuts.timeline";
import { composerShortcuts } from "./uno.shortcuts.composer";
import { chromeShortcuts } from "./uno.shortcuts.chrome";
import { previewShortcuts } from "./uno.shortcuts.preview";

export const appShortcuts: Record<string, string> = {
  ...sideNavShortcuts,
  ...shellShortcuts,
  ...timelineShortcuts,
  ...composerShortcuts,
  ...chromeShortcuts,
  ...previewShortcuts,
};
