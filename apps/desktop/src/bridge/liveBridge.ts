/**
 * Browser client for the local Go bridge (real grok agent stdio).
 * Multi-session: prompt/cancel/permission carry sessionId; pool and env-probe callbacks.
 * CLI channel + set_model/set_mode/restart/compact. Workspace FS helpers live in liveBridgeFs.
 *
 * Relay protocol: hot-path streaming arrives as session_update; this client reduces
 * via applySessionUpdate + eventId set dedupe and surfaces SessionState to handlers.
 * Those notifies are coalesced per animation frame (liveBridgeCoalesce); close()
 * and socket close / error flush pending ones first.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "./liveBridgeDispatch";
import { createLiveBridgeFs } from "./liveBridgeFs";
import { createLiveBridgeModelCatalog } from "./liveBridgeModelCatalog";
import type {
  AuthProbe,
  BridgeServerMsg,
  CliChannelResult,
  EnvironmentInfo,
  LiveBridgeHandle,
  LiveBridgeHandlers,
  PoolEntry,
  ReadWorkspaceFileResult,
  SessionSpawnConfig,
  StartOpts,
  WorkspaceEntry,
} from "./liveBridgeTypes";

export type {
  AuthProbe,
  BridgeServerMsg,
  CliChannelResult,
  EnvironmentInfo,
  LiveBridgeHandlers,
  PoolEntry,
  ReadWorkspaceFileResult,
  SessionSpawnConfig,
  StartOpts,
  WorkspaceEntry,
};

export {
  createLiveBridgeDispatch,
  REPLAY_TIMEOUT_MS,
} from "./liveBridgeDispatch";
export { makeAgentChunkUpdates } from "./liveBridgeFixtures";

type PendingCli = {
  resolve: (result: CliChannelResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * Connect to the real local bridge and expose multi-session control.
 * @param url Bridge WebSocket URL.
 * @param handlers State / pool / environment callbacks.
 */
export function connectLiveBridge(
  url: string,
  handlers: LiveBridgeHandlers,
): LiveBridgeHandle {
  const ws = new WebSocket(url);
  const pendingCli = new Map<string, PendingCli>();
  /**
   * Relay reduce + load-replay batching + live stream coalescing (shipped
   * path; unit-tested via createLiveBridgeDispatch with a fake scheduler).
   */
  const dispatch = createLiveBridgeDispatch({
    handlers,
    coalesce: { isForeground: handlers.isForegroundSession },
  });
  const readyCallbacks: {
    resolve?: () => void;
    reject?: (error: Error) => void;
  } = {};
  const ready = new Promise<void>((resolve, reject) => {
    readyCallbacks.resolve = resolve;
    readyCallbacks.reject = reject;
  });
  const cliRequestState = { sequence: 0 };

  const send = (message: unknown): boolean => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  };

  const fsApi = createLiveBridgeFs(send);
  const catalogApi = createLiveBridgeModelCatalog(send);

  function rejectCliRequests(error: Error): void {
    for (const pending of pendingCli.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingCli.clear();
  }

  ws.onopen = () => {
    readyCallbacks.resolve?.();
  };
  ws.onerror = () => {
    fsApi.rejectAll(new Error(`WebSocket error connecting to ${url}`));
    catalogApi.rejectAll(new Error(`WebSocket error connecting to ${url}`));
    rejectCliRequests(new Error(`WebSocket error connecting to ${url}`));
    // Land coalesced chunks before the error paints.
    dispatch.flushPendingUpdates();
    // I4: do not leave sessions muted if error aborts a load window.
    dispatch.flushAllReplays();
    readyCallbacks.reject?.(new Error(`WebSocket error connecting to ${url}`));
    handlers.onError?.(`WebSocket error: ${url}`);
  };
  ws.onclose = () => {
    fsApi.rejectAll(new Error("Bridge WebSocket closed"));
    catalogApi.rejectAll(new Error("Bridge WebSocket closed"));
    rejectCliRequests(new Error("Bridge WebSocket closed"));
    // No lost final chunk: emit coalesced notifies before onClose.
    dispatch.flushPendingUpdates();
    // I4: force-close any open replay windows before clearing buckets.
    dispatch.flushAllReplays();
    dispatch.clearBuckets();
    handlers.onClose?.();
  };
  ws.onmessage = (ev) => {
    let msg: BridgeServerMsg;
    try {
      msg = JSON.parse(String(ev.data)) as BridgeServerMsg;
    } catch {
      return;
    }
    if (fsApi.handleServerMsg(msg)) {
      return;
    }
    if (catalogApi.handleServerMsg(msg)) {
      return;
    }
    if (dispatch.handleServerMsg(msg)) {
      return;
    }
    if (msg.type === "cli_result") {
      const pending = pendingCli.get(msg.result.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingCli.delete(msg.result.requestId);
      pending.resolve(msg.result);
    }
  };

  /**
   * One-shot CLI channel (inspect / sessions / mcp / …).
   * @param command Bridge command id.
   * @param args Optional args bag.
   * @param cwd Optional workspace.
   */
  const cli = (
    command: string,
    args?: Record<string, unknown>,
    cwd?: string,
  ): Promise<CliChannelResult> => {
    cliRequestState.sequence += 1;
    const requestId = `cli-${cliRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCli.delete(requestId);
        reject(new Error(`CLI ${command} timed out`));
      }, 120_000);
      pendingCli.set(requestId, { resolve, reject, timeout });
      if (send({ type: "cli", requestId, command, args, cwd })) {
        return;
      }
      clearTimeout(timeout);
      pendingCli.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  return {
    ready,
    flushPendingUpdates: dispatch.flushPendingUpdates,
    start: (opts) => {
      // Prefill client reduce from catalog seed so Go pool-hit (empty timeline)
      // + later live chunks append instead of replacing painted history.
      if (opts?.seed?.id) {
        dispatch.seedSession(opts.seed);
      }
      return send({
        type: "start",
        cwd: opts?.cwd,
        alwaysApprove: opts?.alwaysApprove ?? false,
        resumeId: opts?.resumeId,
        seed: opts?.seed,
        forceNew: opts?.forceNew,
        spawnConfig: opts?.spawnConfig,
        // Undefined is omitted by JSON.stringify, so a normal start does
        // not send a worktree field. `{}` still creates one.
        worktree: opts?.worktree,
      });
    },
    /**
     * Prefill the client reduce bucket (e.g. optimistic user row with image
     * ContentBlocks) so `user_message_chunk` absorbs into that row instead of
     * creating a text-only agent bubble that drops thumbs mid-turn.
     * @param session Canvas session snapshot; must carry a non-empty id.
     */
    seedSession: (session: SessionState) => {
      dispatch.seedSession(session);
    },
    prompt: (text, sessionId, blocks) =>
      send({ type: "prompt", text, sessionId, blocks }),
    cancel: (sessionId) => {
      send({ type: "cancel", sessionId });
    },
    permission: (optionId, sessionId) => {
      send({ type: "permission", optionId, sessionId });
    },
    closeSession: (sessionId) => send({ type: "close_session", sessionId }),
    listPool: () => send({ type: "list_pool" }),
    checkEnvironment: () => send({ type: "check_environment" }),
    checkAuth: () => send({ type: "check_auth" }),
    listWorkspaceEntries: fsApi.listWorkspaceEntries,
    writeWorkspaceFile: fsApi.writeWorkspaceFile,
    readWorkspaceFile: fsApi.readWorkspaceFile,
    previewWorkspaceFile: fsApi.previewWorkspaceFile,
    setModel: (modelId, sessionId) =>
      send({ type: "set_model", modelId, sessionId }),
    setMode: (modeId, sessionId) =>
      send({ type: "set_mode", modeId, sessionId }),
    compact: (instruction, sessionId) =>
      send({ type: "compact", instruction, sessionId }),
    /**
     * Fork via bridge `fork_session` (reuses the CLI requestId correlation path).
     * @param sessionId Source session id.
     * @param opts Optional cwd overrides for same-folder vs worktree forks.
     */
    forkSession: (sessionId, opts) => {
      cliRequestState.sequence += 1;
      const requestId = `fork-${cliRequestState.sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingCli.delete(requestId);
          reject(new Error("fork_session timed out"));
        }, 120_000);
        pendingCli.set(requestId, { resolve, reject, timeout });
        if (
          send({
            type: "fork_session",
            requestId,
            sessionId,
            sourceCwd: opts?.sourceCwd,
            newCwd: opts?.newCwd,
          })
        ) {
          return;
        }
        clearTimeout(timeout);
        pendingCli.delete(requestId);
        reject(new Error("Bridge WebSocket is not connected"));
      });
    },
    restartSession: (sessionId, spawnConfig, alwaysApprove) =>
      send({
        type: "restart_session",
        sessionId,
        spawnConfig,
        alwaysApprove,
      }),
    /**
     * Billing via bridge `billing` (reuses the CLI requestId correlation path).
     * @param sessionId Live session that owns the grok-build process.
     */
    billing: (sessionId) => {
      cliRequestState.sequence += 1;
      const requestId = `billing-${cliRequestState.sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingCli.delete(requestId);
          reject(new Error("billing timed out"));
        }, 12_000);
        pendingCli.set(requestId, { resolve, reject, timeout });
        if (send({ type: "billing", requestId, sessionId })) {
          return;
        }
        clearTimeout(timeout);
        pendingCli.delete(requestId);
        reject(new Error("Bridge WebSocket is not connected"));
      });
    },
    /**
     * Token usage via bridge `token_usage` (same cli_result correlation as billing).
     * Used to backfill the composer ring after session/load drops occupancy.
     * @param sessionId Live session that owns the grok-build process.
     */
    tokenUsage: (sessionId) => {
      cliRequestState.sequence += 1;
      const requestId = `token-usage-${cliRequestState.sequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingCli.delete(requestId);
          reject(new Error("token_usage timed out"));
        }, 12_000);
        pendingCli.set(requestId, { resolve, reject, timeout });
        if (send({ type: "token_usage", requestId, sessionId })) {
          return;
        }
        clearTimeout(timeout);
        pendingCli.delete(requestId);
        reject(new Error("Bridge WebSocket is not connected"));
      });
    },
    cli,
    readModelCatalog: catalogApi.readModelCatalog,
    close: () => {
      // Land coalesced chunks while the store still treats the bridge as live.
      dispatch.flushPendingUpdates();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Default bridge URL (dev / packaged shell).
 * Priority: window.__GROK_BRIDGE_URL__ (Wails shell inject) → VITE_BRIDGE_URL
 * → VITE_BRIDGE_TOKEN on default port → bare ws://127.0.0.1:8765 (dev only).
 */
export function defaultBridgeUrl(): string {
  // Packaged shell injects the per-start tokenized URL before the app boots.
  if (typeof window !== "undefined") {
    const injected = (
      window as unknown as { __GROK_BRIDGE_URL__?: string }
    ).__GROK_BRIDGE_URL__;
    if (typeof injected === "string" && injected.trim()) {
      return injected.trim();
    }
  }
  const envUrl = (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env
    ?.VITE_BRIDGE_URL;
  if (envUrl) {
    return envUrl;
  }
  // Dev convenience: match bridge default port; token must be in env for auth.
  const token = (
    import.meta as { env?: { VITE_BRIDGE_TOKEN?: string } }
  ).env?.VITE_BRIDGE_TOKEN;
  if (token) {
    return `ws://127.0.0.1:8765?token=${encodeURIComponent(token)}`;
  }
  return "ws://127.0.0.1:8765";
}
