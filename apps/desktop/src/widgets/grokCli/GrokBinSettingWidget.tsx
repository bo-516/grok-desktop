/**
 * Stateful custom grok path form: wires {@link useGrokBinSettingWidget} to
 * {@link GrokBinSettingView}. Rendered by the Settings drawer and by the
 * onboarding screen (where Settings is unreachable behind the gate).
 */

import { GrokBinSettingView } from "./GrokBinSettingView";
import { useGrokBinSettingWidget } from "./useGrokBinSettingWidget";

export type GrokBinSettingWidgetProps = {
  /** Field label; defaults to the Settings wording. */
  label?: string;
};

/**
 * Custom grok path form with its own load / save state.
 * @param props Optional field label.
 * @returns The form.
 */
export function GrokBinSettingWidget(props: GrokBinSettingWidgetProps) {
  const state = useGrokBinSettingWidget();
  return (
    <GrokBinSettingView {...state} label={props.label ?? "Custom grok path"} />
  );
}

/**
 * Settings drawer section around the form.
 * @returns A `side-panel-section` titled "grok CLI".
 */
export function GrokCliSettingsSectionWidget() {
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">grok CLI</h3>
      <p className="side-panel-hint">
        Leave empty to auto-detect (~/.grok/bin/grok, then PATH). A new path
        applies to new sessions without restarting the app.
      </p>
      <GrokBinSettingWidget />
    </section>
  );
}
