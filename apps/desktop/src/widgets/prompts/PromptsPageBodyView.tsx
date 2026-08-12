/**
 * Stateless shell for the prompts page: error banner, three sections, evidence.
 * Receives the fully assembled model from usePromptsWidget — no store hooks.
 */

import { PromptEvidenceBarView } from "./PromptEvidenceBarView";
import { PromptScopeSectionView } from "./PromptScopeSectionView";
import type { usePromptsWidget } from "./usePromptsWidget";

export type PromptsPageBodyViewProps = {
  /** Assembled widget model from usePromptsWidget. */
  model: ReturnType<typeof usePromptsWidget>;
};

/**
 * Pure layout for Rules & prompts.
 * @param props model from PromptsPageWidget.
 */
export function PromptsPageBodyView(props: PromptsPageBodyViewProps) {
  const { model } = props;
  return (
    <div className="env-page prompt-page" data-page="rules-prompts">
      <div className="prompt-page-intro">
        <p className="prompt-page-intro-title">三层叠加，不是三选一</p>
        <p className="prompt-page-intro-body">
          全局 → 团队 → 仅我按顺序加载；后加载的覆盖同主题的先前条目。停用会写成注释，仍占
          token——要零成本请删除。
        </p>
      </div>

      {model.error ? (
        <p className="panel-note panel-note-danger mx-3 mt-2" role="alert">
          {model.error}
          <button
            type="button"
            className="btn-ghost ml-2"
            onClick={model.clearError}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {model.loading ? (
        <p className="panel-note mx-3 mt-2">Loading prompts…</p>
      ) : null}

      <div className="prompt-scopes">
        {model.sections.map((section, i) => (
          <div key={section.scope}>
            <PromptScopeSectionView {...section} />
            {i < model.sections.length - 1 ? (
              <p className="prompt-overlay-hint">↓ 下面的覆盖上面的</p>
            ) : null}
          </div>
        ))}
      </div>

      <PromptEvidenceBarView {...model.evidence} />
    </div>
  );
}
