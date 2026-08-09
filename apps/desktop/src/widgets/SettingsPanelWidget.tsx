/**
 * Session SPAWN settings: sandbox, worktree, always-approve, tools.
 * Apply restarts the session; dirty state is sticky at the footer.
 * Also hosts instant UI appearance (light/dark + chromatic palettes).
 */

import cs from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import {
  SANDBOX_PROFILES,
  sandboxNetworkHonestyNote,
  type SandboxProfileId,
} from "../lib/sandboxProfiles";
import {
  credentialSourceLabel,
  resolveCredentialSource,
} from "../lib/authCredentialPriority";
import {
  COMPAT_TOGGLES,
  compatTogglesToEnv,
} from "../lib/compatToggles";
import {
  applyPalette,
  COLOR_PALETTE_OPTIONS,
  isPaletteOptionActive,
  loadPalette,
  type ColorPaletteId,
  type ColorPaletteOption,
} from "../lib/colorPalette";
import { applyTheme, loadTheme, type ThemeId } from "../lib/theme";
import {
  createDefaultSettingsDraft,
  isSettingsDraftDirty,
  type SettingsSpawnDraft,
} from "../lib/settingsDraft";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { ConfirmDialogView } from "./ConfirmDialogView";
import { SidePanelShell } from "./SidePanelShell";

/** Plain-language effects for compat toggles (env keys stay secondary). */
const COMPAT_DESCRIPTIONS: Record<string, string> = {
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

/**
 * Build initial compat map from catalog defaults.
 * @returns envKey → defaultEnabled
 */
function defaultCompatMap(): Record<string, boolean> {
  const init: Record<string, boolean> = {};
  for (const t of COMPAT_TOGGLES) {
    init[t.envKey] = t.defaultEnabled;
  }
  return init;
}

/**
 * Stateful settings drawer for SPAWN flags; Apply restarts the session.
 * Dirty close requires confirm. Checkbox/select use tokenized controls.
 * @param props open/onClose — parent toggles; Close/backdrop/Escape dismiss
 */
export function SettingsPanelWidget(props: {
  open: boolean;
  onClose: () => void;
}) {
  const restartWithSpawn = useSessionStore((s) => s.restartWithSpawn);
  const restartNotice = useSessionStore((s) => s.restartNotice);
  const clearRestartNotice = useSessionStore((s) => s.clearRestartNotice);
  const runCli = useSessionStore((s) => s.runCli);

  const [applied, setApplied] = useState<SettingsSpawnDraft>(() =>
    createDefaultSettingsDraft(defaultCompatMap()),
  );
  const [draft, setDraft] = useState<SettingsSpawnDraft>(() =>
    createDefaultSettingsDraft(defaultCompatMap()),
  );
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [palette, setPalette] = useState<ColorPaletteId>(() => loadPalette());
  const [discardOpen, setDiscardOpen] = useState(false);

  const dirty = useMemo(
    () => isSettingsDraftDirty(draft, applied),
    [draft, applied],
  );

  // Stay in sync if top-nav Light/Dark or another surface changes appearance.
  useEffect(() => {
    const onTheme = (e: Event) => {
      setTheme((e as CustomEvent<ThemeId>).detail);
    };
    const onPalette = (e: Event) => {
      setPalette((e as CustomEvent<ColorPaletteId>).detail);
    };
    window.addEventListener("grok-desktop:theme-changed", onTheme);
    window.addEventListener("grok-desktop:palette-changed", onPalette);
    return () => {
      window.removeEventListener("grok-desktop:theme-changed", onTheme);
      window.removeEventListener("grok-desktop:palette-changed", onPalette);
    };
  }, []);

  /**
   * One-click UI color: black/white force mono+theme; hues only retint accents.
   * @param option Swatch from COLOR_PALETTE_OPTIONS
   */
  const pickPalette = (option: ColorPaletteOption) => {
    if (option.forceTheme) {
      applyTheme(option.forceTheme);
      setTheme(option.forceTheme);
    }
    applyPalette(option.id);
    setPalette(option.id);
  };

  /**
   * Patch one SPAWN draft field.
   * @param patch Partial draft fields to merge
   */
  const patchDraft = useCallback((patch: Partial<SettingsSpawnDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  /**
   * Apply SPAWN flags (restarts session) and clear dirty against applied snapshot.
   */
  const applySpawn = () => {
    const compatEnv = compatTogglesToEnv(draft.compat);
    restartWithSpawn({
      sandbox: draft.sandbox === "off" ? undefined : draft.sandbox,
      worktree: draft.worktree || undefined,
      alwaysApprove: draft.alwaysApprove || undefined,
      webFetch: draft.webFetch || undefined,
      noSubagents: draft.noSubagents || undefined,
      effort: draft.effort,
      denyRules: draft.denyRule.trim() ? [draft.denyRule.trim()] : undefined,
      allowRules: draft.allowRule.trim() ? [draft.allowRule.trim()] : undefined,
      env: compatEnv,
    });
    setApplied({
      ...draft,
      compat: { ...draft.compat },
    });
  };

  /**
   * Close path: confirm when dirty so SPAWN edits are not silently dropped.
   */
  const requestClose = useCallback(() => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    props.onClose();
  }, [dirty, props]);

  const platform =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
      ? "darwin"
      : "linux";
  const networkNote = useMemo(
    () => sandboxNetworkHonestyNote(platform, draft.sandbox),
    [platform, draft.sandbox],
  );
  const environment = useSessionStore((s) => s.environment);
  const credSource = useMemo(
    () =>
      resolveCredentialSource({
        xaiApiKey: environment?.authSource === "xai_api_key",
        sessionToken: environment?.authSource === "cached_token",
      }),
    [environment?.authSource],
  );
  const alwaysApproveLocked =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("grok-desktop.requirements.always_approve_locked") ===
      "1";

  const footer = (
    <>
      {dirty ? (
        <p className="settings-apply-hint" role="status">
          Unsaved changes — Apply restarts this session so flags take effect.
        </p>
      ) : (
        <p className="side-panel-hint">
          No pending spawn changes. Appearance updates apply instantly.
        </p>
      )}
      <button
        type="button"
        className={cs("btn btn-primary", {
          "btn-danger": dirty,
        })}
        disabled={!dirty}
        onClick={applySpawn}
      >
        {dirty ? "Apply (restart session)" : "Apply"}
      </button>
    </>
  );

  return (
    <>
      <SidePanelShell
        open={props.open}
        label="Session settings"
        title="Session settings"
        onClose={requestClose}
        footer={footer}
        footerDirty={dirty}
      >
        {restartNotice ? (
          <div className="banner banner-warning" role="status">
            {restartNotice}{" "}
            <button
              type="button"
              className="btn-ghost"
              onClick={clearRestartNotice}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <section className="side-panel-section">
          <h3 className="side-panel-section-title">UI color</h3>
          <p className="side-panel-hint">
            Whole-page scheme from one brand seed (OKLCH color-mix). Black /
            white are mono; other swatches retint surfaces, text, borders, and
            accents together. Instant — no restart.
          </p>
          <ul className="palette-picker" aria-label="UI color palette">
            {COLOR_PALETTE_OPTIONS.map((option, index) => {
              const active = isPaletteOptionActive(option, palette, theme);
              const key = `${option.id}-${option.forceTheme ?? "accent"}-${index}`;
              return (
                <li key={key} className="palette-picker-item">
                  <button
                    type="button"
                    className={cs("palette-swatch-btn", {
                      "palette-swatch-btn-active": active,
                    })}
                    title={option.label}
                    aria-label={`UI color ${option.label}`}
                    aria-pressed={active}
                    onClick={() => pickPalette(option)}
                  >
                    <span className={option.swatchClass} aria-hidden="true" />
                    <span className="palette-swatch-label">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="side-panel-hint">
          Spawn flags only apply after the agent process restarts. Applying
          restarts this session and reloads conversation history.
        </p>

        <section className="side-panel-section-danger">
          <h3 className="side-panel-section-title-danger">
            Security &amp; permissions
          </h3>
          <p className="side-panel-hint">
            These options change how much of your machine and network the agent
            can reach. Prefer the tightest profile that still works for the
            task.
          </p>

          <label className="field-label">
            Sandbox profile
            <Select
              value={draft.sandbox}
              onChange={(e) =>
                patchDraft({
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
            <div className="banner banner-danger" role="alert">
              No sandbox is the least restrictive option: the agent can read and
              write the full host filesystem and use the network. Prefer
              Workspace or Strict when possible.
            </div>
          ) : null}
          {networkNote ? (
            <div className="banner banner-warning" role="alert">
              {networkNote}
            </div>
          ) : null}

          <Checkbox
            checked={draft.alwaysApprove}
            disabled={alwaysApproveLocked}
            onChange={(e) =>
              patchDraft({ alwaysApprove: e.target.checked })
            }
            label="Always approve tools (skip permission prompts)"
          />
          {draft.alwaysApprove && !alwaysApproveLocked ? (
            <div className="banner banner-warning" role="alert">
              Tools run without asking. Destructive shell commands can execute
              immediately.
            </div>
          ) : null}
          {alwaysApproveLocked ? (
            <p className="side-panel-hint">
              Locked by workspace requirements: bypass permissions is disabled.
            </p>
          ) : null}

          <Checkbox
            checked={draft.webFetch}
            onChange={(e) => patchDraft({ webFetch: e.target.checked })}
            label="Allow web fetch tool (security-sensitive)"
          />
          {draft.webFetch ? (
            <div className="banner banner-warning" role="alert">
              The agent may request arbitrary URLs. Only enable when you trust
              the session and network policy.
            </div>
          ) : null}

          <p className="side-panel-hint">
            Active credential: {credentialSourceLabel(credSource)}
          </p>
        </section>

        <section className="side-panel-section">
          <h3 className="side-panel-section-title">Session process</h3>
          <Checkbox
            checked={draft.worktree}
            onChange={(e) => patchDraft({ worktree: e.target.checked })}
            label="Start / restart in a git worktree"
          />
          <Checkbox
            checked={draft.noSubagents}
            onChange={(e) => patchDraft({ noSubagents: e.target.checked })}
            label="Disable subagents"
          />

          <label className="field-label">
            Reasoning effort
            <Select
              value={draft.effort}
              onChange={(e) => patchDraft({ effort: e.target.value })}
              aria-label="Reasoning effort"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </label>
          <label className="field-label">
            Deny rule (always wins)
            <input
              className="text-input"
              value={draft.denyRule}
              onChange={(e) => patchDraft({ denyRule: e.target.value })}
              placeholder="Bash(rm -rf *)"
            />
          </label>
          <label className="field-label">
            Allow rule
            <input
              className="text-input"
              value={draft.allowRule}
              onChange={(e) => patchDraft({ allowRule: e.target.value })}
              placeholder="Bash(git *)"
            />
          </label>
        </section>

        <section className="side-panel-section">
          <h3 className="side-panel-section-title">Compatibility sources</h3>
          <p className="side-panel-hint">
            Control which third-party skill, rule, and MCP layouts the agent
            scans. Changes apply on the next session restart.
          </p>
          {COMPAT_TOGGLES.map((t) => (
            <div key={t.envKey} className="flex flex-col gap-0.5">
              <Checkbox
                checked={Boolean(draft.compat[t.envKey])}
                onChange={(e) =>
                  patchDraft({
                    compat: {
                      ...draft.compat,
                      [t.envKey]: e.target.checked,
                    },
                  })
                }
                label={t.label}
              />
              <p className="settings-compat-desc">
                {COMPAT_DESCRIPTIONS[t.envKey] ?? t.label}
                {" · "}
                <span className="settings-env-key">{t.envKey}</span>
              </p>
            </div>
          ))}
        </section>

        <section className="side-panel-section">
          <h3 className="side-panel-section-title">Account</h3>
          <div className="side-panel-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void runCli("auth_login")}
            >
              Login (browser)
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void runCli("auth_logout")}
            >
              Logout (restarts all runtimes)
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void runCli("update_check")}
            >
              Check for CLI updates (never auto)
            </button>
          </div>
        </section>
      </SidePanelShell>

      <ConfirmDialogView
        open={discardOpen}
        title="Discard unsaved settings?"
        details={[
          "You have spawn changes that have not been applied.",
          "Closing will drop them. Apply first if you want them to take effect (restarts the session).",
        ]}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDraft({
            ...applied,
            compat: { ...applied.compat },
          });
          setDiscardOpen(false);
          props.onClose();
        }}
      />
    </>
  );
}
