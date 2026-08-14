/**
 * Composer context-usage ring state: Settings pref + session.tokenUsage.
 * Keeps useComposerWidget under the file-size budget; pure presentation stays
 * in contextUsageDisplay / ComposerContextUsageView.
 */

import { useEffect, useMemo, useState } from "react";
import type { AvailableModel, SessionTokenUsage } from "@grok-desktop/acp-core";
import {
  buildContextUsageDisplay,
  isContextUsageReady,
  resolveContextLimit,
  type ContextUsageDisplay,
} from "@/lib/contextUsageDisplay";
import {
  loadContextUsagePrefs,
  type ContextUsagePrefs,
} from "@/lib/contextUsagePrefs";

/**
 * Subscribe to the Appearance "Show context usage" pref and build the ring
 * view-model from live occupancy (`contextTokensUsed`) + model context limit.
 * Last-turn billed counters ride along for the hover tip, not the ring fill.
 * Occupancy that is still unknown (restore before `session/token_usage`)
 * returns null so the composer does not flash "0 of 500k".
 * @param model Current session.model id (for catalog lookup).
 * @param availableModels Agent model catalog (may carry totalContextTokens).
 * @param tokenUsage Live occupancy + last-turn billed rollup, or undefined before first stamp.
 * @returns Display model when the pref is on and occupancy is known; null hides the ring.
 */
export function useContextUsageDisplay(
  model: string,
  availableModels: AvailableModel[],
  tokenUsage: SessionTokenUsage | undefined,
): ContextUsageDisplay | null {
  const [showContextUsage, setShowContextUsage] = useState(
    () => loadContextUsagePrefs().showContextUsage,
  );

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent<ContextUsagePrefs>).detail;
      if (detail && typeof detail.showContextUsage === "boolean") {
        setShowContextUsage(detail.showContextUsage);
        return;
      }
      setShowContextUsage(loadContextUsagePrefs().showContextUsage);
    };
    window.addEventListener(
      "grok-desktop:context-usage-prefs-changed",
      onPrefs,
    );
    return () =>
      window.removeEventListener(
        "grok-desktop:context-usage-prefs-changed",
        onPrefs,
      );
  }, []);

  return useMemo((): ContextUsageDisplay | null => {
    if (!showContextUsage || !isContextUsageReady(tokenUsage)) {
      return null;
    }
    return buildContextUsageDisplay(
      tokenUsage,
      resolveContextLimit(model, availableModels),
    );
  }, [showContextUsage, tokenUsage, model, availableModels]);
}
