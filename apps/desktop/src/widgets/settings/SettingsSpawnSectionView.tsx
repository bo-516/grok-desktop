/**
 * Settings drawer — session process flags (worktree, subagents, effort, rules).
 * Stateless; parent owns draft + patch.
 */

import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import type { SettingsSpawnDraft } from "@/lib/settingsDraft";

export type SettingsSpawnSectionViewProps = {
  /** Current SPAWN draft. */
  draft: SettingsSpawnDraft;
  /**
   * Patch one SPAWN draft field.
   * @param patch Partial draft fields to merge
   */
  onPatchDraft: (patch: Partial<SettingsSpawnDraft>) => void;
};

/**
 * Render Session process section.
 *
 * Toggles are grouped in one list card and the two permission-rule fields share
 * a row: they are a deny/allow pair, and stacking them full-width made the
 * section scroll for no informational gain.
 *
 * @param props draft + patch handler
 */
export function SettingsSpawnSectionView(props: SettingsSpawnSectionViewProps) {
  const { draft, onPatchDraft } = props;
  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">Session process</h3>
      <p className="side-panel-hint">
        How the agent process is launched. Applies after restart.
      </p>

      <div className="panel-group">
        <Checkbox
          className="panel-row"
          checked={draft.worktree}
          onChange={(e) => onPatchDraft({ worktree: e.target.checked })}
          label="Start in a git worktree"
          description="Isolate the session's edits from your checkout."
        />
        <Checkbox
          className="panel-row"
          checked={draft.noSubagents}
          onChange={(e) => onPatchDraft({ noSubagents: e.target.checked })}
          label="Disable subagents"
          description="Run everything in the main session."
        />
      </div>

      <label className="field-label">
        Reasoning effort
        <Select
          value={draft.effort}
          onChange={(e) => onPatchDraft({ effort: e.target.value })}
          aria-label="Reasoning effort"
        >
          {/* SPAWN-time flag; official Grok 4.5 ladder (matches composer defaults). */}
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
      </label>
      <div className="settings-rule-grid">
        <label className="field-label">
          Deny rule
          <input
            className="text-input"
            value={draft.denyRule}
            onChange={(e) => onPatchDraft({ denyRule: e.target.value })}
            placeholder="Bash(rm -rf *)"
          />
        </label>
        <label className="field-label">
          Allow rule
          <input
            className="text-input"
            value={draft.allowRule}
            onChange={(e) => onPatchDraft({ allowRule: e.target.value })}
            placeholder="Bash(git *)"
          />
        </label>
      </div>
      <p className="side-panel-hint">Deny always wins over allow.</p>

      <div className="settings-prompts-link">
        <p className="side-panel-hint m-0">
          Long-lived preferences (language, name, workflow) live in Agent
          environment — not as session SPAWN flags.
        </p>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("grok-desktop:open-environment", {
                detail: "rules",
              }),
            );
          }}
        >
          提示词 → 打开 Agent environment · Rules
        </button>
      </div>
    </section>
  );
}
