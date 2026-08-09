/**
 * Stateless main-column status banners (offline / auth / restart / queue / permission).
 * Parent supplies flags and labels; this view only renders structure and buttons.
 */

export type ShellBannersViewProps = {
  /** Live bridge connected. */
  live: boolean;
  /** Environment probe known (null → hide auth banner). */
  envKnown: boolean;
  /** Auth / environment ok. */
  authOk: boolean;
  /** Auth failure message from environment probe. */
  authMessage?: string;
  /** SPAWN / restart notice text; null hides. */
  restartNotice: string | null;
  /** Queued prompt count while turn is in flight. */
  queueLength: number;
  /** Session waiting on a permission modal. */
  waitingPermission: boolean;
  /** Run auth login CLI. */
  onLogin: () => void;
  /** Dismiss restart banner. */
  onDismissRestart: () => void;
};

/**
 * Renders stacked history banners above the timeline.
 * @param props Banner flags and handlers from the shell hook.
 * @returns Fragment of zero or more banners.
 */
export function ShellBannersView(props: ShellBannersViewProps) {
  return (
    <>
      {!props.live ? (
        <div className="banner banner-danger history-banner">
          Bridge not connected. Run <code>npm run bridge</code>, then click a
          session on the left or reconnect from the footer.
        </div>
      ) : null}
      {props.live && props.envKnown && !props.authOk ? (
        <div className="banner banner-danger history-banner" role="alert">
          {props.authMessage ??
            "Auth missing — run `grok login` or set XAI_API_KEY"}
          <button type="button" className="btn-ghost" onClick={props.onLogin}>
            Login
          </button>
        </div>
      ) : null}
      {props.restartNotice ? (
        <div className="banner banner-warning history-banner" role="status">
          {props.restartNotice}{" "}
          <button
            type="button"
            className="btn-ghost"
            onClick={props.onDismissRestart}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {props.queueLength > 0 ? (
        <div className="banner banner-info history-banner">
          {props.queueLength} prompt(s) queued — will send after this turn.
        </div>
      ) : null}
      {props.waitingPermission ? (
        <div className="banner banner-warning history-banner">
          Waiting for permission…
        </div>
      ) : null}
    </>
  );
}
