/**
 * Stateless evidence bar: inspect-loaded instruction count + token estimate.
 */

import cs from "classnames";

export type PromptEvidenceBarViewProps = {
  /** Number of instruction files grok reported. */
  instructionCount: number;
  /** Sum of approxTokens from inspect, when known. */
  approxTokens: number | null;
  /** Loading inspect. */
  loading: boolean;
  /** Relative loaded label. */
  loadedLabel: string | null;
  /** Refresh inspect. */
  onRefresh: () => void;
};

/**
 * Bottom evidence strip for the Rules & prompts page.
 * @param props Counts from environment inspect snapshot.
 */
export function PromptEvidenceBarView(props: PromptEvidenceBarViewProps) {
  const tokens = props.approxTokens ?? 0;
  const warn = tokens > 2000;
  return (
    <footer
      className={cs("prompt-evidence", {
        "prompt-evidence-warn": warn,
      })}
      data-testid="prompt-evidence-bar"
    >
      <span className="prompt-evidence-text">
        {props.loading
          ? "正在读取 grok inspect…"
          : `grok 已加载 ${props.instructionCount} 个规则文件${
              props.approxTokens != null
                ? ` · ~${props.approxTokens} tokens`
                : ""
            }`}
      </span>
      {props.loadedLabel ? (
        <span className="env-toolbar-meta">{props.loadedLabel}</span>
      ) : null}
      <button
        type="button"
        className="btn-ghost"
        onClick={props.onRefresh}
        disabled={props.loading}
      >
        刷新
      </button>
    </footer>
  );
}
