/**
 * Detect mermaid fenced blocks for optional rendering (F-STREAM-12).
 */

/**
 * Extract mermaid source blocks from markdown.
 * @param text Markdown body.
 */
export function extractMermaidBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```mermaid\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1]?.trim();
    if (body) {
      out.push(body);
    }
  }
  return out;
}

/**
 * Whether text contains a mermaid fence.
 */
export function hasMermaid(text: string): boolean {
  return extractMermaidBlocks(text).length > 0;
}
