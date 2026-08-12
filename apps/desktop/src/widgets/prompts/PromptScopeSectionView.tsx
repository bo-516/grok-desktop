/**
 * Stateless card for one prompt scope: header path, entries, add/clear.
 * Structure follows §6.4: path explains scope; empty states are action-oriented.
 */

import cs from "classnames";
import { ExternalLink, Lock, Plus, User, Users } from "lucide-react";
import {
  SCOPE_META,
  type PromptCategory,
  type PromptEntry,
  type PromptScope,
} from "@/lib/userPrompts";
import { PromptEntryRowView } from "./PromptEntryRowView";

export type PromptScopeSectionViewProps = {
  /** Scope id. */
  scope: PromptScope;
  /** Absolute path shown in the header. */
  path: string;
  /** Short display path (tilde / relative). */
  pathLabel: string;
  /** Approx token count from bytes heuristic, or null. */
  tokenLabel: string | null;
  /** Whether the file exists. */
  exists: boolean;
  /** Foreign (unmanaged) file — whole section read-only. */
  foreign: boolean;
  /** Entries for this scope. */
  entries: PromptEntry[];
  /** Entry ids overridden by a later scope. */
  overriddenIds: Set<string>;
  /** Entry ids in this scope that override an earlier scope. */
  overridingIds: Set<string>;
  /** Project unavailable (no workspace) for project scopes. */
  projectUnavailable: boolean;
  /** Show "会进 git" badge on team section. */
  showGitBadge: boolean;
  /** Project basename for team/local headers. */
  projectName: string | null;
  /** In-flight write. */
  pending: boolean;
  /** Draft text for the add field (controlled by parent). */
  draftText: string;
  /** Optional category for the next add. */
  draftCategory: PromptCategory | "";
  /** Draft change. */
  onDraftChange: (text: string) => void;
  /** Draft category change. */
  onDraftCategoryChange: (category: PromptCategory | "") => void;
  /** Add entry from draft. */
  onAdd: () => void;
  /** Clear entire scope. */
  onClear: () => void;
  /** Toggle enabled. */
  onToggleEnabled: (id: string, enabled: boolean) => void;
  /** Commit text. */
  onCommitText: (id: string, text: string) => void;
  /** Commit category. */
  onCommitCategory: (id: string, category: PromptCategory | undefined) => void;
  /** Delete. */
  onDelete: (id: string) => void;
  /** Move to other scope. */
  onMoveTo: (id: string, to: PromptScope) => void;
  /** Same-scope reorder. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Open foreign file externally (optional). */
  onOpenForeign?: () => void;
  /** Copy absolute path. */
  onCopyPath?: () => void;
};

/**
 * Pick lucide icon for the scope.
 * @param icon Meta icon key.
 */
function ScopeIcon(props: { icon: "lock" | "users" | "user" }) {
  if (props.icon === "lock") {
    return <Lock size={14} aria-hidden="true" />;
  }
  if (props.icon === "users") {
    return <Users size={14} aria-hidden="true" />;
  }
  return <User size={14} aria-hidden="true" />;
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "分类（可选）" },
  { value: "language", label: "语言" },
  { value: "name", label: "称呼" },
  { value: "style", label: "风格" },
  { value: "workflow", label: "流程" },
  { value: "custom", label: "其它" },
];

/**
 * One scope section card.
 * @param props Assembled by usePromptsWidget / PromptsPageWidget.
 */
export function PromptScopeSectionView(props: PromptScopeSectionViewProps) {
  const meta = SCOPE_META[props.scope];
  const readOnly = props.foreign || props.projectUnavailable;

  return (
    <section
      className={cs("prompt-scope", {
        "prompt-scope-foreign": props.foreign,
        "prompt-scope-unavailable": props.projectUnavailable,
        "prompt-scope-pending": props.pending,
      })}
      data-scope={props.scope}
      data-path={props.path}
    >
      <header className="prompt-scope-head">
        <div className="prompt-scope-head-left">
          <ScopeIcon icon={meta.icon} />
          <h3 className="prompt-scope-title">
            {meta.title}
            {props.projectName && props.scope !== "global" ? (
              <span className="prompt-scope-project"> · {props.projectName}</span>
            ) : null}
          </h3>
          {props.showGitBadge ? (
            <span className="prompt-badge prompt-badge-git">会进 git</span>
          ) : null}
          {props.pending ? (
            <span className="prompt-badge" aria-live="polite">
              保存中…
            </span>
          ) : null}
        </div>
        <div className="prompt-scope-head-right">
          <code className="prompt-scope-path" title={props.path}>
            {props.pathLabel}
          </code>
          {props.tokenLabel ? (
            <span className="prompt-scope-tok">{props.tokenLabel}</span>
          ) : null}
        </div>
      </header>

      {props.scope === "global" && !props.foreign && !props.projectUnavailable ? (
        <p className="prompt-scope-subhint">
          写入后终端里直接跑 grok 也会吃到；改完需重启会话才生效。
        </p>
      ) : null}

      {props.foreign ? (
        <div className="prompt-foreign-banner" role="status">
          <p className="panel-note panel-note-warning m-0">
            这个文件不是 grok-desktop 写的（外部文件），整段只读。
          </p>
          <div className="prompt-foreign-actions">
            {props.onOpenForeign || props.onCopyPath ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={props.onOpenForeign ?? props.onCopyPath}
                title={props.path}
              >
                <ExternalLink size={12} />
                复制路径 · 在编辑器中打开
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.projectUnavailable ? (
        <div className="env-empty">
          <p className="env-empty-title">打开一个项目后可配置</p>
          <p className="env-empty-hint">{meta.emptyHint}</p>
        </div>
      ) : null}

      {!props.projectUnavailable &&
      props.entries.length === 0 &&
      !props.foreign ? (
        <div className="prompt-scope-empty">
          <p className="prompt-scope-empty-title m-0">{meta.emptyHint}</p>
          <p className="env-empty-hint m-0">在下方输入一条，回车即可添加。</p>
        </div>
      ) : null}

      {!props.projectUnavailable && props.entries.length > 0 ? (
        <ul className="prompt-entry-list">
          {props.entries.map((entry, index) => (
            <PromptEntryRowView
              key={entry.id}
              entry={entry}
              index={index}
              scope={props.scope}
              overridden={props.overriddenIds.has(entry.id)}
              overridesEarlier={props.overridingIds.has(entry.id)}
              readOnly={readOnly}
              pending={props.pending}
              onToggleEnabled={props.onToggleEnabled}
              onCommitText={props.onCommitText}
              onCommitCategory={props.onCommitCategory}
              onDelete={props.onDelete}
              onMoveTo={props.onMoveTo}
              onReorder={props.onReorder}
            />
          ))}
        </ul>
      ) : null}

      {!readOnly ? (
        <div className="prompt-scope-foot">
          <input
            className="text-input prompt-add-input"
            value={props.draftText}
            onChange={(e) => props.onDraftChange(e.target.value)}
            placeholder="+ 新增一条提示词"
            aria-label={`Add prompt for ${props.scope}`}
            disabled={props.pending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.onAdd();
              }
            }}
          />
          <select
            className="prompt-add-cat"
            aria-label={`Category for new ${props.scope} prompt`}
            value={props.draftCategory}
            disabled={props.pending}
            onChange={(e) => {
              const v = e.currentTarget.value;
              props.onDraftCategoryChange(
                v ? (v as PromptCategory) : "",
              );
            }}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value || "none"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost"
            onClick={props.onAdd}
            disabled={props.pending || !props.draftText.trim()}
            aria-label="Add entry"
          >
            <Plus size={14} />
            新增
          </button>
          {props.exists && props.entries.length > 0 ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={props.onClear}
              disabled={props.pending}
            >
              清空
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
