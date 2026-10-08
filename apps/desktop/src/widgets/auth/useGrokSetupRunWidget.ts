/**
 * Setup-run state for the onboarding screen: copy a command, confirm the exact
 * argv, run it on the bridge with live output, cancel, and re-probe the
 * environment when it ends. The streaming log is high-frequency, so it lives
 * here (sunk into the widget), never in the store.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GrokSetupCommand,
  GrokSetupExit,
} from "@/bridge/liveBridgeGrokSetupTypes";
import { appendRunLog } from "@/lib/grokOnboarding";
import { useSessionStore } from "@/store/sessionStore";

/** How long the "Copied" label stays on a Copy button (ms). */
const COPIED_LABEL_MS = 1_500;

/** State and handlers for {@link OnboardingSetupView}. */
export type GrokSetupRunWidgetState = {
  /** Command awaiting the user's confirmation; null when none. */
  confirming: GrokSetupCommand | null;
  /** Command the bridge reported as started for the current / last run. */
  started: GrokSetupCommand | null;
  /** True between Run and the exit frame. */
  running: boolean;
  /** Output so far (ANSI stripped, tail-capped). */
  log: string;
  /** Exit of the last run; null while running or before any run. */
  exit: GrokSetupExit | null;
  /** Display line most recently copied (drives the "Copied" label). */
  copied: string | null;
  /** Copy a command's display line to the clipboard. */
  onCopy: (command: GrokSetupCommand) => void;
  /** Show the confirmation for a command (nothing runs yet). */
  onRequestRun: (command: GrokSetupCommand) => void;
  /** Dismiss the confirmation. */
  onCancelConfirm: () => void;
  /** Run the confirmed command on the bridge. */
  onConfirmRun: () => void;
  /** Stop the running command. */
  onCancelRun: () => void;
};

/**
 * Compose setup-run state.
 *
 * Nothing executes without two clicks: Run opens a confirmation showing the
 * exact argv, and only its Run button sends `grok_setup_run`. When the run
 * ends (any outcome) `check_environment` is requested, so a successful install
 * moves the screen to the next step on its own.
 *
 * @returns Run state and handlers.
 */
export function useGrokSetupRunWidget(): GrokSetupRunWidgetState {
  const live = useSessionStore((s) => s.live);
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);
  const [confirming, setConfirming] = useState<GrokSetupCommand | null>(null);
  const [started, setStarted] = useState<GrokSetupCommand | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [exit, setExit] = useState<GrokSetupExit | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Active run id, for Cancel; null when idle. */
  const runIdRef = useRef<string | null>(null);
  /** Guards setState after unmount (the gate can close mid-run). */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (copied === null) {
      return;
    }
    const timer = setTimeout(() => setCopied(null), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = useCallback((command: GrokSetupCommand) => {
    void navigator.clipboard
      .writeText(command.display)
      .then(() => {
        if (mountedRef.current) {
          setCopied(command.display);
        }
      })
      .catch(() => undefined);
  }, []);

  const onConfirmRun = useCallback(() => {
    if (!live || !confirming || running) {
      return;
    }
    const command = confirming;
    setConfirming(null);
    setRunning(true);
    setExit(null);
    setLog("");
    setStarted(command);
    const handle = live.grokSetup.run(command.action, {
      onStarted: (bridgeCommand) => {
        if (mountedRef.current) {
          setStarted(bridgeCommand);
        }
      },
      onOutput: (text) => {
        if (mountedRef.current) {
          setLog((prev) => appendRunLog(prev, text));
        }
      },
    });
    runIdRef.current = handle.runId;
    void handle.done.then((result) => {
      runIdRef.current = null;
      refreshEnvironment();
      if (mountedRef.current) {
        setRunning(false);
        setExit(result);
      }
    });
  }, [live, confirming, running, refreshEnvironment]);

  const onCancelRun = useCallback(() => {
    if (live && runIdRef.current) {
      live.grokSetup.cancel(runIdRef.current);
    }
  }, [live]);

  return {
    confirming,
    started,
    running,
    log,
    exit,
    copied,
    onCopy,
    onRequestRun: setConfirming,
    onCancelConfirm: () => setConfirming(null),
    onConfirmRun,
    onCancelRun,
  };
}
