/**
 * ACP handshake: initialize → authenticate → session/new | session/load.
 * Extracted from AcpClient for file-size; uses a thin host surface.
 */

import {
  createSessionState,
} from "./timeline.js";
import {
  tagSeedUserMessages,
} from "./sessionLifecycle.js";
import {
  extractAvailableModelsFromSessionResult,
  extractInitializeSessionMetadata,
  extractModelFromSessionResult,
  preferCommands,
  resolveAvailableModels,
} from "./sessionMetadata.js";
import type {
  InitializeResult,
  SessionState,
} from "./types.js";

/** Host surface the handshake needs from AcpClient (avoids circular imports). */
export type HandshakeHost = {
  /** JSON-RPC request with id pairing. */
  request: (method: string, params?: unknown) => Promise<unknown>;
  /** Current session snapshot. */
  getSessionState: () => SessionState;
  /** Replace session snapshot and notify listeners. */
  replaceSessionState: (state: SessionState) => void;
  /**
   * Open / close the session/load replay window. While open the host must
   * absorb replayed chunks without notifying listeners; closing flushes once.
   * Optional so lightweight hosts (tests) can skip it; skipping only restores
   * the old per-chunk repaint cost, it never changes the final state.
   */
  setReplaying?: (on: boolean) => void;
};

/**
 * Run initialize → authenticate → session/new | session/load, and prefill model and commands from grok-build metadata.
 * @param host AcpClient surface (request / getSessionState / replaceSessionState).
 * @param opts Workspace, auth, and optional resume snapshot; a bad resumeId yields an agent RPC error and is handled by the existing retry policy.
 * @returns Initialize result, stable session id, and whether the resume path was used; body text still arrives via session/update streaming.
 */
export async function runAcpHandshake(
  host: HandshakeHost,
  opts: {
    cwd: string;
    protocolVersion?: number;
    mcpServers?: unknown[];
    clientCapabilities?: unknown;
    authMethodId?: string | null;
    envApiKeyPresent?: boolean;
    /** Existing ACP session id to resume via session/load. */
    resumeId?: string;
    /** Local cached state to show while load/replay is in flight. */
    seed?: SessionState;
  },
): Promise<{ init: InitializeResult; sessionId: string; resumed: boolean }> {
  const init = (await host.request("initialize", {
    protocolVersion: opts.protocolVersion ?? 1,
    clientCapabilities: opts.clientCapabilities ?? {
      fs: { readTextFile: true, writeTextFile: false },
      terminal: false,
    },
  })) as InitializeResult;
  const initialMetadata = extractInitializeSessionMetadata(init);
  /** Captured for every subsequent setState so image gates stay available (F-STREAM-07). */
  const agentCapabilities = init.agentCapabilities;

  const methods = new Set(
    (init.authMethods ?? []).map((m) => m.id).filter(Boolean),
  );
  let methodId = opts.authMethodId ?? null;
  if (!methodId) {
    if (opts.envApiKeyPresent && methods.has("xai.api_key")) {
      methodId = "xai.api_key";
    } else if (methods.has("cached_token")) {
      methodId = "cached_token";
    } else if (methods.size > 0) {
      methodId = [...methods][0] ?? null;
    }
  }
  if (methodId) {
    await host.request("authenticate", {
      methodId,
      _meta: { headless: true },
    });
  }

  const model = initialMetadata.model;
  /** Prefer session-scoped catalog when present; otherwise initialize's agent list. */
  const modelsFromInit = initialMetadata.availableModels;

  if (opts.resumeId) {
    // Show cached transcript immediately, then agent replays on top.
    // Tag seed user/agent/thought rows so session/load replay claims by
    // identity instead of concatenating or double-appending the same turn.
    if (opts.seed && opts.seed.id === opts.resumeId) {
      host.replaceSessionState({
        ...opts.seed,
        timeline: tagSeedUserMessages(opts.seed.timeline),
        workspace: opts.cwd || opts.seed.workspace,
        model: opts.seed.model || String(model),
        availableCommands: preferCommands(
          opts.seed.availableCommands,
          initialMetadata.availableCommands,
        ),
        availableModels:
          (opts.seed.availableModels && opts.seed.availableModels.length > 0
            ? opts.seed.availableModels
            : undefined) ?? modelsFromInit,
        agentCapabilities:
          opts.seed.agentCapabilities ?? agentCapabilities,
        status: "idle",
        pendingPermission: undefined,
      });
    } else {
      host.replaceSessionState({
        ...createSessionState({
          id: opts.resumeId,
          workspace: opts.cwd,
          model: String(model),
          mode: "build",
        }),
        availableCommands: initialMetadata.availableCommands,
        availableModels: modelsFromInit,
        agentCapabilities,
      });
    }
    // grok-build requires session/load to include both cwd and mcpServers; missing either is Invalid params.
    // ACP replays the whole transcript as session/update *before* answering, so
    // gate the fan-out here: history lands in one repaint and never animates as
    // if it were being generated now.
    host.setReplaying?.(true);
    let loadResult: unknown;
    try {
      loadResult = await host.request("session/load", {
        sessionId: opts.resumeId,
        cwd: opts.cwd,
        mcpServers: opts.mcpServers ?? [],
      });
    } catch (e) {
      // Reopen the stream before bubbling, otherwise a failed resume would
      // leave the session permanently mute for the caller's retry policy.
      host.setReplaying?.(false);
      throw e;
    }
    const loadedModel = extractModelFromSessionResult(loadResult) || model;
    const loadedModels = extractAvailableModelsFromSessionResult(loadResult);
    // Keep id stable; replay / available_commands_update may have already populated fields.
    const cur = host.getSessionState();
    host.replaceSessionState({
      ...cur,
      id: opts.resumeId,
      workspace: opts.cwd || cur.workspace,
      model: cur.model || String(loadedModel),
      availableCommands: preferCommands(
        cur.availableCommands,
        initialMetadata.availableCommands,
      ),
      availableModels: resolveAvailableModels(
        loadedModels,
        cur.availableModels,
        modelsFromInit,
      ),
      agentCapabilities: cur.agentCapabilities ?? agentCapabilities,
      // Replay is finished by the time session/load answers, so the trailing
      // chunk's "streaming" must not survive: a live-looking last turn would
      // enter expanded and then visibly auto-collapse. Only a permission the
      // agent raised during load still needs the user, so it is kept.
      status: cur.status === "waiting_permission" ? cur.status : "idle",
      errorMessage: undefined,
    });
    // Single flush of the finished transcript; history enters collapsed.
    host.setReplaying?.(false);
    return { init, sessionId: opts.resumeId, resumed: true };
  }

  const session = (await host.request("session/new", {
    cwd: opts.cwd,
    mcpServers: opts.mcpServers ?? [],
  })) as { sessionId?: string };

  const sessionId = session.sessionId ?? "";
  if (!sessionId) {
    throw new Error("session/new did not return sessionId");
  }

  const newModel = extractModelFromSessionResult(session) || model;
  const sessionModels = extractAvailableModelsFromSessionResult(session);
  /**
   * session/new may emit available_commands_update / current_mode_update while the RPC
   * is in flight. Merge those into the post-handshake snapshot instead of wiping them
   * with a blank createSessionState().
   */
  const interim = host.getSessionState();
  host.replaceSessionState({
    ...createSessionState({
      id: sessionId,
      workspace: opts.cwd,
      model: String(newModel),
      mode: interim.mode || "build",
    }),
    availableCommands: preferCommands(
      interim.availableCommands,
      initialMetadata.availableCommands,
    ),
    availableModels: resolveAvailableModels(
      sessionModels,
      interim.availableModels,
      modelsFromInit,
    ),
    agentCapabilities,
    configOptions: interim.configOptions,
    title: interim.title,
  });

  return { init, sessionId, resumed: false };
}
