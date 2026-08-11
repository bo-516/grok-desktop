/**
 * Workspace list / read / write request helpers for the live bridge client.
 * Keeps connectLiveBridge under the file-size limit; disk safety still lives on bridge.
 */

import type {
  WorkspaceEntry,
  ReadWorkspaceFileResult,
  PreviewWorkspaceFileResult,
} from "./liveBridgeTypes";

/** Pending map entry shared by list/read/write request patterns. */
type Pending<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type LiveBridgeFsApi = {
  listWorkspaceEntries: (
    query: string,
    cwd?: string,
  ) => Promise<WorkspaceEntry[]>;
  writeWorkspaceFile: (
    path: string,
    content: string,
    cwd?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readWorkspaceFile: (
    path: string,
    cwd?: string,
  ) => Promise<ReadWorkspaceFileResult>;
  /**
   * Read a workspace file for the preview drawer (may truncate).
   * @param path Workspace-relative path.
   * @param cwd Optional workspace root.
   * @param maxBytes Optional client-side ceiling hint.
   */
  previewWorkspaceFile: (
    path: string,
    cwd?: string,
    maxBytes?: number,
  ) => Promise<PreviewWorkspaceFileResult>;
  /** Reject all in-flight fs requests (socket close/error). */
  rejectAll: (error: Error) => void;
  /**
   * Dispatch a server message if it is an fs result.
   * Accepts a loose bag so callers can pass the full BridgeServerMsg union
   * without PoolEntry[] clashing with WorkspaceEntry[].
   */
  handleServerMsg: (msg: { type: string; [key: string]: unknown }) => boolean;
};

/**
 * Build pending-map based workspace FS methods bound to a WebSocket send.
 * @param send Serialize and send a client message; return false when not connected.
 */
export function createLiveBridgeFs(
  send: (message: unknown) => boolean,
): LiveBridgeFsApi {
  const pendingWorkspaceRequests = new Map<string, Pending<WorkspaceEntry[]>>();
  const pendingWrite = new Map<string, Pending<{ ok: boolean; error?: string }>>();
  const pendingRead = new Map<string, Pending<ReadWorkspaceFileResult>>();
  const pendingPreview = new Map<string, Pending<PreviewWorkspaceFileResult>>();
  const workspaceRequestState = { sequence: 0 };
  const writeRequestState = { sequence: 0 };
  const readRequestState = { sequence: 0 };
  const previewRequestState = { sequence: 0 };

  function rejectMap<T>(map: Map<string, Pending<T>>, error: Error): void {
    for (const pending of map.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    map.clear();
  }

  const listWorkspaceEntries = (
    query: string,
    cwd?: string,
  ): Promise<WorkspaceEntry[]> => {
    workspaceRequestState.sequence += 1;
    const requestId = `workspace-${workspaceRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWorkspaceRequests.delete(requestId);
        reject(new Error("Workspace entries request timed out"));
      }, 5000);
      pendingWorkspaceRequests.set(requestId, { resolve, reject, timeout });
      if (send({ type: "list_workspace_entries", requestId, query, cwd })) {
        return;
      }
      clearTimeout(timeout);
      pendingWorkspaceRequests.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  const writeWorkspaceFile = (
    filePath: string,
    content: string,
    cwd?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    writeRequestState.sequence += 1;
    const requestId = `write-${writeRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWrite.delete(requestId);
        reject(new Error("write_workspace_file timed out"));
      }, 15_000);
      pendingWrite.set(requestId, { resolve, reject, timeout });
      if (
        send({
          type: "write_workspace_file",
          requestId,
          path: filePath,
          content,
          // Bind write to the session workspace, not bridge defaultListCwd.
          cwd,
        })
      ) {
        return;
      }
      clearTimeout(timeout);
      pendingWrite.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  const readWorkspaceFile = (
    filePath: string,
    cwd?: string,
  ): Promise<ReadWorkspaceFileResult> => {
    readRequestState.sequence += 1;
    const requestId = `read-${readRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRead.delete(requestId);
        reject(new Error("read_workspace_file timed out"));
      }, 15_000);
      pendingRead.set(requestId, { resolve, reject, timeout });
      if (
        send({
          type: "read_workspace_file",
          requestId,
          path: filePath,
          cwd,
        })
      ) {
        return;
      }
      clearTimeout(timeout);
      pendingRead.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  const previewWorkspaceFile = (
    filePath: string,
    cwd?: string,
    maxBytes?: number,
  ): Promise<PreviewWorkspaceFileResult> => {
    previewRequestState.sequence += 1;
    const requestId = `preview-${previewRequestState.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingPreview.delete(requestId);
        reject(new Error("preview_workspace_file timed out"));
      }, 15_000);
      pendingPreview.set(requestId, { resolve, reject, timeout });
      if (
        send({
          type: "preview_workspace_file",
          requestId,
          path: filePath,
          cwd,
          maxBytes,
        })
      ) {
        return;
      }
      clearTimeout(timeout);
      pendingPreview.delete(requestId);
      reject(new Error("Bridge WebSocket is not connected"));
    });
  };

  return {
    listWorkspaceEntries,
    writeWorkspaceFile,
    readWorkspaceFile,
    previewWorkspaceFile,
    rejectAll: (error) => {
      rejectMap(pendingWorkspaceRequests, error);
      rejectMap(pendingWrite, error);
      rejectMap(pendingRead, error);
      rejectMap(pendingPreview, error);
    },
    handleServerMsg: (msg) => {
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : undefined;
      if (msg.type === "workspace_entries" && requestId) {
        const pending = pendingWorkspaceRequests.get(requestId);
        if (!pending) {
          return true;
        }
        clearTimeout(pending.timeout);
        pendingWorkspaceRequests.delete(requestId);
        const entries = Array.isArray(msg.entries)
          ? (msg.entries as WorkspaceEntry[])
          : [];
        pending.resolve(entries);
        return true;
      }
      if (msg.type === "write_workspace_file_result" && requestId) {
        const pending = pendingWrite.get(requestId);
        if (!pending) {
          return true;
        }
        clearTimeout(pending.timeout);
        pendingWrite.delete(requestId);
        pending.resolve({
          ok: Boolean(msg.ok),
          error: typeof msg.error === "string" ? msg.error : undefined,
        });
        return true;
      }
      if (msg.type === "read_workspace_file_result" && requestId) {
        const pending = pendingRead.get(requestId);
        if (!pending) {
          return true;
        }
        clearTimeout(pending.timeout);
        pendingRead.delete(requestId);
        pending.resolve({
          ok: Boolean(msg.ok),
          content: typeof msg.content === "string" ? msg.content : undefined,
          mimeType:
            typeof msg.mimeType === "string" ? msg.mimeType : undefined,
          bytes: typeof msg.bytes === "number" ? msg.bytes : 0,
          reason: typeof msg.reason === "string" ? msg.reason : undefined,
          error: typeof msg.error === "string" ? msg.error : undefined,
        });
        return true;
      }
      if (msg.type === "preview_workspace_file_result" && requestId) {
        const pending = pendingPreview.get(requestId);
        if (!pending) {
          return true;
        }
        clearTimeout(pending.timeout);
        pendingPreview.delete(requestId);
        pending.resolve({
          ok: Boolean(msg.ok),
          content: typeof msg.content === "string" ? msg.content : undefined,
          mimeType:
            typeof msg.mimeType === "string" ? msg.mimeType : undefined,
          bytes: typeof msg.bytes === "number" ? msg.bytes : 0,
          truncated: msg.truncated === true,
          reason: typeof msg.reason === "string" ? msg.reason : undefined,
          error: typeof msg.error === "string" ? msg.error : undefined,
        });
        return true;
      }
      return false;
    },
  };
}
