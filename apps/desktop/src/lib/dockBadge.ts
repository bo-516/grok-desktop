/**
 * Dock / tab badge for needs-attention count (F-NATIVE-04).
 * Uses navigator.setAppBadge when available; always updates document.title prefix.
 */

/**
 * Format title with optional badge count.
 * @param baseTitle App title without badge.
 * @param count Pending attention count (permissions / queue).
 */
export function formatBadgedTitle(baseTitle: string, count: number): string {
  if (count <= 0) {
    return baseTitle;
  }
  return `(${count}) ${baseTitle}`;
}

/**
 * Apply badge to title and Badging API when present.
 * @param count Non-negative count.
 * @param baseTitle Document title base.
 */
export async function setAttentionBadge(
  count: number,
  baseTitle = "Grok Desktop",
): Promise<void> {
  if (typeof document !== "undefined") {
    document.title = formatBadgedTitle(baseTitle, count);
  }
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const badge = nav as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0 && typeof badge?.setAppBadge === "function") {
      await badge.setAppBadge(count);
    } else if (count <= 0 && typeof badge?.clearAppBadge === "function") {
      await badge.clearAppBadge();
    }
  } catch {
    /* unsupported / permission */
  }
}
