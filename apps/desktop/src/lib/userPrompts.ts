/**
 * Pure helpers for structured user-prompt entries (no I/O, no store).
 * Desktop never serializes markdown — bridge owns the on-disk format.
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

/** One user-authored instruction line. */
export type PromptEntry = {
  /** Client-side identity for list keys / drag; NOT persisted to disk. */
  id: string;
  /** Single-line instruction text, already normalized. */
  text: string;
  /** false keeps the entry in-file as a comment (out of active model lines). */
  enabled: boolean;
  /** Optional; omitted when the user did not pick one. */
  category?: PromptCategory;
};

/** Max characters per entry after normalization (matches bridge). */
export const ENTRY_TEXT_MAX = 2000;

let idSeq = 0;

/**
 * Allocate a unique client-side entry id.
 * @returns New id string (not stable across reloads).
 */
export function newEntryId(): string {
  idSeq += 1;
  return `pe-${Date.now().toString(36)}-${idSeq}`;
}

/**
 * Normalize + validate one text (trim, collapse whitespace, strip controls).
 * @param raw User or client-supplied text.
 * @returns `{ ok:true, text }` or `{ ok:false, reason }` — callers must not write on !ok.
 */
export function normalizeEntryText(
  raw: string,
): { ok: true; text: string } | { ok: false; reason: string } {
  let text = String(raw ?? "");
  text = text.replace(/[\r\n\t]+/g, " ");
  // Strip remaining ASCII control chars without a control-regex (eslint).
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
 * Append one entry to a scope's list; returns a new array.
 * @param entries Current list.
 * @param text Raw text (normalized inside).
 * @param category Optional category.
 * @throws When text fails validation.
 */
export function addEntry(
  entries: PromptEntry[],
  text: string,
  category?: PromptCategory,
): PromptEntry[] {
  const n = normalizeEntryText(text);
  if (!n.ok) {
    throw new Error(n.reason);
  }
  const next: PromptEntry = {
    id: newEntryId(),
    text: n.text,
    enabled: true,
    ...(category ? { category } : {}),
  };
  return [...entries, next];
}

/**
 * Replace text/category/enabled of one entry by id; order preserved.
 * Unknown id is a no-op (returns same array reference when nothing matches).
 * Pass `category: undefined` explicitly via a symbol-free approach: use
 * `clearCategory: true` is not supported — omit category key to keep, or set
 * a value to change. Callers that need to clear category rebuild the entry.
 * @param entries Current list.
 * @param id Target entry id.
 * @param patch Fields to merge (id is ignored).
 */
export function updateEntry(
  entries: PromptEntry[],
  id: string,
  patch: Partial<Omit<PromptEntry, "id">>,
): PromptEntry[] {
  let found = false;
  const next = entries.map((e) => {
    if (e.id !== id) {
      return e;
    }
    found = true;
    const text =
      patch.text !== undefined
        ? (() => {
            const n = normalizeEntryText(patch.text);
            if (!n.ok) {
              throw new Error(n.reason);
            }
            return n.text;
          })()
        : e.text;
    const updated: PromptEntry = {
      id: e.id,
      text,
      enabled: patch.enabled !== undefined ? patch.enabled : e.enabled,
    };
    if (Object.prototype.hasOwnProperty.call(patch, "category")) {
      if (patch.category) {
        updated.category = patch.category;
      }
      // explicit clear when patch.category is undefined
    } else if (e.category) {
      updated.category = e.category;
    }
    return updated;
  });
  return found ? next : entries;
}

/**
 * Drop one entry by id; unknown id is a no-op.
 * @param entries Current list.
 * @param id Target id.
 */
export function removeEntry(
  entries: PromptEntry[],
  id: string,
): PromptEntry[] {
  const next = entries.filter((e) => e.id !== id);
  return next.length === entries.length ? entries : next;
}

/**
 * Reorder within one scope (drag). Out-of-range indices are clamped.
 * @param entries Current list.
 * @param fromIndex Source index.
 * @param toIndex Destination index.
 */
export function reorderEntries(
  entries: PromptEntry[],
  fromIndex: number,
  toIndex: number,
): PromptEntry[] {
  if (entries.length === 0) {
    return entries;
  }
  const from = Math.max(0, Math.min(entries.length - 1, fromIndex));
  const to = Math.max(0, Math.min(entries.length - 1, toIndex));
  if (from === to) {
    return entries;
  }
  const next = entries.slice();
  const [item] = next.splice(from, 1);
  if (!item) {
    return entries;
  }
  next.splice(to, 0, item);
  return next;
}

/**
 * Which entries are shadowed by a later scope (same non-empty category).
 * Free text (no category) is never marked — order alone expresses overlay.
 * Same-layer category duplicates are not overrides (only cross-scope).
 * @param layers Ordered global → project → projectLocal.
 * @returns Set of entry ids that a later layer overrides.
 */
export function overriddenEntryIds(layers: PromptEntry[][]): Set<string> {
  const overridden = new Set<string>();
  const categories = new Set<string>();
  for (const layer of layers) {
    for (const e of layer) {
      if (e.category) {
        categories.add(e.category);
      }
    }
  }
  for (const cat of categories) {
    let lastLayer = -1;
    for (let i = 0; i < layers.length; i++) {
      if ((layers[i] ?? []).some((e) => e.category === cat)) {
        lastLayer = i;
      }
    }
    if (lastLayer < 0) {
      continue;
    }
    for (let i = 0; i < lastLayer; i++) {
      for (const e of layers[i] ?? []) {
        if (e.category === cat) {
          overridden.add(e.id);
        }
      }
    }
  }
  return overridden;
}

/** Scope display metadata for section headers. */
export const SCOPE_META: Record<
  PromptScope,
  { title: string; emptyHint: string; icon: "lock" | "users" | "user" }
> = {
  global: {
    title: "全局 · 所有项目",
    emptyHint: "对所有项目生效，包括终端里的 grok",
    icon: "lock",
  },
  project: {
    title: "本项目 · 团队共享",
    emptyHint: "提交进 git，团队成员都会吃到",
    icon: "users",
  },
  projectLocal: {
    title: "本项目 · 仅我",
    emptyHint: "只在这个项目对我生效，不进 git",
    icon: "user",
  },
};
