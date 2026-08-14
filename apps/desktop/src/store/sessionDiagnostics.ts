/**
 * Dev-only session diagnostics dump for console debugging of provenance /
 * rail / subagent process invariants. Production builds must not register
 * the global (import.meta.env.DEV guard).
 */

import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import type { SessionStore } from "./sessionStoreTypes";

/** Compact snapshot returned by {@link dumpSessionDiagnostics}. */
export type SessionDiagnosticsDump = {
  /** Currently viewed session id, or null on empty draft. */
  viewing: string | null;
  /** sessionId → provenance string. */
  provenance: Record<string, string>;
  /** childSessionId → parentSessionId. */
  roles: Record<string, string>;
  /** Unproven wire-only ids still in isolation. */
  pending: string[];
  /** Known child buffers (streaming). */
  buffered: string[];
  /** Session-rail visible rows after filter. */
  railRows: Array<{ id: string; kind?: string; title: string }>;
  /** Subagent cards on the painted canvas. */
  subagentsInCanvas: number;
};

/**
 * Build a compact diagnostics snapshot from a store getter.
 * Pure: does not mutate store state.
 * @param get Store snapshot getter (Zustand get or test double).
 * @returns Compact provenance / rail / subagent dump.
 */
export function dumpSessionDiagnostics(
  get: () => Pick<
    SessionStore,
    | "viewingSessionId"
    | "sessionProvenance"
    | "sessionRoles"
    | "pendingSessions"
    | "childSessions"
    | "catalog"
    | "session"
  >,
): SessionDiagnosticsDump {
  const s = get();
  const roles: Record<string, string> = {};
  for (const [id, entry] of Object.entries(s.sessionRoles ?? {})) {
    roles[id] = entry.parentSessionId;
  }
  const rail = filterCatalogForSessionRail(s.catalog);
  return {
    viewing: s.viewingSessionId,
    provenance: { ...(s.sessionProvenance ?? {}) },
    roles,
    pending: Object.keys(s.pendingSessions ?? {}),
    buffered: Object.keys(s.childSessions ?? {}),
    railRows: rail.map((r) => ({
      id: r.id,
      kind: r.sessionKind,
      title: r.title,
    })),
    subagentsInCanvas: Object.keys(s.session.subagents ?? {}).length,
  };
}

/**
 * Register `window.__grokDiag` in DEV builds only.
 * @param get Store getter bound to the live Zustand store.
 */
export function registerSessionDiagnostics(
  get: () => SessionStore,
): void {
  // Vite / browser DEV only — production bundles skip registration.
  const isDev =
    typeof import.meta !== "undefined" &&
    Boolean(
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV,
    );
  if (!isDev) {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }
  (
    window as Window & {
      __grokDiag?: () => SessionDiagnosticsDump;
    }
  ).__grokDiag = () => dumpSessionDiagnostics(get);
}
