/**
 * Custom grok binary path form: current resolution, path field, Save / Use
 * auto-detect, and the result line. Stateless — the parent hook owns the
 * draft, the bridge calls, and the messages.
 */

import { useId } from "react";
import type { GrokPathSource } from "@/bridge/liveBridgeGrokSetupTypes";
import type { GrokBinSettingWidgetState } from "./useGrokBinSettingWidget";

/** Human label per resolution rule, shown after the resolved path. */
const SOURCE_LABELS: Record<GrokPathSource, string> = {
  env: "from the GROK_BIN environment variable",
  setting: "custom path",
  default: "default install location",
  path: "found on PATH",
  "": "",
};

export type GrokBinSettingViewProps = GrokBinSettingWidgetState & {
  /** Field label; differs between Settings and the onboarding screen. */
  label: string;
};

/**
 * Render the form.
 * @param props Hook state plus the field label.
 * @returns Form block; the field is disabled while saving or before the
 *   setting has loaded (offline).
 */
export function GrokBinSettingView(props: GrokBinSettingViewProps) {
  const { setting, draft, saving, error, notice, label } = props;
  /** Ties the visible label to the input (the row also holds a button). */
  const inputId = useId();
  const loaded = setting !== null;
  const sourceLabel = setting ? SOURCE_LABELS[setting.source] : "";
  return (
    <div className="grok-bin-form">
      {setting?.resolvedPath ? (
        <p className="grok-bin-current">
          Using <code>{setting.resolvedPath}</code>
          {sourceLabel ? ` (${sourceLabel})` : null}
        </p>
      ) : null}
      {setting?.envOverride ? (
        <p className="grok-bin-current">
          GROK_BIN is set where the app was launched, so it wins over the path
          below. Unset it and restart the app to use this setting.
        </p>
      ) : null}
      <div className="field-label">
        <label htmlFor={inputId}>{label}</label>
        <div className="grok-bin-row">
          <input
            id={inputId}
            className="text-input font-mono"
            value={draft}
            disabled={!loaded || saving}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="/path/to/grok (empty = auto-detect)"
            onChange={(e) => props.onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.onSave();
              }
            }}
          />
          <button
            type="button"
            className="btn shrink-0"
            disabled={!loaded || saving || draft.trim() === ""}
            onClick={props.onSave}
          >
            {saving ? "Checking…" : "Save"}
          </button>
        </div>
      </div>
      {setting?.customPath ? (
        <button
          type="button"
          className="btn-ghost self-start"
          disabled={saving}
          onClick={props.onClear}
        >
          Use auto-detect instead
        </button>
      ) : null}
      {error ? (
        <p className="grok-bin-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="grok-bin-current" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
