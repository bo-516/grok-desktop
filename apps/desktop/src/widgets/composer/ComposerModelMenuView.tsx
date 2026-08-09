/**
 * Model + thinking intensity control (Codex/Cursor-style nested menus).
 * Pure presentation: open state and selections are owned by the parent widget.
 */

import cs from "classnames";
import { useEffect, useRef } from "react";
import type {
  ComposerModelOption,
  ThinkingEffort,
  ThinkingOption,
} from "./composerModels";

export type ComposerMenuPanel = "root" | "model" | "thinking" | null;

type ComposerModelMenuViewProps = {
  open: boolean;
  panel: ComposerMenuPanel;
  modelId: string;
  modelLabel: string;
  effort: ThinkingEffort;
  effortLabel: string;
  models: ComposerModelOption[];
  thinkingOptions: ThinkingOption[];
  onToggle: () => void;
  onOpenPanel: (panel: ComposerMenuPanel) => void;
  onSelectModel: (id: string) => void;
  onSelectEffort: (id: ThinkingEffort) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * Trigger pill + floating menu for model / thinking intensity.
 * @param props Open panel state and selection handlers from useComposerWidget.
 */
export function ComposerModelMenuView(props: ComposerModelMenuViewProps) {
  const {
    open,
    panel,
    modelId,
    modelLabel,
    effort,
    effortLabel,
    models,
    thinkingOptions,
    onToggle,
    onOpenPanel,
    onSelectModel,
    onSelectEffort,
    onReset,
    onClose,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      const el = rootRef.current;
      if (!el) {
        return;
      }
      if (!el.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="composer-model-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
        title="Model and thinking intensity"
      >
        <span>{modelLabel}</span>
        <span className="composer-model-trigger-dot" aria-hidden="true" />
        <span>{effortLabel}</span>
      </button>

      {open ? (
        <div className="composer-menu" role="menu">
          <button
            type="button"
            className={cs("composer-menu-row", {
              "composer-menu-row-active": panel === "model",
            })}
            role="menuitem"
            onClick={() =>
              onOpenPanel(panel === "model" ? "root" : "model")
            }
          >
            <span className="composer-menu-label">Model</span>
            <span className="composer-menu-value">
              <span className="truncate">{modelLabel}</span>
              <span className="composer-menu-chevron" aria-hidden="true">
                ›
              </span>
            </span>
          </button>

          <button
            type="button"
            className={cs("composer-menu-row", {
              "composer-menu-row-active": panel === "thinking",
            })}
            role="menuitem"
            onClick={() =>
              onOpenPanel(panel === "thinking" ? "root" : "thinking")
            }
          >
            <span className="composer-menu-label">Thinking</span>
            <span className="composer-menu-value">
              <span>{effortLabel}</span>
              <span className="composer-menu-chevron" aria-hidden="true">
                ›
              </span>
            </span>
          </button>

          <div className="composer-menu-divider" role="separator" />

          <button
            type="button"
            className="composer-menu-row"
            role="menuitem"
            onClick={onReset}
          >
            <span className="composer-menu-label">Reset to defaults</span>
            <span className="composer-menu-chevron" aria-hidden="true">
              ↺
            </span>
          </button>

          {panel === "model" ? (
            <div className="composer-menu-sub" role="menu">
              {models.map((m) => {
                const selected = m.id === modelId || m.label === modelLabel;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={cs("composer-menu-item", {
                      "composer-menu-item-active": selected,
                    })}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => onSelectModel(m.id)}
                  >
                    <span className="truncate">{m.label}</span>
                    {selected ? (
                      <span className="composer-menu-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {panel === "thinking" ? (
            <div className="composer-menu-sub" role="menu">
              {thinkingOptions.map((opt) => {
                const selected = opt.id === effort;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={cs("composer-menu-item", {
                      "composer-menu-item-active": selected,
                    })}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => onSelectEffort(opt.id)}
                  >
                    <span>{opt.label}</span>
                    {selected ? (
                      <span className="composer-menu-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
