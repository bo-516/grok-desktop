/**
 * Settings drawer — auth login/logout and CLI update check actions.
 * Stateless; parent supplies runCli callback and auth state.
 * Login and Logout are mutually exclusive (never both shown).
 */

export type SettingsAccountSectionViewProps = {
  /**
   * Run one-shot CLI channel via live bridge.
   * @param command CLI command name (`auth_login` | `auth_logout` | `update_check`)
   */
  onRunCli: (command: string) => void;
  /**
   * When true, session has a usable credential — show Logout only.
   * When false/unknown, show Login only. Never render both.
   */
  loggedIn: boolean;
};

/**
 * Render Account section with bridge CLI actions.
 *
 * Login vs Logout is exclusive from `loggedIn`. "Check for updates" is always
 * available. Button labels are verbs only; consequences live in the hint.
 *
 * @param props runCli handler + loggedIn exclusivity flag
 * @returns Account section markup for the sticky pin / body
 */
export function SettingsAccountSectionView(
  props: SettingsAccountSectionViewProps,
) {
  const { loggedIn, onRunCli } = props;
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">Account</h3>
      <div className="side-panel-actions">
        {loggedIn ? (
          <button
            type="button"
            className="btn"
            onClick={() => onRunCli("auth_logout")}
          >
            Logout
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => onRunCli("auth_login")}
          >
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
