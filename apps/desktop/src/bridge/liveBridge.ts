/**
 * Browser client for the local Node bridge (real grok agent stdio).
 * Protocol: JSON messages over WebSocket (see apps/bridge/src/server.ts).
 */

import type { SessionState } from "@grok-desktop/acp-core";

/** Workspace-relative paths scanned by the real bridge for `@` completion in the input. */
export type WorkspaceEntry = {
  path: string;
  kind: "file" | "directory";
};

export type BridgeServerMsg =
  | { type: "hello"; cwd: string; port: number }
  | { type: "state"; session: SessionState }
  | { type: "stderr"; text: string }
  | { type: "error"; message: string }
  | { type: "info"; message: string }
  | { type: "workspace_entries"; requestId: string; entries: WorkspaceEntry[] }
  | { type: "pong" };

export type LiveBridgeHandlers = {
  onState: (session: SessionState) => void;
  onInfo?: (message: string) => void;
  onError?: (message: string) => void;
  onStderr?: (text: string) => void;
  onHello?: (cwd: string) => void;
  onClose?: () => void;
};

export type StartOpts = {
  cwd?: string;
  alwaysApprove?: boolean;
  resumeId?: string;
  seed?: SessionState;
  forceNew?: boolean;
};

/**
 * Connect to the real local bridge and expose session control plus workspace `@` query entry points.
 * @param url Bridge WebSocket URL; on connection failure, ready and file-query promises reject.
 * @param handlers Live state, diagnostics, and close callbacks; missing optional handlers do not affect the ACP stream.
 * @returns A control surface for start/send/cancel, plus a completion function that reads files only from the bridge.
 */
export function connectLiveBridge(
  url: string,
  handlers: LiveBridgeHandlers,
): {
  /** @returns Whether start was written to the WebSocket. */
  start: (opts?: StartOpts) => boolean;
  /** @returns Whether the prompt was written to the WebSocket; callers must keep the draft when false. */
  prompt: (text: string) => boolean;
  cancel: () => void;
  permission: (optionId: string) => void;
  listWorkspaceEntries: (query: string) => Promise<WorkspaceEntry[]>;
  close: () => void;
  ready: Promise<void>;
} {
  const ws = new WebSocket(url);
  /** Promise callbacks still waiting on the bridge file list; all must fail when the connection closes. */
  const pendingWorkspaceRequests = new Map<
    string,
    {
      resolve: (entries: WorkspaceEntry[]) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  /** Promise callbacks for the first WebSocket connection; always assigned after constructing ready. */
  const readyCallbacks: {
    resolve?: () => void;
    reject?: (error: Error) => void;
  } = {};
  const ready = new Promise<void>((resolve, reject) => {
    readyCallbacks.resolve = resolve;
    readyCallbacks.reject = reject;
  });
  /** Request id to avoid concurrent typing mixing up `@` completion responses. */
  const workspaceRequestState = { sequence: 0 };

  ws.onopen = () => {
    readyCallbacks.resolve?.();
  };
  ws.onerror = () => {
    rejectWorkspaceRequests(new Error(`WebSocket error connecting to ${url}`));
    readyCallbacks.reject?.(new Error(`WebSocket error connecting to ${url}`));
    handlers.onError?.(`WebSocket error: ${url}`);
  };
  ws.onclose = () => {
    rejectWorkspaceRequests(new Error("Bridge WebSocket closed"));
    handlers.onClose?.();
  };
  ws.onmessage = (ev) => {
    let msg: BridgeServerMsg;
    try {
      msg = JSON.parse(String(ev.data)) as BridgeServerMsg;
    } catch {
      return;
    }
    if (msg.type === "state") {handlers.onState(msg.session);}
    else if (msg.type === "info") {handlers.onInfo?.(msg.message);}
    else if (msg.type === "error") {handlers.onError?.(msg.message);}
    else if (msg.type === "stderr") {handlers.onStderr?.(msg.text);}
    else if (msg.type === "hello") {handlers.onHello?.(msg.cwd);}
    else if (msg.type === "workspace_entries") {
      const pending = pendingWorkspaceRequests.get(msg.requestId);
      if (!pending) {return;}
      clearTimeout(pending.timeout);
      pendingWorkspaceRequests.delete(msg.requestId);
      pending.resolve(msg.entries);
    }
  };

  /**
   * Send one JSON message to the open bridge.
   * @param message Browser-to-bridge protocol message; not buffered when disconnected — callers must handle false.
   * @returns Whether the message was actually written to the WebSocket.
   */
  const send = (message: unknown): boolean => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  };

  /**
   * Request candidate paths from the current real workspace.
   * @param query Relative path fragment after `@`; the promise fails if the bridge is unavailable or does not respond within five seconds.
   * @returns Matching relative paths; never falls back to a local fixture.
   */
  const listWorkspaceEntries = (query: string): Promise<WorkspaceEntry[]> => {
    workspaceRequestState.sequence += 1;
    const requestId = `workspace-${workspaceRequestState.sequence}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWorkspaceRequests.delete(requestId);
        reject(new Error("Workspace entries request timed out"));
      }, 5000);
      pendingWorkspaceRequests.set(requestId, { resolve, reject, timeout });
      if (send({ type: "list_workspace_entries", requestId, query })) {return;}
      clearTimeout(timeout);
      pendingWorkspaceRequests.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  /**
   * Fail all outstanding file-completion requests immediately so the input does not keep a stale loading state.
   * @param error Connection-layer failure reason; passed through to each requestor's catch branch.
   * @returns void.
   */
  function rejectWorkspaceRequests(error: Error): void {
    for (const pending of pendingWorkspaceRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingWorkspaceRequests.clear();
  }

  return {
    ready,
    /**
     * Ask the bridge to start/resume a session.
     * @param opts forceNew / resumeId / alwaysApprove, etc.; returns false when the WS is not open.
     * @returns Whether the start message was written (does not mean the agent handshake succeeded).
     */
    start: (opts) =>
      send({
        type: "start",
        cwd: opts?.cwd,
        alwaysApprove: opts?.alwaysApprove ?? false,
        resumeId: opts?.resumeId,
        seed: opts?.seed,
        forceNew: opts?.forceNew,
      }),
    /**
     * Send a user prompt.
     * @param text Non-empty body; caller is responsible for trimming.
     * @returns Whether it was written to the WebSocket; when false the caller must keep the draft.
     */
    prompt: (text) => send({ type: "prompt", text }),
    cancel: () => send({ type: "cancel" }),
    permission: (optionId) => send({ type: "permission", optionId }),
    listWorkspaceEntries,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Default bridge URL (dev). Overridable via VITE_BRIDGE_URL. */
export function defaultBridgeUrl(): string {
  return (
    (import.meta as { env?: { VITE_BRIDGE_URL?: string } }).env
      ?.VITE_BRIDGE_URL ?? "ws://127.0.0.1:8765"
  );
}
