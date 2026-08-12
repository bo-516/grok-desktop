/**
 * Managed user-prompt markdown serialize / parse (pure, no I/O).
 * Files are owned by grok-desktop and loaded by grok-build as rules.
 *
 * Format (v1):
 *   <!-- grok-desktop:managed v1 -->
 *   <!-- Edited in the grok-desktop app. Manual edits are overwritten. -->
 *   - enabled text <!--@category-->
 *   <!-- grok-desktop:off @category disabled text -->
 */

/** Which layer a prompt entry lives in; also selects the on-disk file. */
export type PromptScope = "global" | "project" | "projectLocal";

/** Optional bucket used only to render override badges across scopes. */
export type PromptCategory =
  | "language"
  | "name"
  | "style"
  | "workflow"
  | "custom";

/** One user-authored instruction line (id is client-only; not persisted). */
export type PromptEntry = {
  /** Client-side identity for list keys / drag; NOT written to disk. */
  id: string;
  /** Single-line instruction text, already normalized. */
  text: string;
  /** false keeps the entry in-file as a comment (out of model active lines). */
  enabled: boolean;
  /** Optional UI category for override badges. */
  category?: PromptCategory;
};

/** First line of every managed file — ownership gate for set/clear. */
export const MANAGED_MARKER = "<!-- grok-desktop:managed v1 -->";

/** Fixed second line shown to humans who open the file by hand. */
export const MANAGED_BANNER =
  "<!-- Edited in the grok-desktop app. Manual edits are overwritten. -->";

/** Categories accepted in `<!--@…-->` markers. */
const CATEGORIES: ReadonlySet<string> = new Set([
  "language",
  "name",
  "style",
  "workflow",
  "custom",
]);

/** Max characters per entry after normalization. */
export const ENTRY_TEXT_MAX = 2000;

/**
 * Normalize + validate one entry text (trim, collapse whitespace, strip controls).
 * @param raw User or client-supplied text.
 * @returns `{ ok:true, text }` or `{ ok:false, reason }` — callers must not write on !ok.
 */
export function normalizeEntryText(
  raw: string,
): { ok: true; text: string } | { ok: false; reason: string } {
  let text = String(raw ?? "");
  // Collapse newlines / CR / tabs to a single space, then strip other controls.
  text = text.replace(/[\r\n\t]+/g, " ");
  // Strip remaining ASCII control chars (null..unit separator) without a control-regex.
  text = [...text].filter((ch) => ch.charCodeAt(0) >= 0x20).join("");
  text = text.trim().replace(/ {2,}/g, " ");
  if (!text) {
    return { ok: false, reason: "entry text is empty" };
  }
  if (text.includes("-->")) {
    return { ok: false, reason: 'entry text must not contain "-->"' };
  }
  if (text.length > ENTRY_TEXT_MAX) {
    return {
      ok: false,
      reason: `entry text exceeds ${ENTRY_TEXT_MAX} characters`,
    };
  }
  return { ok: true, text };
}

/**
 * Serialize entries to managed markdown, or null when empty (caller must unlink).
 * Empty list returns null so clear does not leave a zero-byte rules file that
 * grok would still load (inspect lists sizeBytes:0 files).
 * @param entries Ordered entries; empty / all-removed → null.
 * @returns Full file body ending with a trailing newline, or null.
 */
export function serializePrompts(entries: PromptEntry[]): string | null {
  if (!entries.length) {
    return null;
  }
  const lines: string[] = [MANAGED_MARKER, MANAGED_BANNER, ""];
  for (const e of entries) {
    const text = e.text;
    const cat = e.category && CATEGORIES.has(e.category) ? e.category : undefined;
    if (e.enabled) {
      if (cat) {
        lines.push(`- ${text} <!--@${cat}-->`);
      } else {
        lines.push(`- ${text}`);
      }
    } else if (cat) {
      lines.push(`<!-- grok-desktop:off @${cat} ${text} -->`);
    } else {
      lines.push(`<!-- grok-desktop:off ${text} -->`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Result of parsePrompts. */
export type ParsePromptsResult = {
  /** true when file exists but lacks the managed marker (do not overwrite). */
  foreign: boolean;
  /** Parsed entries; empty when foreign or file has no recognized lines. */
  entries: PromptEntry[];
};

/**
 * Parse managed markdown into structured entries.
 * Unknown / malformed lines are ignored (tolerant of hand edits).
 * Missing managed marker → foreign:true and entries:[].
 * @param content File body (any line endings).
 * @param idFactory Optional id generator (defaults to sequential `e0`, `e1`, …).
 */
export function parsePrompts(
  content: string,
  idFactory?: () => string,
): ParsePromptsResult {
  const raw = String(content ?? "");
  const lines = raw.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  if (first !== MANAGED_MARKER) {
    return { foreign: true, entries: [] };
  }

  let nextId = 0;
  const makeId =
    idFactory ??
    (() => {
      const id = `e${nextId}`;
      nextId += 1;
      return id;
    });

  const entries: PromptEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Banner / other HTML comments that are not off-entries.
    if (trimmed === MANAGED_BANNER) {
      continue;
    }

    const off = parseOffLine(trimmed);
    if (off) {
      entries.push({
        id: makeId(),
        text: off.text,
        enabled: false,
        ...(off.category ? { category: off.category } : {}),
      });
      continue;
    }

    const on = parseEnabledLine(trimmed);
    if (on) {
      entries.push({
        id: makeId(),
        text: on.text,
        enabled: true,
        ...(on.category ? { category: on.category } : {}),
      });
    }
    // Unknown lines: ignore (tolerance).
  }
  return { foreign: false, entries };
}

/**
 * Parse `- text` or `- text <!--@cat-->`.
 * @param trimmed Non-empty trimmed line.
 */
function parseEnabledLine(
  trimmed: string,
): { text: string; category?: PromptCategory } | null {
  if (!trimmed.startsWith("- ")) {
    return null;
  }
  const body = trimmed.slice(2).trimEnd();
  // Optional trailing category marker.
  const catMatch = body.match(/^(.*?)\s*<!--@([a-zA-Z0-9_]+)-->\s*$/);
  if (catMatch) {
    const text = (catMatch[1] ?? "").trim();
    const cat = catMatch[2] ?? "";
    if (!text || text.includes("-->")) {
      return null;
    }
    if (CATEGORIES.has(cat)) {
      return { text, category: cat as PromptCategory };
    }
    return { text };
  }
  const text = body.trim();
  if (!text || text.includes("-->")) {
    return null;
  }
  return { text };
}

/**
 * Parse `<!-- grok-desktop:off text -->` or `<!-- grok-desktop:off @cat text -->`.
 * @param trimmed Non-empty trimmed line.
 */
function parseOffLine(
  trimmed: string,
): { text: string; category?: PromptCategory } | null {
  const m = trimmed.match(
    /^<!--\s*grok-desktop:off\s+(.+?)\s*-->$/,
  );
  if (!m) {
    return null;
  }
  const rest = (m[1] ?? "").trim();
  if (!rest) {
    return null;
  }
  const catMatch = rest.match(/^@([a-zA-Z0-9_]+)\s+(.+)$/);
  if (catMatch) {
    const cat = catMatch[1] ?? "";
    const text = (catMatch[2] ?? "").trim();
    if (!text || text.includes("-->")) {
      return null;
    }
    if (CATEGORIES.has(cat)) {
      return { text, category: cat as PromptCategory };
    }
    return { text };
  }
  if (rest.includes("-->")) {
    return null;
  }
  return { text: rest };
}
