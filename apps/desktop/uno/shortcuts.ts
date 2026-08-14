/**
 * Semantic UnoCSS shortcuts for grok-desktop shell / timeline / composer.
 * Colors always resolve through defineColor tokens via theme color names.
 * Domain slices live in `uno/shortcuts.*.ts` (file-size cap); keep the package
 * root free of CSS aggregation modules.
 */

import { sideNavShortcuts } from "./shortcuts.sidenav";
import { shellShortcuts } from "./shortcuts.shell";
import { timelineShortcuts } from "./shortcuts.timeline";
import { composerShortcuts } from "./shortcuts.composer";
import { chromeShortcuts } from "./shortcuts.chrome";
import { agentsShortcuts } from "./shortcuts.agents";
import { previewShortcuts } from "./shortcuts.preview";
import { codeShortcuts } from "./shortcuts.code";
import { docShortcuts } from "./shortcuts.doc";

export const appShortcuts: Record<string, string> = {
  ...sideNavShortcuts,
  ...shellShortcuts,
  ...timelineShortcuts,
  ...composerShortcuts,
  ...chromeShortcuts,
  ...agentsShortcuts,
  ...previewShortcuts,
  ...codeShortcuts,
  ...docShortcuts,
};
