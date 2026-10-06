/**
 * Window catalog store. Hydrates from localStorage so the first paint of a
 * New chat can label the model chip before initialize returns.
 * remember() ignores empty fields and is not cleared by new chat or a
 * workspace switch.
 */

import { create } from "zustand";
import {
  loadModelCatalog,
  mergeModelCatalog,
  modelCatalogEqual,
  saveModelCatalog,
  type ModelCatalogSnapshot,
} from "@/lib/modelCatalog";

type ModelCatalogStore = ModelCatalogSnapshot & {
  /**
   * Fold a live session or initialize probe into the window cache.
   * Empty model / models / config are ignored so a draft hydrate cannot wipe
   * a catalog the window already learned.
   * @param incoming Partial snapshot. Missing or empty fields keep the previous value.
   * @returns True when the stored snapshot changed.
   */
  remember: (incoming: Partial<ModelCatalogSnapshot>) => boolean;
};

export const useModelCatalogStore = create<ModelCatalogStore>((set, get) => ({
  ...loadModelCatalog(),
  remember: (incoming) => {
    const prev = get();
    const next = mergeModelCatalog(prev, incoming);
    if (modelCatalogEqual(prev, next)) {
      return false;
    }
    saveModelCatalog(next);
    set(next);
    return true;
  },
}));

/**
 * Remember from a non-React caller (live session inbound).
 * Runs even when the canvas is a draft and refuses to paint that session,
 * so the next New chat still has the catalog.
 * @param incoming Partial catalog; empty fields are ignored.
 * @returns True when the stored snapshot changed.
 */
export function rememberModelCatalog(
  incoming: Partial<ModelCatalogSnapshot>,
): boolean {
  return useModelCatalogStore.getState().remember(incoming);
}
