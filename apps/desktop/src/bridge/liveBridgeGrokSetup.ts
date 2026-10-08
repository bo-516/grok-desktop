/**
 * grok CLI onboarding requests for the live bridge client: setup runs
 * (`grok_setup_run` → started / output* / exit) and the custom binary path
 * (`grok_bin_get` / `grok_bin_set` → `grok_bin`). Correlates on its own
 * runId / requestId maps so these never collide with cli_result.
 */

import type {
  GrokBinReply,
  GrokSetupAction,
  GrokSetupApi,
  GrokSetupCommand,
  GrokSetupExit,
  GrokSetupRunHandlers,
} from "./liveBridgeGrokSetupTypes";

/** Bound for grok_bin replies (a stat plus a small file write on the bridge). */
const BIN_SETTING_TIMEOUT_MS = 15_000;

/** One in-flight setup run. No client timeout: the bridge caps runs at 15 min. */
type PendingRun = {
  /** Started / output callbacks from the caller. */
  handlers: GrokSetupRunHandlers;
  /** Settles the run's done promise. */
  resolve: (exit: GrokSetupExit) => void;
};

/** One in-flight grok_bin request. */
type PendingBin = {
  /** Settles the request's promise. */
  resolve: (reply: GrokBinReply) => void;
  /** Fallback timer; cleared on reply. */
  timeout: ReturnType<typeof setTimeout>;
};

/** Onboarding API plus the hooks liveBridge needs to route frames. */
export type LiveBridgeGrokSetup = {
  /** Methods exposed on the bridge handle as `grokSetup`. */
  api: GrokSetupApi;
  /**
   * Route one server frame when it belongs to onboarding.
   * @param msg Loose bag so the full BridgeServerMsg union can be passed.
   * @returns True when the frame was an onboarding frame (handled or orphaned).
   */
  handleServerMsg: (msg: { type: string; [key: string]: unknown }) => boolean;
  /**
   * Settle everything in flight as failed (socket close / error).
   * @param error Reason shown to the user.
   */
  failAll: (error: string) => void;
};

/**
 * Build the onboarding client bound to a WebSocket send.
 * @param send Serialize and send a client message; false when not connected.
 * @returns API, frame router, and failAll for socket loss.
 */
export function createLiveBridgeGrokSetup(
  send: (message: unknown) => boolean,
): LiveBridgeGrokSetup {
  const runs = new Map<string, PendingRun>();
  const bins = new Map<string, PendingBin>();
  const sequence = { n: 0 };

  /** Next unique id with the given prefix. */
  const nextId = (prefix: string): string => {
    sequence.n += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.n}`;
  };

  const run = (action: GrokSetupAction, handlers: GrokSetupRunHandlers) => {
    const runId = nextId("setup");
    const done = new Promise<GrokSetupExit>((resolve) => {
      runs.set(runId, { handlers, resolve });
      if (!send({ type: "grok_setup_run", runId, action })) {
        runs.delete(runId);
        resolve({ ok: false, error: "Bridge WebSocket is not connected" });
      }
    });
    return { runId, done };
  };

  const binRequest = (message: Record<string, unknown>) =>
    new Promise<GrokBinReply>((resolve) => {
      const requestId = nextId("grokbin");
      const timeout = setTimeout(() => {
        bins.delete(requestId);
        resolve({ ok: false, error: "The bridge did not answer in time" });
      }, BIN_SETTING_TIMEOUT_MS);
      bins.set(requestId, { resolve, timeout });
      if (!send({ ...message, requestId })) {
        clearTimeout(timeout);
        bins.delete(requestId);
        resolve({ ok: false, error: "Bridge WebSocket is not connected" });
      }
    });

  function handleServerMsg(msg: {
    type: string;
    [key: string]: unknown;
  }): boolean {
    if (msg.type === "grok_bin") {
      const id = String(msg.requestId ?? "");
      const pending = bins.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        bins.delete(id);
        pending.resolve(msg as unknown as GrokBinReply);
      }
      return true;
    }
    if (!msg.type.startsWith("grok_setup_")) {
      return false;
    }
    const id = String(msg.runId ?? "");
    const pending = runs.get(id);
    if (!pending) {
      return true;
    }
    if (msg.type === "grok_setup_started") {
      pending.handlers.onStarted?.(msg.command as GrokSetupCommand);
    } else if (msg.type === "grok_setup_output") {
      pending.handlers.onOutput?.(String(msg.text ?? ""));
    } else if (msg.type === "grok_setup_exit") {
      runs.delete(id);
      const { type: _type, runId: _runId, ...exit } = msg;
      pending.resolve(exit as unknown as GrokSetupExit);
    }
    return true;
  }

  function failAll(error: string): void {
    for (const pending of runs.values()) {
      pending.resolve({ ok: false, error });
    }
    runs.clear();
    for (const pending of bins.values()) {
      clearTimeout(pending.timeout);
      pending.resolve({ ok: false, error });
    }
    bins.clear();
  }

  return {
    api: {
      run,
      cancel: (runId) => {
        send({ type: "grok_setup_cancel", runId });
      },
      getBinSetting: () => binRequest({ type: "grok_bin_get" }),
      setBinSetting: (path) => binRequest({ type: "grok_bin_set", path }),
    },
    handleServerMsg,
    failAll,
  };
}
