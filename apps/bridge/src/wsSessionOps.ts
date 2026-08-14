/**
 * Mid-session ops: set_model / set_mode / token_usage / CLI channel.
 * Shared by wsHandlers so server entry stays thin and under the line cap.
 */

import path from "node:path";
import type { WebSocket } from "ws";
import { dispatchCliCommand } from "./cliDispatch.js";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import type { RuntimePool } from "./runtimePool.js";

/** Minimal runtime surface used by set_model / set_mode / token_usage / billing / fork. */
export type SessionOpRuntime = {
  sessionId: string;
  setModel?: (modelId: string) => Promise<void>;
  setMode?: (modeId: string) => Promise<void>;
  tokenUsage?: () => Promise<unknown>;
  /** Account weekly remaining via `_x.ai/billing`. */
  billing?: () => Promise<unknown>;
  forkSession?: (opts?: {
    sourceCwd?: string;
    newCwd?: string;
  }) => Promise<unknown>;
};

/** Closures injected from createBridgeHandlers. */
export type SessionOpDeps = {
  pool: RuntimePool;
  send: (ws: WebSocket, msg: ServerMsg) => void;
  requireRuntime: (sessionId?: string) => SessionOpRuntime;
  getDefaultListCwd: () => string;
  onAuthLogout: () => void;
};

/**
 * session/set_model with restart_required fallback when agent lacks the method.
 * @param deps Pool + send + requireRuntime.
 * @param ws Reply socket.
 * @param sessionId Optional target.
 * @param modelId Model id from UI.
 */
export async function handleSetModel(
  deps: SessionOpDeps,
  ws: WebSocket,
  sessionId: string | undefined,
  modelId: string,
): Promise<void> {
  const { pool, send, requireRuntime } = deps;
  const rt = requireRuntime(sessionId);
  pool.touch(rt.sessionId);
  if (!rt.setModel) {
    throw new Error("set_model not available on runtime");
  }
  try {
    await rt.setModel(modelId);
    send(ws, {
      type: "info",
      message: `model set to ${modelId}`,
      sessionId: rt.sessionId,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // SPAWN fallback path: notify UI that restart is required (J-06).
    if (/method not|not found|-32601/i.test(errMsg)) {
      send(ws, {
        type: "restart_required",
        sessionId: rt.sessionId,
        reason:
          "session/set_model is not supported by this agent; restart with --model to apply",
        setting: "model",
      });
    }
    throw e;
  }
}

/**
 * session/set_mode with restart_required fallback when agent lacks the method.
 * @param deps Pool + send + requireRuntime.
 * @param ws Reply socket.
 * @param sessionId Optional target.
 * @param modeId Mode id from UI.
 */
export async function handleSetMode(
  deps: SessionOpDeps,
  ws: WebSocket,
  sessionId: string | undefined,
  modeId: string,
): Promise<void> {
  const { pool, send, requireRuntime } = deps;
  const rt = requireRuntime(sessionId);
  pool.touch(rt.sessionId);
  if (!rt.setMode) {
    throw new Error("set_mode not available on runtime");
  }
  try {
    await rt.setMode(modeId);
    send(ws, {
      type: "info",
      message: `mode set to ${modeId}`,
      sessionId: rt.sessionId,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (/method not|not found|-32601/i.test(errMsg)) {
      send(ws, {
        type: "restart_required",
        sessionId: rt.sessionId,
        reason:
          "session/set_mode is not supported; restart with --permission-mode to apply",
        setting: "mode",
      });
    }
    throw e;
  }
}

/**
 * token_usage RPC → cli_result envelope for the UI.
 * @param deps Pool + send + requireRuntime.
 * @param ws Reply socket.
 * @param sessionId Optional target.
 * @param requestId Client correlation id.
 */
export async function handleTokenUsage(
  deps: SessionOpDeps,
  ws: WebSocket,
  sessionId: string | undefined,
  requestId: string,
): Promise<void> {
  const { pool, send, requireRuntime } = deps;
  const rt = requireRuntime(sessionId);
  pool.touch(rt.sessionId);
  if (!rt.tokenUsage) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: "token_usage not available",
      },
    });
    return;
  }
  try {
    const data = await rt.tokenUsage();
    send(ws, {
      type: "cli_result",
      result: { requestId, ok: true, data },
    });
  } catch (e) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

/**
 * `_x.ai/billing` → cli_result envelope for the UI weekly remaining chip.
 * @param deps Pool + send + requireRuntime.
 * @param ws Reply socket.
 * @param sessionId Optional target (must be a live resident to carry the RPC).
 * @param requestId Client correlation id.
 */
export async function handleBilling(
  deps: SessionOpDeps,
  ws: WebSocket,
  sessionId: string | undefined,
  requestId: string,
): Promise<void> {
  const { pool, send, requireRuntime } = deps;
  const rt = requireRuntime(sessionId);
  pool.touch(rt.sessionId);
  if (!rt.billing) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: "billing not available",
      },
    });
    return;
  }
  try {
    const data = await rt.billing();
    send(ws, {
      type: "cli_result",
      result: { requestId, ok: true, data },
    });
  } catch (e) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

/**
 * `_x.ai/session/fork` → `cli_result` envelope with `newSessionId`.
 * @param deps Pool + send + requireRuntime.
 * @param ws Reply socket.
 * @param sessionId Optional target (defaults to focused runtime).
 * @param requestId Client correlation id.
 * @param sourceCwd Optional source workspace override.
 * @param newCwd Optional child workspace (same as source for non-worktree).
 */
export async function handleForkSession(
  deps: SessionOpDeps,
  ws: WebSocket,
  sessionId: string | undefined,
  requestId: string,
  sourceCwd?: string,
  newCwd?: string,
): Promise<void> {
  const { pool, send, requireRuntime } = deps;
  const rt = requireRuntime(sessionId);
  pool.touch(rt.sessionId);
  if (!rt.forkSession) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: "fork_session not available",
      },
    });
    return;
  }
  try {
    const data = await rt.forkSession({ sourceCwd, newCwd });
    send(ws, {
      type: "cli_result",
      result: { requestId, ok: true, data },
    });
  } catch (e) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

/**
 * CLI channel (inspect/sessions/mcp/worktree/auth); logout disposes the pool.
 * @param deps Ops deps including onAuthLogout.
 * @param ws Reply socket.
 * @param msg Typed cli ClientMsg.
 */
export async function handleCli(
  deps: SessionOpDeps,
  ws: WebSocket,
  msg: Extract<ClientMsg, { type: "cli" }>,
): Promise<void> {
  const { send, getDefaultListCwd, onAuthLogout } = deps;
  try {
    const data = await dispatchCliCommand(
      msg.command,
      msg.args ?? {},
      msg.cwd ? path.resolve(msg.cwd) : getDefaultListCwd(),
    );
    // Logout must kill all runtimes (F-AUTH-07).
    if (msg.command === "auth_logout") {
      onAuthLogout();
    }
    send(ws, {
      type: "cli_result",
      result: { requestId: msg.requestId, ok: true, data },
    });
  } catch (e) {
    send(ws, {
      type: "cli_result",
      result: {
        requestId: msg.requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}
