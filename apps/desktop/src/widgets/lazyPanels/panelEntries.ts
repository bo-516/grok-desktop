/**
 * Code-split panel entries (one async chunk each).
 *
 * Convention: each import targets the feature's public entry — the widget's
 * `index.ts` for feature folders (`@/widgets/preview`, `@/widgets/environment`)
 * or the single-file widget module for top-level widgets
 * (`@/widgets/SettingsPanelWidget`), i.e. the same specifier App used before.
 * Nothing in the startup graph may import those modules statically (types via
 * `import type` are fine), otherwise Rollup folds the chunk back into main.
 *
 * Exported so trigger surfaces can call `.preload()` on hover / intent.
 */

import { createLazyPanel } from "./createLazyPanel";

/** Preview / diff review drawer (+ diff engine, doc + code preview). */
export const previewDrawerPanel = createLazyPanel(() =>
  import("@/widgets/preview").then((m) => m.PreviewDrawerWidget),
);

/** Environment sheet (MCP / skills / inspect pages + Rules & prompts page). */
export const environmentSheetPanel = createLazyPanel(() =>
  import("@/widgets/environment").then((m) => m.EnvironmentSheetWidget),
);

/** Settings drawer (spawn flags, appearance, compat sources, account). */
export const settingsPanel = createLazyPanel(() =>
  import("@/widgets/SettingsPanelWidget").then((m) => m.SettingsPanelWidget),
);
