/**
 * Settings drawer — auth login/logout and CLI update check actions.
 * Stateless; parent supplies the handlers and auth state.
 * Login and Logout are mutually exclusive (never both shown).
 */

export type SettingsAccountSectionViewProps = {
  /**
   * Run one-shot CLI channel via live bridge (non-auth commands).
   * @param command CLI command name (`update_check`)
   */
  onRunCli: (command: string) => void;
  /**
   * Start `grok login` and re-probe when it returns. Separate from onRunCli
   * because auth commands must refresh the login state, not just fire.
   */
  onLogin: () => void;
  /** Run `grok logout` and re-probe; the bridge disposes every runtime. */
  onLogout: () => void;
  /**
   * When true, the bridge reports a usable credential — show Logout only.
   * When false/unknown, show Login only. Never render both.
   */
  loggedIn: boolean;
};

/**
 * Render Account section with bridge CLI actions.
 *
 * Login vs Logout is exclusive from `loggedIn`, which tracks the 3s auth poll —
 * so signing out in a terminal flips this row without reopening the drawer.
 * "Check for updates" is always available. Button labels are verbs only;
 * consequences live in the hint.
 *
 * @param props Auth handlers, CLI runner, and the loggedIn exclusivity flag
 * @returns Account section markup for the sticky pin / body
 */
export function SettingsAccountSectionView(
  props: SettingsAccountSectionViewProps,
) {
  const { loggedIn, onRunCli, onLogin, onLogout } = props;
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">Account</h3>
      <div className="side-panel-actions">
        {loggedIn ? (
          <button type="button" className="btn" onClick={onLogout}>
            Logout
          </button>
        ) : (
          <button type="button" className="btn" onClick={onLogin}>
            Login
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => onRunCli("update_check")}
        >
          Check for updates
        </button>
      </div>
      <p className="side-panel-hint">
        {loggedIn
          ? "Logout restarts all runtimes. Updates are never installed automatically."
          : "Login opens a browser. Updates are never installed automatically."}
      </p>
    </section>
  );
}
