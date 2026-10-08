/**
 * Custom grok binary path: load the bridge's setting, edit a draft, save
 * (validated on the bridge), clear, and re-probe the environment after any
 * change so the onboarding screen and banner follow immediately.
 * Draft and in-flight state stay here (sunk into the widget), not in the store.
 */

import { useCallback, useEffect, useState } from "react";
import type { GrokBinSetting } from "@/bridge/liveBridgeGrokSetupTypes";
import { useSessionStore } from "@/store/sessionStore";

/** State and handlers for {@link GrokBinSettingView}. */
export type GrokBinSettingWidgetState = {
  /** Last setting from the bridge; null until loaded (or when offline). */
  setting: GrokBinSetting | null;
  /** Text in the path field. */
  draft: string;
  /** True while a save / clear is in flight. */
  saving: boolean;
  /** Rejection or transport error from the last action; null when none. */
  error: string | null;
  /** Confirmation after a successful save / clear; null otherwise. */
  notice: string | null;
  /** Replace the field text (clears stale error / notice). */
  onDraftChange: (value: string) => void;
  /** Validate and save the draft on the bridge. */
  onSave: () => void;
  /** Drop the custom path and go back to auto-detect. */
  onClear: () => void;
};

/**
 * Compose the custom-path form state.
 *
 * Loads once per live connection (a reconnect may be a different bridge).
 * A successful save or clear requests `check_environment`, so the new binary's
 * version / failure kind lands without a manual retry; the bridge re-reads
 * the setting on every resolve, so new sessions use it with no restart.
 *
 * @returns Form state and handlers; all handlers are no-ops while offline.
 */
export function useGrokBinSettingWidget(): GrokBinSettingWidgetState {
  const live = useSessionStore((s) => s.live);
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);
  const [setting, setSetting] = useState<GrokBinSetting | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      return;
    }
    /** Ignore a reply that lands after unmount or a reconnect. */
    let current = true;
    void live.grokSetup.getBinSetting().then((reply) => {
      if (!current || !reply.setting) {
        return;
      }
      setSetting(reply.setting);
      setDraft(reply.setting.customPath);
    });
    return () => {
      current = false;
    };
  }, [live]);

  const save = useCallback(
    (path: string, okNotice: string) => {
      if (!live) {
        return;
      }
      setSaving(true);
      setError(null);
      setNotice(null);
      void live.grokSetup.setBinSetting(path).then((reply) => {
        setSaving(false);
        if (reply.setting) {
          setSetting(reply.setting);
        }
        if (!reply.ok) {
          setError(reply.error ?? "The path was not saved.");
          return;
        }
        setDraft(reply.setting?.customPath ?? path);
        setNotice(okNotice);
        refreshEnvironment();
      });
    },
    [live, refreshEnvironment],
  );

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    setError(null);
    setNotice(null);
  }, []);

  return {
    setting,
    draft,
    saving,
    error,
    notice,
    onDraftChange,
    onSave: () =>
      save(draft, "Saved. New sessions use this grok; running ones keep theirs."),
    onClear: () => save("", "Cleared. grok is auto-detected again."),
  };
}
