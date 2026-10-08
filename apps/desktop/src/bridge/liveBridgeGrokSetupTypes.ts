/**
 * Wire types for grok CLI onboarding: structured environment failures, the
 * install / update commands the bridge offers, setup runs with streamed
 * output, and the custom grok binary path setting.
 * Mirrors apps/bridge-go internal/grokbin + wsapi/grok_setup.go.
 */

/**
 * Why the environment probe is not ok (bridge `EnvironmentInfo.failureKind`).
 * `""` means ready. The UI branches on this, never on the message text.
 */
export type GrokFailureKind =
  | ""
  | "not_installed"
  | "bin_invalid"
  | "probe_timeout"
  | "version_unreadable"
  | "too_old"
  | "signed_out";

/** Which rule located the grok binary (bridge `grokbin.Source`). */
export type GrokPathSource = "env" | "setting" | "default" | "path" | "";

/** Setup step the bridge knows how to run. The client sends only this id. */
export type GrokSetupAction = "install" | "update";

/** One setup step as shown to the user and as the bridge would run it. */
export type GrokSetupCommand = {
  /** Step id. */
  action: GrokSetupAction;
  /** Terminal one-liner for the Copy button (official docs spelling). */
  display: string;
  /** Exact argv "Run" executes; shown before the user confirms. */
  argv: string[];
};

/** Steps offered on the bridge host. */
export type GrokSetupPlans = {
  /** Official installer; always present. */
  install: GrokSetupCommand;
  /** `grok update`; null when no grok binary was located. */
  update: GrokSetupCommand | null;
};

/** Final state of one setup run (`grok_setup_exit`). */
export type GrokSetupExit = {
  /** True only for exit code 0. */
  ok: boolean;
  /** Exit code; null when killed, canceled, or never started. */
  code?: number | null;
  /** The bridge killed the run at its 15 minute cap. */
  timedOut?: boolean;
  /** The user canceled the run. */
  canceled?: boolean;
  /** Why nothing ran (bad action, already running, spawn failure, socket loss). */
  error?: string;
};

/** Custom grok path setting plus what the bridge resolves now (`grok_bin`). */
export type GrokBinSetting = {
  /** Saved custom path; "" when auto-detecting. */
  customPath: string;
  /** GROK_BIN from the bridge environment; wins over customPath when set. */
  envOverride: string;
  /** Binary new sessions would use; "" when none resolves. */
  resolvedPath: string;
  /** Rule that produced resolvedPath. */
  source: GrokPathSource;
  /** Why nothing resolved; "" when resolvedPath is set. */
  resolveError: string;
};

/** Reply to grok_bin_get / grok_bin_set. */
export type GrokBinReply = {
  /** False when a set was rejected (nothing saved) or the socket failed. */
  ok: boolean;
  /** Current setting; absent only when the request never reached the bridge. */
  setting?: GrokBinSetting;
  /** Rejection reason. */
  error?: string;
};

/** Bridge → client frames for onboarding. */
export type GrokSetupServerMsg =
  | { type: "grok_setup_started"; runId: string; command: GrokSetupCommand }
  | { type: "grok_setup_output"; runId: string; text: string }
  | ({ type: "grok_setup_exit"; runId: string } & GrokSetupExit)
  | {
      type: "grok_bin";
      requestId: string;
      ok: boolean;
      setting?: GrokBinSetting;
      error?: string;
    };

/** Per-run callbacks for {@link GrokSetupApi.run}. */
export type GrokSetupRunHandlers = {
  /** The bridge accepted the run and is about to execute this command. */
  onStarted?: (command: GrokSetupCommand) => void;
  /** One chunk of combined stdout/stderr (may hold ANSI escapes). */
  onOutput?: (text: string) => void;
};

/** Onboarding methods on a connected live bridge. */
export type GrokSetupApi = {
  /**
   * Run a setup step on the bridge host. Call only from an explicit user
   * click after showing the command.
   * @param action Step to run.
   * @param handlers Started / output callbacks.
   * @returns runId plus a promise that settles with the exit (never rejects:
   *   a socket loss settles ok=false with an error).
   */
  run: (
    action: GrokSetupAction,
    handlers: GrokSetupRunHandlers,
  ) => { runId: string; done: Promise<GrokSetupExit> };
  /**
   * Ask the bridge to stop a run; its exit (canceled) still arrives via done.
   * @param runId Id returned by run.
   */
  cancel: (runId: string) => void;
  /** Read the custom path setting. Never rejects. */
  getBinSetting: () => Promise<GrokBinReply>;
  /**
   * Validate and save the custom path ("" clears). Never rejects.
   * @param path User input; "~" is expanded by the bridge.
   */
  setBinSetting: (path: string) => Promise<GrokBinReply>;
};
