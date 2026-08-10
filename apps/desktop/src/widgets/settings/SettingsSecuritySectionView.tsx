/**
 * Settings drawer — sandbox, always-approve, web fetch (security-sensitive).
 * Stateless; parent owns draft patch + credential labels.
 */

import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import {
  SANDBOX_PROFILES,
  type SandboxProfileId,
} from "@/lib/sandboxProfiles";
import type { SettingsSpawnDraft } from "@/lib/settingsDraft";

export type SettingsSecuritySectionViewProps = {
  /** Current SPAWN draft. */
  draft: SettingsSpawnDraft;
  /** macOS honesty note for sandbox network, or null. */
  networkNote: string | null;
  /** Active credential human label. */
  credentialLabel: string;
  /** Workspace requirements lock always-approve. */
  alwaysApproveLocked: boolean;
  /**
   * Patch one SPAWN draft field.
   * @param patch Partial draft fields to merge
   */
  onPatchDraft: (patch: Partial<SettingsSpawnDraft>) => void;
};

/**
 * Render Security & permissions section.
 *
 * The two permission toggles sit in one bordered list so they read as a related
 * pair, and each risk warning renders inside its own row rather than as a
 * full-width block between rows — a stack of red paragraphs pushed the controls
 * apart and made the section look longer than it is.
 *
 * @param props draft + labels + patch handler
 */
export function SettingsSecuritySectionView(
  props: SettingsSecuritySectionViewProps,
) {
  const { draft, onPatchDraft } = props;
  return (
    <section className="side-panel-section-danger">
      <h3 className="side-panel-section-title-danger">
        Security &amp; permissions
      </h3>
      <p className="side-panel-hint">
        How much of your machine and network the agent can reach. Prefer the
        tightest profile that still works; applies after restart.
      </p>

      <label className="field-label">
        Sandbox profile
        <Select
          value={draft.sandbox}
          onChange={(e) =>
            onPatchDraft({
              sandbox: e.target.value as SandboxProfileId,
            })
          }
          aria-label="Sandbox profile"
        >
          {SANDBOX_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.summary}
            </option>
          ))}
        </Select>
      </label>
      {draft.sandbox === "off" ? (
        <p className="panel-note panel-note-danger" role="alert">
          Least restrictive: full host filesystem and network. Prefer Workspace
          or Strict.
        </p>
      ) : null}
      {props.networkNote ? (
        <p className="panel-note panel-note-warning" role="alert">
          {props.networkNote}
        </p>
      ) : null}

      <div className="panel-group">
        <Checkbox
          className="panel-row"
          checked={draft.alwaysApprove}
          disabled={props.alwaysApproveLocked}
          onChange={(e) => onPatchDraft({ alwaysApprove: e.target.checked })}
          label="Always approve tools"
          description={approveDescription(
            draft.alwaysApprove,
            props.alwaysApproveLocked,
          )}
        />
        <Checkbox
          className="panel-row"
          checked={draft.webFetch}
          onChange={(e) => onPatchDraft({ webFetch: e.target.checked })}
          label="Allow web fetch tool"
          description={
            draft.webFetch
              ? "On — the agent may request arbitrary URLs."
              : "Security-sensitive: lets the agent fetch remote URLs."
          }
        />
      </div>

      <p className="side-panel-hint">
        Active credential: {props.credentialLabel}
      </p>
    </section>
  );
}

/**
 * Pick the always-approve row description for the current state.
 *
 * Kept out of JSX because the three outcomes (locked / armed / default) are a
 * risk statement, not a layout concern; a nested ternary in the row would hide
 * the fact that the "armed" copy is the only warning the user gets once the
 * standalone red block is gone.
 *
 * @param enabled Draft value of the always-approve flag
 * @param locked Workspace requirements forbid bypassing prompts
 * @returns Secondary line for the toggle row
 */
function approveDescription(enabled: boolean, locked: boolean): string {
  if (locked) {
    return "Locked by workspace requirements.";
  }
  if (enabled) {
    return "On — destructive shell commands run without asking.";
  }
  return "Skip permission prompts for every tool call.";
}
