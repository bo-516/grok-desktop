/**
 * Stateful shim between the preview drawer and the stateless file body: owns
 * the async tokenize for one previewed file and nothing else.
 * Exists so PreviewCodeView stays a pure render of (text, tokens) and the
 * drawer stays free of highlight lifecycle.
 */

import { useMemo } from "react";
import { languageForPath } from "@/lib/codeHighlightLanguages";
import { useCodeHighlight } from "@/widgets/shared";
import { PreviewCodeView } from "./PreviewCodeView";

export type PreviewCodeWidgetProps = {
  /** Absolute file path; its extension selects the grammar. */
  path: string;
  /** File text as read by the bridge (already truncated at 1MB upstream). */
  content: string;
  /** When true, the view shows the truncation banner. */
  truncated?: boolean;
  /** Optional 1-based line to emphasize after open. */
  focusLine?: number;
};

/**
 * Highlight one file and hand the tokens to the stateless body.
 * @param props Path (grammar source), content, and view chrome flags.
 */
export function PreviewCodeWidget(props: PreviewCodeWidgetProps) {
  const language = useMemo(() => languageForPath(props.path), [props.path]);
  const lines = useCodeHighlight(props.content, language);
  return (
    <PreviewCodeView
      content={props.content}
      truncated={props.truncated}
      focusLine={props.focusLine}
      lines={lines ?? undefined}
    />
  );
}
