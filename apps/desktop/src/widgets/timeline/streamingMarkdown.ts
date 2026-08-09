/**
 * Lightweight Markdown parsing for streaming agent text.
 * Tolerates unclosed code fences; outputs a safe node tree (React-rendered; no HTML injection).
 */

/** Inline node. */
export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

/** Block-level node. */
export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: "code_block"; lang: string; text: string; closed: boolean }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "blank" };

/**
 * Allow only http(s) links to block javascript: and similar protocols.
 * @param href Raw href.
 * @returns Safe URL or null.
 */
export function safeHttpUrl(href: string): string | null {
  const t = href.trim();
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  return null;
}

/**
 * Parse inline: code / link / strong / em / text.
 * @param input Single line or paragraph text.
 */
export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  const pushText = (text: string) => {
    if (!text) {
      return;
    }
    const last = nodes[nodes.length - 1];
    if (last?.type === "text") {
      last.text += text;
    } else {
      nodes.push({ type: "text", text });
    }
  };

  while (i < input.length) {
    // inline code
    if (input[i] === "`") {
      const end = input.indexOf("`", i + 1);
      if (end !== -1) {
        nodes.push({ type: "code", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // link [text](url)
    if (input[i] === "[") {
      const closeBracket = input.indexOf("]", i + 1);
      if (
        closeBracket !== -1 &&
        input[closeBracket + 1] === "(" &&
        input.indexOf(")", closeBracket + 2) !== -1
      ) {
        const closeParen = input.indexOf(")", closeBracket + 2);
        const label = input.slice(i + 1, closeBracket);
        const href = input.slice(closeBracket + 2, closeParen);
        const safe = safeHttpUrl(href);
        if (safe) {
          nodes.push({
            type: "link",
            href: safe,
            children: parseInline(label),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }
    // **strong**
    if (input.startsWith("**", i)) {
      const end = input.indexOf("**", i + 2);
      if (end !== -1) {
        nodes.push({
          type: "strong",
          children: parseInline(input.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    // *em*
    if (input[i] === "*" && input[i + 1] !== "*") {
      const end = input.indexOf("*", i + 1);
      if (end !== -1) {
        nodes.push({
          type: "em",
          children: parseInline(input.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }
    // plain char
    pushText(input[i] ?? "");
    i += 1;
  }
  return nodes;
}

/**
 * Parse full (or mid-stream) Markdown text into a block list.
 * @param source Accumulated agent text; closed=false when ``` is unclosed.
 */
export function parseStreamingMarkdown(source: string): BlockNode[] {
  const lines = source.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // code fence
    const fenceOpen = line.match(/^```([\w-]*)\s*$/);
    if (fenceOpen) {
      const lang = fenceOpen[1] ?? "";
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i] ?? "")) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({
        type: "code_block",
        lang,
        text: body.join("\n"),
        closed,
      });
      continue;
    }

    // blank
    if (/^\s*$/.test(line)) {
      blocks.push({ type: "blank" });
      i += 1;
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const marks = heading[1] ?? "#";
      const level = Math.min(marks.length, 4) as 1 | 2 | 3 | 4;
      blocks.push({
        type: "heading",
        level,
        children: parseInline(heading[2] ?? ""),
      });
      i += 1;
      continue;
    }

    // unordered list run
    if (/^\s*[-*]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        const itemText = (lines[i] ?? "").replace(/^\s*[-*]\s+/, "");
        items.push(parseInline(itemText));
        i += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // ordered list run
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        const itemText = (lines[i] ?? "").replace(/^\s*\d+\.\s+/, "");
        items.push(parseInline(itemText));
        i += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // paragraph: merge consecutive non-special lines
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        /^\s*$/.test(next) ||
        /^```/.test(next) ||
        /^#{1,4}\s+/.test(next) ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(para.join("\n")),
    });
  }

  return blocks;
}
