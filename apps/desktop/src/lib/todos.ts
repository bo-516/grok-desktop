/**
 * Todos panel helpers (F-CTX-06) — distinct from plan entries.
 * Todos may arrive as plan-like updates or dedicated sessionUpdate kinds.
 */

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | string;

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

/**
 * Normalize agent todo-like payloads into a stable list.
 * Accepts arrays of {content,status} or {title,status} or strings.
 * @param raw Unknown update payload.
 */
export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TodoItem[] = [];
  raw.forEach((item, i) => {
    if (typeof item === "string" && item.trim()) {
      out.push({ id: `todo-${i}`, content: item.trim(), status: "pending" });
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    const rec = item as Record<string, unknown>;
    const content = String(
      rec.content ?? rec.title ?? rec.text ?? rec.label ?? "",
    ).trim();
    if (!content) {
      return;
    }
    const status = String(rec.status ?? "pending") as TodoStatus;
    const id = String(rec.id ?? rec.todoId ?? `todo-${i}`);
    out.push({ id, content, status });
  });
  return out;
}

/**
 * Whether all todos are terminal (completed or cancelled).
 * @param todos Normalized list.
 */
export function todosAllDone(todos: TodoItem[]): boolean {
  if (todos.length === 0) {
    return false;
  }
  return todos.every(
    (t) => t.status === "completed" || t.status === "cancelled",
  );
}
