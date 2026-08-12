/**
 * Single-session runtime: spawn real grok + AcpClient + workspace fs/terminal reverse.
 * Held by RuntimePool; state changes reported via onState.
 * clientCapabilities.terminal must stay consistent with TerminalRegistry (declare only if implemented).
 */

import path from "node:path";
import {
  AcpClient,
  type ContentBlock,
  type SessionState,
  type SessionStatus,
  type SessionUpdate,
} from "@grok-desktop/acp-core";
import {
  handleReverseRequest,
  TerminalRegistry,
} from "./reverseServices.js";
import { spawnGrokAgent, type SpawnGrokOptions } from "./spawnGrok.js";
import type { PooledRuntime } from "./runtimePool.js";

/** SPAWN-only flags that require process restart mid-session (J-06). */
export type SessionSpawnConfig = {
  model?: string;
  sandbox?: string;
  alwaysApprove?: boolean;
  worktree?: string | boolean;
  ref?: string;
  maxTurns?: number;
  noPlan?: boolean;
  noSubagents?: boolean;
  rules?: string;
  disableWebSearch?: boolean;
  webFetch?: boolean;
  /** Reasoning effort (SPAWN --reasoning-effort). */
  effort?: string;
  /** Permission mode SPAWN --permission-mode. */
  permissionMode?: string;
  /** Allow rules for --allow (F-PERM-06). */
  allowRules?: string[];
  /** Deny rules for --deny (deny always wins). */
  denyRules?: string[];
  /** Extra env keys for child (compat toggles GROK_*_ENABLED, OIDC, etc.). */
  env?: Record<string, string>;
  extraArgs?: string[];
};

export type CreateSessionRuntimeOpts = {
  cwd: string;
  alwaysApprove: boolean;
  resumeId?: string;
  seed?: SessionState;
  /** SPAWN flags applied at process start. */
  spawnConfig?: SessionSpawnConfig;
  /**
   * Lifecycle / seed bookkeeping. After relay freeze this is NOT the hot path
   * for timeline growth — use onSessionUpdate for raw ACP updates.
   */
  onState: (session: SessionState) => void;
  /**
   * Raw session/update relay for the UI reduce path (O(n) broadcast).
   * Fired for every ACP update including session/load replay; the lifecycle
   * layer gates WS fan-out during replay via onReplayChange.
   */
  onSessionUpdate?: (
    update: SessionUpdate,
    sessionId: string,
    eventId: string | null,
  ) => void;
  /**
   * session/load replay window edge. Lifecycle uses this to emit
   * replay_begin / replay_end and suppress per-update broadcast.
   */
  onReplayChange?: (on: boolean, sessionId: string) => void;
  onStderr: (text: string, sessionId: string) => void;
  onInfo: (message: string, sessionId: string) => void;
  /** Child process exit (crash) — pool may auto-recover. */
  onProcessExit?: (sessionId: string, code: number | null) => void;
};

/**
 * Map spawn config to CLI args for `grok agent` (before `stdio`).
 * @param cfg SPAWN config from session settings.
 * @param alwaysApprove Shortcut for --always-approve.
 */
export function buildSpawnExtraArgs(
  cfg: SessionSpawnConfig | undefined,
  alwaysApprove: boolean,
): string[] {
  const args: string[] = [];
  if (alwaysApprove || cfg?.alwaysApprove) {
    args.push("--always-approve");
  }
  if (cfg?.model) {
    args.push("--model", cfg.model);
  }
  if (cfg?.sandbox) {
    args.push("--sandbox", cfg.sandbox);
  }
  if (cfg?.worktree === true) {
    args.push("--worktree");
  } else if (typeof cfg?.worktree === "string" && cfg.worktree) {
    args.push("--worktree", cfg.worktree);
  }
  if (cfg?.ref) {
    args.push("--ref", cfg.ref);
  }
  if (typeof cfg?.maxTurns === "number" && cfg.maxTurns > 0) {
    args.push("--max-turns", String(cfg.maxTurns));
  }
  if (cfg?.noPlan) {
    args.push("--no-plan");
  }
  if (cfg?.noSubagents) {
    args.push("--no-subagents");
  }
  // Whitespace-only rules are not useful and must not emit a bare/empty --rules.
  if (cfg?.rules && cfg.rules.trim()) {
    args.push("--rules", cfg.rules);
  }
  if (cfg?.disableWebSearch) {
    args.push("--disable-web-search");
  }
  if (cfg?.effort) {
    args.push("--reasoning-effort", cfg.effort);
  }
  if (cfg?.permissionMode) {
    args.push("--permission-mode", cfg.permissionMode);
  }
  for (const rule of cfg?.allowRules ?? []) {
    if (rule.trim()) {
      args.push("--allow", rule.trim());
    }
  }
  for (const rule of cfg?.denyRules ?? []) {
    if (rule.trim()) {
      args.push("--deny", rule.trim());
    }
  }
  if (cfg?.extraArgs?.length) {
    args.push(...cfg.extraArgs);
  }
  return args;
}

/**
 * Append experimental SPAWN env toggles (LSP tools, tool search, memory, OIDC passthrough).
 * @param cfg Spawn config + env bag.
 */
export function spawnEnvFromConfig(
  cfg: SessionSpawnConfig | undefined,
): NodeJS.ProcessEnv | undefined {
  const env: NodeJS.ProcessEnv = {};
  if (cfg?.webFetch) {
    env.GROK_WEB_FETCH = "1";
  }
  // Experimental toggles via extraArgs convention: env:KEY=VAL is not used;
  // callers pass opts.env. Keep helper for structured keys used by settings UI.
  return Object.keys(env).length ? env : undefined;
}

/**
 * Start one process per session: after handshake return a poolable PooledRuntime.
 * @param opts Workspace, resume id, callbacks; missing resumeId means session/new.
 * @returns Handshaken runtime; on failure the child is disposed and the error is thrown.
 */
export async function createSessionRuntime(
  opts: CreateSessionRuntimeOpts,
): Promise<PooledRuntime> {
  const cwd = path.resolve(opts.cwd);
  const extraArgs = buildSpawnExtraArgs(opts.spawnConfig, opts.alwaysApprove);
  // alwaysApprove already folded into extraArgs; avoid double flag.
  const envBag: NodeJS.ProcessEnv = {
    ...(opts.spawnConfig?.env ?? {}),
  };
  if (opts.spawnConfig?.webFetch) {
    envBag.GROK_WEB_FETCH = "1";
  }
  const spawnOpts: SpawnGrokOptions = {
    cwd,
    alwaysApprove: false,
    extraArgs,
    env: Object.keys(envBag).length > 0 ? envBag : undefined,
  };
  const spawned = spawnGrokAgent(spawnOpts);
  const terminals = new TerminalRegistry();

  let sessionIdHint = opts.resumeId ?? "";

  const client = new AcpClient({
    transport: spawned.transport,
    settleQuietMs: 300,
    autoPermissionOptionId: opts.alwaysApprove ? "allow_once" : null,
    onStateChange: (session) => {
      sessionIdHint = session.id || sessionIdHint;
      opts.onState(session);
    },
    onSessionUpdate: (update, sessionId, eventId) => {
      const id = sessionId || sessionIdHint;
      opts.onSessionUpdate?.(update, id, eventId);
    },
    onReplayChange: (on, sessionId) => {
      const id = sessionId || sessionIdHint;
      opts.onReplayChange?.(on, id);
    },
    onStderr: (text) => {
      process.stderr.write(text);
      opts.onStderr(text, sessionIdHint);
    },
    onAgentRequest: async (method, _id, params) => {
      return handleReverseRequest(method, params, cwd, terminals);
    },
  });

  spawned.child.on("close", (code) => {
    opts.onProcessExit?.(sessionIdHint, code);
  });

  const dispose = (): void => {
    terminals.disposeAll();
    client.dispose();
    spawned.dispose();
  };

  try {
    if (opts.seed && opts.resumeId && opts.seed.id === opts.resumeId) {
      client.replaceSessionState({
        ...opts.seed,
        workspace: cwd,
        status: "idle",
        pendingPermission: undefined,
      });
      opts.onState(client.getSessionState());
    }

    // terminal: true matches TerminalRegistry reverse implementation (F-REV-04).
    const { sessionId, init, resumed } = await client.handshake({
      cwd,
      resumeId: opts.resumeId,
      seed: opts.seed,
      envApiKeyPresent: Boolean(process.env.XAI_API_KEY),
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    sessionIdHint = sessionId;
    opts.onInfo(
      resumed
        ? `resumed session ${sessionId}`
        : `session ${sessionId} ready (models=${JSON.stringify(
            (init.availableModels ?? []).map((m) => m.id),
          )})`,
      sessionId,
    );
    opts.onState(client.getSessionState());

    const runtime: PooledRuntime = {
      sessionId,
      cwd,
      lastUsed: Date.now(),
      spawnConfig: opts.spawnConfig,
      getStatus: (): SessionStatus => client.getSessionState().status,
      getSessionState: () => client.getSessionState(),
      prompt: async (text: string, blocks?: ContentBlock[]) => {
        if (blocks && blocks.length > 0) {
          await client.prompt(sessionId, blocks);
          return;
        }
        await client.prompt(sessionId, [{ type: "text", text }]);
      },
      cancel: () => {
        client.cancel(sessionId);
      },
      respondPermission: (optionId: string) => {
        client.respondPermission(optionId);
      },
      setModel: async (modelId: string) => {
        await client.setModel(sessionId, modelId);
      },
      setMode: async (modeId: string) => {
        await client.setMode(sessionId, modeId);
      },
      compact: async (instruction?: string) => {
        await client.compact(sessionId, instruction);
      },
      tokenUsage: async () => client.tokenUsage(sessionId),
      forkSession: async (opts) => {
        const sourceCwd = (opts?.sourceCwd ?? cwd).trim() || cwd;
        const newCwd = (opts?.newCwd ?? sourceCwd).trim() || sourceCwd;
        return client.forkSession({
          sourceSessionId: sessionId,
          sourceCwd,
          newCwd,
        });
      },
      dispose,
    };
    return runtime;
  } catch (e) {
    dispose();
    throw e;
  }
}
