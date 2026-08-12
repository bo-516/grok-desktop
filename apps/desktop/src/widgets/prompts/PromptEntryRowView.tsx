/**
 * Stateless row for one prompt entry: text, enable toggle, override badge, menu.
 * Grip supports same-scope reorder (HTML5 DnD); cross-scope move is via ⋯ menu.
 */

import cs from "classnames";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptCategory, PromptEntry, PromptScope } from "@/lib/userPrompts";

export type PromptEntryRowViewProps = {
  /** Entry to render. */
  entry: PromptEntry;
  /** 0-based index in the scope list (for reorder / move). */
  index: number;
  /** Whether this entry is overridden by a later scope (same category). */
  overridden: boolean;
  /** Whether this entry overrides an earlier scope (same category). */
  overridesEarlier: boolean;
  /** Row is read-only (foreign scope). */
  readOnly: boolean;
  /** Pending write spinner for the whole section. */
  pending: boolean;
  /** Toggle enabled. */
  onToggleEnabled: (id: string, enabled: boolean) => void;
  /** Commit text edit. */
  onCommitText: (id: string, text: string) => void;
  /** Commit category change. */
  onCommitCategory: (id: string, category: PromptCategory | undefined) => void;
  /** Delete entry. */
  onDelete: (id: string) => void;
  /** Move to another scope. */
  onMoveTo: (id: string, to: PromptScope) => void;
  /** Same-scope reorder drop. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Current scope (for move menu labels). */
  scope: PromptScope;
};

const MOVE_TARGETS: Array<{ scope: PromptScope; label: string }> = [
  { scope: "global", label: "移到全局" },
  { scope: "project", label: "移到本项目 · 团队" },
  { scope: "projectLocal", label: "移到本项目 · 仅我" },
];

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "分类" },
  { value: "language", label: "语言" },
  { value: "name", label: "称呼" },
  { value: "style", label: "风格" },
  { value: "workflow", label: "流程" },
  { value: "custom", label: "其它" },
];

/**
 * Override badge copy per §6.3: only when category makes it decidable.
 * @param overridden Earlier layer, shadowed.
 * @param overridesEarlier Later layer that wins.
 * @param scope Current scope (shapes the label).
 */
function overrideBadgeLabel(
  overridden: boolean,
  overridesEarlier: boolean,
  scope: PromptScope,
): string | null {
  if (overridden) {
    if (scope === "global") {
      return "被本项目覆盖";
    }
    return "被下层覆盖";
  }
  if (overridesEarlier) {
    if (scope === "project" || scope === "projectLocal") {
      return scope === "projectLocal" ? "覆盖团队/全局" : "覆盖全局";
    }
    return "覆盖上层";
  }
  return null;
}

/**
 * One entry row.
 * @param props Entry + handlers from usePromptsWidget.
 */
export function PromptEntryRowView(props: PromptEntryRowViewProps) {
  const {
    entry,
    index,
    overridden,
    overridesEarlier,
    readOnly,
    pending,
    onToggleEnabled,
    onCommitText,
    onCommitCategory,
    onDelete,
    onMoveTo,
    onReorder,
    scope,
  } = props;

  const [draft, setDraft] = useState(entry.text);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    setDraft(entry.text);
  }, [entry.text, entry.id]);

  const closeMenu = () => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  };

  const badge = overrideBadgeLabel(overridden, overridesEarlier, scope);

  return (
    <li
      className={cs("prompt-entry-row", {
        "prompt-entry-row-disabled": !entry.enabled,
        "opacity-60": pending,
      })}
      data-entry-id={entry.id}
      draggable={!readOnly && !pending}
      onDragStart={(e) => {
        dragFrom.current = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isInteger(from) && from !== index) {
          onReorder(from, index);
        }
        dragFrom.current = null;
      }}
    >
      <span
        className="prompt-entry-grip"
        title="拖动调整顺序"
        aria-hidden="true"
      >
        <GripVertical size={14} />
      </span>
      <input
        className={cs("text-input prompt-entry-input", {
          "line-through text-fg-muted": !entry.enabled,
        })}
        value={draft}
        disabled={readOnly || pending}
        aria-label="Prompt entry text"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (draft !== entry.text) {
            onCommitText(entry.id, draft);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
      <select
        className="prompt-entry-cat"
        aria-label="Entry category"
        disabled={readOnly || pending}
        value={entry.category ?? ""}
        onChange={(e) => {
          const v = e.currentTarget.value;
          onCommitCategory(
            entry.id,
            v ? (v as PromptCategory) : undefined,
          );
        }}
      >
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value || "none"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {badge ? (
        <span
          className={cs("prompt-badge", {
            "prompt-badge-overridden": overridden,
            "prompt-badge-overrides": overridesEarlier,
          })}
        >
          {badge}
        </span>
      ) : null}
      <label className="prompt-entry-enable">
        <input
          type="checkbox"
          checked={entry.enabled}
          disabled={readOnly || pending}
          aria-label={entry.enabled ? "Disable entry" : "Enable entry"}
          onChange={(e) => onToggleEnabled(entry.id, e.target.checked)}
        />
      </label>
      {!readOnly ? (
        <details ref={menuRef} className="prompt-entry-menu">
          <summary
            className="btn-ghost prompt-entry-menu-btn"
            aria-label="Entry actions"
          >
            <MoreHorizontal size={14} />
          </summary>
          <div className="prompt-entry-menu-panel" role="menu">
            <button
              type="button"
              className="btn-ghost prompt-entry-menu-item"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onDelete(entry.id);
              }}
            >
              删除
            </button>
            <button
              type="button"
              className="btn-ghost prompt-entry-menu-item"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onToggleEnabled(entry.id, !entry.enabled);
              }}
            >
              {entry.enabled ? "停用" : "启用"}
            </button>
            {MOVE_TARGETS.filter((t) => t.scope !== scope).map((t) => (
              <button
                key={t.scope}
                type="button"
                className="btn-ghost prompt-entry-menu-item"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onMoveTo(entry.id, t.scope);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </li>
  );
}
