/**
 * Stateless file body for the preview drawer: line numbers + monospace text.
 * Virtualization is deferred (S2); large files are already truncated on bridge.
 */

export type PreviewCodeViewProps = {
  /** File text to display (may already be truncated). */
  content: string;
  /** Optional 1-based line to emphasize after open. */
  focusLine?: number;
  /** When true, show a truncation banner above the body. */
  truncated?: boolean;
};

/**
 * Split content into display lines without inventing a trailing empty row.
 * @param text Source text.
 */
function splitDisplayLines(text: string): string[] {
  if (text === "") {
    return [""];
  }
  if (text.endsWith("\n")) {
    return text.slice(0, -1).split("\n");
  }
  return text.split("\n");
}

/**
 * Read-only code view with a single gutter of line numbers.
 * @param props Content + optional focus line / truncated flag.
 */
export function PreviewCodeView(props: PreviewCodeViewProps) {
  const lines = splitDisplayLines(props.content);
  return (
    <div className="preview-code" data-kind="preview-code">
      {props.truncated ? (
        <div className="preview-banner" role="status">
          File truncated for preview (first 1MB shown).
        </div>
      ) : null}
      <div className="preview-code-scroll">
        <table className="preview-code-table">
          <tbody>
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const focused = props.focusLine === lineNo;
              return (
                <tr
                  key={`L${lineNo}`}
                  className={
                    focused ? "preview-code-row preview-code-row-focus" : "preview-code-row"
                  }
                  data-line={lineNo}
                >
                  <td className="preview-gutter">{lineNo}</td>
                  <td className="preview-code-text">{line}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
