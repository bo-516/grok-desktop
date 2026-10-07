/**
 * Shared chrome for the shadcn menu primitives (`context-menu.tsx`,
 * `dropdown-menu.tsx`), bridged from shadcn's stone defaults to app tokens.
 *
 * Purpose: both primitives render the same surface and rows, so every menu
 * in the app reads as one family — the shell radius, elevated fill, and
 * popover shadow of the top-nav ⋯ list, with compact 30px rows next to the
 * 36px rail rows. Each primitive adds only its own Radix CSS variables
 * (transform origin, available height).
 *
 * Sizes are px on purpose: the html root font size is 13px, so rem
 * utilities (`h-8`, `size-4`, `pl-8`) render smaller than their Tailwind
 * names suggest.
 *
 * Focus: Radix moves DOM focus onto the highlighted row and marks it with
 * `data-highlighted`; that fill is the focus indicator. base.css draws a
 * global `:where(…[role=menuitem]):focus-visible` outline, and a plain
 * `outline-none` ties with it on specificity and loses on source order, so
 * rows also carry `focus-visible:outline-none`.
 *
 * Class strings stay whole literals so UnoCSS can extract them from this
 * file (`.ts` modules under src/ are in the Uno content pipeline).
 */

/**
 * Floating panel for menu content and sub-content. z-105 clears the
 * off-canvas rail (z-100) and its backdrop, and stays under modals (z-110).
 * Open / close motion comes from unocss-preset-animations (the
 * tailwindcss-animate API shadcn ships with); base.css shortens it to
 * ~0 under reduced motion, which still lets Radix finish the exit.
 */
export const MENU_SURFACE_CLASS =
  "z-105 min-w-[184px] max-w-[min(90vw,280px)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-shell border border-line-subtle bg-elevated p-1 text-fg shadow-popover outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

/**
 * One 30px row: the base of items, sub-triggers, and checkbox / radio rows.
 * Glyphs are 14px muted icons. `data-[inset]` indents a plain row so its
 * label lines up with checkbox / radio labels.
 */
export const MENU_ROW_CLASS =
  "relative flex w-full shrink-0 items-center gap-2.5 h-[30px] px-2 rounded-7px text-12px leading-none text-fg cursor-pointer select-none outline-none transition-colors duration-fast ease-soft focus-visible:outline-none data-[highlighted]:bg-white-faint data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-[30px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-[14px] [&_svg]:text-fg-muted";

/**
 * Danger ink for `variant="destructive"` rows (Delete, Remove): label and
 * glyph in danger, highlight in the muted danger fill — the same treatment
 * as the top-nav menu's danger rows. Inert on default rows.
 * The glyph rule spells its selector out (`[&[data-variant=…]_svg]`): the
 * stacked `data-[variant=…]:[&_svg]:` form compiles to
 * `.row svg[data-variant=…]`, which puts the attribute on the svg and
 * never matches.
 */
export const MENU_ROW_DESTRUCTIVE_CLASS =
  "data-[variant=destructive]:text-danger data-[variant=destructive]:data-[highlighted]:bg-danger-muted [&[data-variant=destructive]_svg]:text-danger";

/** Checkbox / radio rows: left gutter for the indicator glyph. */
export const MENU_CHECK_ROW_CLASS = "pl-[30px] pr-2";

/** Indicator slot (check mark / dot) inside the checkbox / radio gutter. */
export const MENU_INDICATOR_CLASS =
  "pointer-events-none absolute left-[8px] flex size-[14px] items-center justify-center";

/** An open sub-menu keeps its trigger row filled. */
export const MENU_SUB_TRIGGER_OPEN_CLASS = "data-[state=open]:bg-white-faint";

/** Non-interactive section heading inside a menu. */
export const MENU_LABEL_CLASS =
  "px-2 py-[6px] text-11px font-medium text-fg-muted data-[inset]:pl-[30px]";

/** Hairline between row groups. */
export const MENU_SEPARATOR_CLASS = "mx-1.5 my-1 h-px shrink-0 bg-line-subtle";

/** Trailing keyboard hint inside a row (⌘N, ⌫). */
export const MENU_SHORTCUT_CLASS =
  "ml-auto shrink-0 pl-3 text-11px text-fg-muted font-mono";
