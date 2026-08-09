/**
 * Permission allow/deny rule evaluation (F-PERM-06).
 * Deny always wins over allow; evaluation order: deny > ask > allow.
 */

export type PermissionRuleEffect = "allow" | "deny" | "ask";

export type PermissionRule = {
  /** Pattern like Bash(git *), Read(src/**), MCPTool(server__*), WebFetch */
  pattern: string;
  effect: PermissionRuleEffect;
};

/**
 * Match a tool invocation against a rule pattern.
 * Supports simple prefix globs: `Bash(git *)`, `Read(src/**)`, exact tool names.
 * @param pattern Rule pattern.
 * @param toolName Tool name / kind from agent.
 * @param detail Optional command or path detail.
 */
export function matchPermissionRule(
  pattern: string,
  toolName: string,
  detail = "",
): boolean {
  const p = pattern.trim();
  if (!p) {
    return false;
  }
  // Form Tool(selector)
  const m = p.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
  if (!m) {
    return p === toolName || p === detail;
  }
  const familyRaw = m[1];
  const selectorRaw = m[2];
  if (familyRaw === undefined || selectorRaw === undefined) {
    return p === toolName || p === detail;
  }
  const family = familyRaw.toLowerCase();
  const selector = selectorRaw;
  const name = toolName.toLowerCase();
  const hay = `${toolName} ${detail}`.toLowerCase();

  if (family === "bash" || family === "execute") {
    if (name !== "bash" && name !== "execute" && name !== "shell") {
      // still allow matching against detail command line
    }
    return globMatch(selector.toLowerCase(), detail.toLowerCase() || hay);
  }
  if (family === "read") {
    return (
      (name === "read" || name.includes("read")) &&
      globMatch(selector, detail || toolName)
    );
  }
  if (family === "edit") {
    return (
      (name === "edit" || name.includes("edit") || name === "write") &&
      globMatch(selector, detail || toolName)
    );
  }
  if (family === "mcptool") {
    return globMatch(selector, toolName) || toolName.includes("__");
  }
  if (family === "webfetch" || family === "websearch") {
    return name.includes(family.replace("web", "web"));
  }
  if (family === "grep") {
    return name === "grep" || name === "search";
  }
  return globMatch(selector, detail || toolName);
}

/**
 * Minimal glob: `*` any chars, `**` path segments. Case-sensitive on input strings.
 * @param pattern Glob pattern.
 * @param value Candidate string.
 */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === "**") {
    return true;
  }
  // Escape regex specials except * 
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, ".*")
    .replace(/§§/g, ".*");
  const re = new RegExp(`^${escaped}$`, "i");
  return re.test(value);
}

/**
 * Evaluate rules: first matching deny wins; else first allow; else ask (default).
 * @param rules Ordered rules from config/SPAWN.
 * @param toolName Tool name.
 * @param detail Command/path detail.
 */
export function evaluatePermissionRules(
  rules: PermissionRule[],
  toolName: string,
  detail = "",
): PermissionRuleEffect {
  const matched = rules.filter((r) =>
    matchPermissionRule(r.pattern, toolName, detail),
  );
  if (matched.some((r) => r.effect === "deny")) {
    return "deny";
  }
  if (matched.some((r) => r.effect === "ask")) {
    return "ask";
  }
  if (matched.some((r) => r.effect === "allow")) {
    return "allow";
  }
  return "ask";
}

/**
 * Build SPAWN CLI args for allow/deny rules.
 * @param rules Rules to apply at process start.
 */
export function permissionRulesToSpawnArgs(rules: PermissionRule[]): string[] {
  const args: string[] = [];
  for (const r of rules) {
    if (r.effect === "allow") {
      args.push("--allow", r.pattern);
    } else if (r.effect === "deny") {
      args.push("--deny", r.pattern);
    }
  }
  return args;
}
