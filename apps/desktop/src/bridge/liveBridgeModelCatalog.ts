/**
 * Initialize-only model catalog request for the live bridge client.
 * Correlates `read_model_catalog` with `model_catalog` on its own pending map
 * so a slow probe cannot be confused with cli_result. Does not start a session.
 */

import type { AvailableModel } from "@grok-desktop/acp-core";
import type { ModelCatalogReply } from "./liveBridgeTypes";

/** Desktop bound. Covers the bridge pool wait (8s) plus initialize (25s). */
const CATALOG_TIMEOUT_MS = 40_000;

type Pending = {
  resolve: (value: ModelCatalogReply) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type LiveBridgeModelCatalogApi = {
  /**
   * Ask the bridge for the grok-build catalog.
   * @param cwd Optional workspace. Omitted lets the bridge use its default cwd.
   *            A bad cwd fails the promise or resolves ok false; it does not
   *            fall back to a hardcoded list.
   */
  readModelCatalog: (cwd?: string) => Promise<ModelCatalogReply>;
  /** Reject in-flight catalog reads (socket close / error). */
  rejectAll: (error: Error) => void;
  /**
   * Dispatch a server message when it is `model_catalog`.
   * @param msg Loose bag so the full BridgeServerMsg union can be passed.
   * @returns True when the message was a catalog reply (handled or orphaned).
   */
  handleServerMsg: (msg: { type: string; [key: string]: unknown }) => boolean;
};

/**
 * Build the pending-map catalog client bound to a WebSocket send.
 * @param send Serialize and send a client message; return false when not connected.
 */
export function createLiveBridgeModelCatalog(
  send: (message: unknown) => boolean,
): LiveBridgeModelCatalogApi {
  const pending = new Map<string, Pending>();
  const sequence = { n: 0 };

  function rejectAll(error: Error): void {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(error);
    }
    pending.clear();
  }

  function handleServerMsg(msg: {
    type: string;
    [key: string]: unknown;
  }): boolean {
    if (msg.type !== "model_catalog") {
      return false;
    }
    const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
    const item = pending.get(requestId);
    if (!item) {
      return true;
    }
    clearTimeout(item.timeout);
    pending.delete(requestId);
    const reply: ModelCatalogReply = {
      requestId,
      ok: msg.ok === true,
    };
    if (typeof msg.model === "string") {
      reply.model = msg.model;
    }
    if (Array.isArray(msg.availableModels)) {
      reply.availableModels = msg.availableModels as AvailableModel[];
    }
    if (Array.isArray(msg.configOptions)) {
      reply.configOptions = msg.configOptions;
    }
    if (typeof msg.error === "string") {
      reply.error = msg.error;
    }
    item.resolve(reply);
    return true;
  }

  function readModelCatalog(cwd?: string): Promise<ModelCatalogReply> {
    sequence.n += 1;
    const requestId = `model-catalog-${sequence.n}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("model catalog timed out"));
      }, CATALOG_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timeout });
      const message: { type: string; requestId: string; cwd?: string } = {
        type: "read_model_catalog",
        requestId,
      };
      if (cwd) {
        message.cwd = cwd;
      }
      if (send(message)) {
        return;
      }
      clearTimeout(timeout);
      pending.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  }

  return { readModelCatalog, rejectAll, handleServerMsg };
}
