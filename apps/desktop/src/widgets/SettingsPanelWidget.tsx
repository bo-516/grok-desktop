/**
 * Session SPAWN settings: sandbox, worktree, always-approve, tools.
 * Apply restarts the session; dirty state is sticky at the footer.
 * Also hosts instant UI appearance (light/dark + chromatic palettes).
 * Section markup lives in widgets/settings/*SectionView.
 */

import cs from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { sandboxNetworkHonestyNote } from "../lib/sandboxProfiles";
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
import { ConfirmDialogView } from "./ConfirmDialogView";
import { SidePanelShell } from "./SidePanelShell";
import {
  SettingsAccountSectionView,
  SettingsAppearanceSectionView,
  SettingsCompatSectionView,
  SettingsSecuritySectionView,
  SettingsSpawnSectionView,
} from "./settings";

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
  /*
   * Compatibility sources stay collapsed until asked for: ten toggles is the
   * longest block in the drawer and the least often changed, so expanding it by
   * default buried Account below a screen of scroll.
   */
  const [compatOpen, setCompatOpen] = useState(false);

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

  /*
   * One row: status left, action right. The stacked full-width variant read as
   * a second toolbar and cost ~70px of a 400px drawer on every open.
   */
  const footer = (
    <>
      {dirty ? (
        <p className="settings-apply-hint" role="status">
          Unsaved spawn changes — Apply restarts this session.
        </p>
      ) : (
        <p className="settings-footer-note">
          No pending spawn changes. Appearance applies instantly.
        </p>
      )}
      <button
        type="button"
        className={cs("btn btn-primary shrink-0", {
          "btn-danger": dirty,
        })}
        disabled={!dirty}
        onClick={applySpawn}
      >
        Apply
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
        {/* panel-note, not `banner`: banner carries main-column margins that
            paint inset inside the drawer. */}
        {restartNotice ? (
          <div className="settings-restart-notice" role="status">
            <p className="panel-note panel-note-warning">{restartNotice}</p>
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={clearRestartNotice}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <SettingsAppearanceSectionView
          theme={theme}
          palette={palette}
          onPickPalette={pickPalette}
        />

        <SettingsSecuritySectionView
          draft={draft}
          networkNote={networkNote}
          credentialLabel={credentialSourceLabel(credSource)}
          alwaysApproveLocked={alwaysApproveLocked}
          onPatchDraft={patchDraft}
        />

        <SettingsSpawnSectionView draft={draft} onPatchDraft={patchDraft} />

        <SettingsCompatSectionView
          draft={draft}
          expanded={compatOpen}
          onToggleExpanded={() => setCompatOpen((prev) => !prev)}
          onPatchDraft={patchDraft}
        />

        <SettingsAccountSectionView
          onRunCli={(command) => void runCli(command)}
        />
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
