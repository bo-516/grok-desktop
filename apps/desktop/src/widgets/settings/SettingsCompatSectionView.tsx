/**
 * Settings drawer — third-party skill/rule/MCP layouts, as a collapsed list.
 * Stateless; parent owns draft.compat, the expanded flag, and patch.
 */

import { ChevronRight } from "lucide-react";
import cs from "classnames";
import { Checkbox } from "@/components/ui/Checkbox";
import { COMPAT_TOGGLES } from "@/lib/compatToggles";
import type { SettingsSpawnDraft } from "@/lib/settingsDraft";

/** Plain-language effects for compat toggles (env keys stay secondary). */
export const COMPAT_DESCRIPTIONS: Record<string, string> = {
  GROK_CLAUDE_SKILLS_ENABLED:
    "Load Claude-format skills from known project paths.",
  GROK_CLAUDE_MCP_ENABLED: "Discover Claude-format MCP server configs.",
  GROK_CLAUDE_HOOKS_ENABLED: "Run Claude-format lifecycle hooks.",
  GROK_CLAUDE_AGENTS_ENABLED: "Load Claude-format subagent definitions.",
  GROK_CLAUDE_RULES_ENABLED: "Apply Claude-format project rules.",
  GROK_CURSOR_MCP_ENABLED: "Discover Cursor-format MCP server configs.",
  GROK_CURSOR_RULES_ENABLED: "Apply Cursor-format project rules.",
  GROK_CURSOR_HOOKS_ENABLED: "Run Cursor-format lifecycle hooks.",
  GROK_AGENTS_SKILLS_ENABLED: "Load skills from ~/.agents.",
  GROK_AGENTS_COMMANDS_ENABLED: "Load slash commands from ~/.agents.",
};

export type SettingsCompatSectionViewProps = {
  /** Current SPAWN draft (compat map). */
  draft: SettingsSpawnDraft;
  /** Whether the toggle list is revealed; collapsed by default. */
  expanded: boolean;
  /** Toggle the list open/closed — parent holds the flag. */
  onToggleExpanded: () => void;
  /**
   * Patch one SPAWN draft field.
   * @param patch Partial draft fields to merge
   */
  onPatchDraft: (patch: Partial<SettingsSpawnDraft>) => void;
};

/**
 * Render Compatibility sources section as a disclosure.
 *
 * Ten always-visible toggles, each with its own description line, occupied more
 * of the drawer than every other section combined while being the setting users
 * touch least. Collapsed it costs one row; the header still reports how many
 * sources are on so the state is legible without expanding.
 *
 * @param props draft + expanded flag + toggle/patch handlers
 */
export function SettingsCompatSectionView(
  props: SettingsCompatSectionViewProps,
) {
  const { draft, expanded, onPatchDraft } = props;
  const enabledCount = COMPAT_TOGGLES.filter(
    (t) => draft.compat[t.envKey],
  ).length;

  return (
    <section className="side-panel-section">
      <h3 className="side-panel-section-title">
        <button
          type="button"
          className="panel-disclosure-btn"
          aria-expanded={expanded}
          onClick={props.onToggleExpanded}
        >
          <ChevronRight
            className={cs("panel-disclosure-icon", {
              "rotate-90": expanded,
            })}
            aria-hidden
            focusable={false}
          />
          Compatibility sources
          <span className="panel-disclosure-count">
            {enabledCount} of {COMPAT_TOGGLES.length} on
          </span>
        </button>
      </h3>
      {expanded ? (
        <>
          <p className="side-panel-hint">
            Which third-party skill, rule, and MCP layouts the agent scans.
            Applies after restart.
          </p>
          <div className="panel-group">
            {COMPAT_TOGGLES.map((t) => (
              <Checkbox
                key={t.envKey}
                className="panel-row"
                checked={Boolean(draft.compat[t.envKey])}
                onChange={(e) =>
                  onPatchDraft({
                    compat: {
                      ...draft.compat,
                      [t.envKey]: e.target.checked,
                    },
                  })
                }
                label={t.label}
                description={
                  <>
                    {COMPAT_DESCRIPTIONS[t.envKey] ?? t.label}{" "}
                    <span className="settings-env-key">{t.envKey}</span>
                  </>
                }
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
