/**
 * Remember tool approvals with dangerous-pattern re-ask (F-PERM-09).
 */

const DANGEROUS =
  /\b(rm\s+-rf|git\s+push|git\s+reset\s+--hard|drop\s+table|mkfs|dd\s+if=)\b/i;

/**
 * Whether an always-allow memory may still require re-prompt for danger.
 * @param toolDetail Command / path detail.
 */
export function stillAskDespiteRemember(toolDetail: string): boolean {
  return DANGEROUS.test(toolDetail);
}

/**
 * Store key for a remembered approval.
 * @param toolName Tool id.
 * @param detail Optional pattern.
 */
export function approvalMemoryKey(toolName: string, detail = ""): string {
  return `approve:${toolName}:${detail}`.toLowerCase();
}
