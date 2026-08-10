/**
 * Settings drawer — auth login/logout and CLI update check actions.
 * Stateless; parent supplies runCli callback.
 */

export type SettingsAccountSectionViewProps = {
  /**
   * Run one-shot CLI channel via live bridge.
   * @param command CLI command name
   */
  onRunCli: (command: string) => void;
};

/**
 * Render Account section with bridge CLI actions.
 *
 * Button labels carry only the verb; the consequences that used to live inside
 * them ("restarts all runtimes", "never auto") are stated once in the hint, so
 * three buttons fit one wrapped row instead of three full-width lines.
 *
 * @param props runCli handler
 */
export function SettingsAccountSectionView(
  props: SettingsAccountSectionViewProps,
) {
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">Account</h3>
      <div className="side-panel-actions">
        <button
          type="button"
          className="btn"
          onClick={() => props.onRunCli("auth_login")}
        >
          Login
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => props.onRunCli("auth_logout")}
        >
          Logout
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => props.onRunCli("update_check")}
        >
          Check for updates
        </button>
      </div>
      <p className="side-panel-hint">
        Login opens a browser. Logout restarts all runtimes. Updates are never
        installed automatically.
      </p>
    </section>
  );
}
