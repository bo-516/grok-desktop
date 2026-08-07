/**
 * Pure helpers for sessionStore.
 * Keeps resume decisions and local persistence out of the Zustand definition
 * so high-frequency input state is not coupled to the global store.
 */

import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  normalizeCatalog,
  recordToSessionState,
  saveCatalogToStorage,
  type SessionRecord,
} from "./sessionCatalog";

/** Options for starting/resuming a real bridge session; forceNew=true forbids reusing a historical id. */
export type StartOpts = {
  url?: string;
  alwaysApprove?: boolean;
  cwd?: string;
  resumeId?: string;
  seed?: SessionState;
  forceNew?: boolean;
};

/** Minimal store view read by resolveResumeTarget; keeps helpers free of Zustand implementation details. */
type ResumeSource = {
  viewingSessionId: string | null;
  activeSessionId: string | null;
  session: SessionState;
  catalog: SessionRecord[];
};

/** Empty session shown on first paint; without an id, send creates a session via the real bridge. */
export const INITIAL_SESSION = createSessionState({
  id: "",
  workspace: "",
  model: "",
  mode: "build",
});

/**
 * Normalize and persist the session catalog.
 * @param catalog Latest catalog; weak-titled empty sessions are pruned first.
 *   Storage failures (e.g. private mode) are safely ignored by the lower layer.
 * @returns void; callers should still write the same normalized result into Zustand.
 */
export function persistCatalog(catalog: SessionRecord[]): void {
  saveCatalogToStorage(normalizeCatalog(catalog));
}

/**
 * Pick the real ACP session to resume so ordinary reconnect never accidentally calls session/new.
 * @param source Stable session view from the current store.
 * @param opts Overrides from the user action; forceNew=true returns only cwd.
 * @returns resumeId, cached seed, and workspace ready to pass to bridge start.
 */
export function resolveResumeTarget(
  source: ResumeSource,
  opts?: StartOpts,
): { resumeId?: string; seed?: SessionState; cwd?: string } {
  const selectedId =
    source.viewingSessionId ||
    source.activeSessionId ||
    source.session.id ||
    source.catalog[0]?.id ||
    "";
  const record = source.catalog.find((item) => item.id === selectedId);

  if (opts?.forceNew) {return { cwd: opts.cwd };}
  if (opts?.resumeId) {
    return { resumeId: opts.resumeId, seed: opts.seed, cwd: opts.cwd };
  }
  if (!selectedId) {return { cwd: opts?.cwd };}

  /** Resume seed: prefer catalog record; otherwise reuse current session when ids match. */
  let seed: ReturnType<typeof recordToSessionState> | undefined;
  if (record) {
    seed = recordToSessionState(record);
  } else if (source.session.id === selectedId) {
    seed = source.session;
  }

  return {
    resumeId: selectedId,
    seed,
    cwd: opts?.cwd || record?.workspace || source.session.workspace || undefined,
  };
}
