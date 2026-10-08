/**
 * Settings drawer — startup update check (instant, no session restart).
 * Stateless. The parent reads and writes the update-check prefs.
 */

import { Checkbox } from "@/components/ui/Checkbox";
import { UPDATE_CHECK_INTERVAL_HOURS } from "@/lib/updateCheck";

export type SettingsUpdatesSectionViewProps = {
  /** Current product semver, shown so the toggle is about this build. */
  currentVersion: string;
  /** True when startup checks are allowed. */
  enabled: boolean;
  /**
   * Persist the toggle. Applies immediately; it does not restart the session.
   * @param enabled Next value from the checkbox.
   */
  onEnabledChange: (enabled: boolean) => void;
};

/**
 * "Updates" section. The check is a notice plus external links, not an installer.
 * @param props Version, toggle, and the change handler.
 * @returns The section.
 */
export function SettingsUpdatesSectionView(
  props: SettingsUpdatesSectionViewProps,
) {
  return (
    <section className="side-panel-section" data-settings-updates="">
      <h3 className="side-panel-section-title">Updates</h3>
      <p className="side-panel-hint">
        {`On startup, at most every ${UPDATE_CHECK_INTERVAL_HOURS} hours. Nothing is installed automatically.`}
      </p>
      <Checkbox
        className="panel-row"
        checked={props.enabled}
        onChange={(event) => props.onEnabledChange(event.target.checked)}
        label="Check for updates"
        description={`This build is ${props.currentVersion}. A notice appears when a newer release is published.`}
      />
    </section>
  );
}
