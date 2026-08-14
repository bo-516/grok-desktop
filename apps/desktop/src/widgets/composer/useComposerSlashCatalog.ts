/**
 * Composer `/` catalog: live handshake, last-known persist, inspect skills,
 * and desktop pager commands (`/model`, `/effort`).
 * Owns prefetch + persist so useComposerWidget stays a thin assemble layer.
 */

import { useEffect, useMemo, useState } from "react";
import type { AvailableCommand } from "@grok-desktop/acp-core";
import {
  rememberSlashCatalog,
  resolveSlashCatalog,
  loadSlashCatalog,
} from "@/lib/slashCatalog";
import {
  selectSkillRows,
  useEnvironmentStore,
} from "@/store/environmentStore";
import { useSessionStore } from "@/store/sessionStore";

/** Stable empty live snapshot so the Zustand selector does not churn. */
const EMPTY_LIVE_COMMANDS: AvailableCommand[] = [];

/**
 * Resolved slash catalog and whether a first fill is still in flight.
 * @returns commands for the `/` menu; isLoading only when the list is still empty.
 */
export function useComposerSlashCatalog(): {
  commands: AvailableCommand[];
  isLoading: boolean;
} {
  const live = useSessionStore(
    (state) => state.session.availableCommands ?? EMPTY_LIVE_COMMANDS,
  );
  const connectionMode = useSessionStore((state) => state.connectionMode);
  const runCli = useSessionStore((state) => state.runCli);
  const snapshot = useEnvironmentStore((state) => state.snapshot);
  const envStatus = useEnvironmentStore((state) => state.status);
  const loadEnv = useEnvironmentStore((state) => state.load);
  const [cached, setCached] = useState(loadSlashCatalog);

  const commands = useMemo(
    () => resolveSlashCatalog(live, cached, selectSkillRows(snapshot)),
    [cached, live, snapshot],
  );

  useEffect(() => {
    if (rememberSlashCatalog(commands)) {
      setCached(loadSlashCatalog());
    }
  }, [commands]);

  useEffect(() => {
    if (connectionMode !== "live-bridge") {
      return;
    }
    void loadEnv(runCli);
  }, [connectionMode, loadEnv, runCli]);

  const isLoading =
    commands.length === 0 &&
    (connectionMode === "connecting" ||
      (connectionMode === "live-bridge" && envStatus === "loading"));

  return { commands, isLoading };
}
