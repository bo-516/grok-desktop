/**
 * Class-name composer for the shadcn primitives in `src/components/ui`.
 *
 * Purpose: a primitive merges its default classes with the caller's
 * `className`; `cn` lets the caller's conflicting utility win (a `px-4`
 * override replaces the default `px-2`) instead of leaving the outcome to
 * CSS source order.
 *
 * Boundary: business code keeps composing conditional classes with
 * `classnames` (object form, AGENTS.md). `cn` is for the ui primitives and
 * for callers overriding a primitive's defaults.
 *
 * UnoCSS vs tailwind-merge: tailwind-merge only knows Tailwind's class
 * vocabulary and files every unknown `text-*` value under *text color*.
 * This app also has UnoCSS-only font sizes, so plain tailwind-merge would
 * turn `cn("text-12px text-fg")` into `"text-fg"` and silently drop the
 * size. The merger below files those sizes under font-size instead.
 */

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Named font sizes from `theme.fontSize` in uno.config.ts (`text-nav`,
 * `text-body-sm`, …). Add a key here when one is added there; a missing key
 * is treated as a text color and merged away next to one.
 */
const UNO_FONT_SIZE_KEYS: string[] = [
  "body-sm",
  "body-md",
  "nav",
  "mono",
  "headline",
  "doc-body",
  "doc-h1",
  "doc-h2",
  "doc-h3",
  "doc-code",
];

/**
 * Whether a `text-*` value is the UnoCSS `text-<n>px` font-size rule
 * (`/^text-(\d+)px$/` in uno.config.ts).
 * @param value Part after `text-` (e.g. `12px`, `fg`).
 * @returns True for whole-pixel sizes only, matching that rule; anything
 *   else falls through to tailwind-merge's own groups.
 */
function isUnoPxFontSize(value: string): boolean {
  return /^\d+px$/.test(value);
}

/**
 * tailwind-merge with the UnoCSS-only font sizes filed under font-size,
 * so they conflict with other sizes and never with text colors.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [isUnoPxFontSize, ...UNO_FONT_SIZE_KEYS] }],
    },
  },
});

/**
 * Join class values (clsx) and resolve utility conflicts, last one wins.
 * @param inputs Strings, arrays, or `{ class: boolean }` maps; falsy
 *   entries are skipped.
 * @returns One space-separated class string (empty when nothing applies).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
