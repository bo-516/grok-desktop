/**
 * Composer dock / input / suggestions / mode / send UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const composerShortcuts: Record<string, string> = {
    /* ── Composer ── */
    /* In-flow footer (not absolute): height is natural; timeline scrolls above.
     * shrink-0 keeps the dock from collapsing when the timeline is long.
     * min-w-0 stops nowrap chips from widening the main column (that was
     * the middle-column horizontal scrollbar next to a file preview). */
    "composer-dock":
      "shrink-0 relative z-20 min-w-0 px-container pt-2 pb-5 bg-timeline pointer-events-none",
    "composer-dock-inner": "w-full min-w-0 pointer-events-auto",
    /*
     * Card chrome: idle and focused look the same (no focus border tint).
     * Field listening / dragover stay on .composer-input-wrap for mode feedback.
     */
    composer:
      "relative flex flex-col gap-2.5 min-w-0 max-w-full px-3.5 pt-3.5 pb-2.75 rounded-dock border border-transparent bg-composer shadow-composer transition-[box-shadow,background-color] duration-normal ease-soft",
    /*
     * Mid-turn follow-up panel (Codex / Claude): sibling ABOVE `.composer`,
     * never inside the input card. `mx-1.5` + dedicated queue fill/border
     * keep the chips from reading as a second input. Pair the row with a
     * literal `group` so Send now / Edit / Cancel reveal on hover / keyboard
     * focus; width stays reserved so the ellipsis does not jump.
     */
    "composer-queue":
      "flex flex-col gap-1.5 m-0 mb-2 mx-1.5 p-0 list-none",
    "composer-queue-row":
      "flex items-center gap-2 min-w-0 px-2.5 py-1.75 rounded-10px border border-line-queue bg-composer-queue",
    /* 1-based enqueue order (1 drains next). Decorative — row aria-label speaks it. */
    "composer-queue-index":
      "shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-pill bg-composer-queue-index text-fg-secondary text-11px font-medium tabular-nums leading-none",
    "composer-queue-text":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-13px leading-5 text-fg",
    /* Hover-reveal send/remove; snap visible, no opacity transition. */
    "composer-queue-actions":
      "flex items-center gap-0.5 shrink-0 opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto)",
    "composer-queue-icon":
      "flex items-center justify-center w-7 h-7 p-0 m-0 border-none rounded-7px bg-transparent text-fg-secondary cursor-pointer transition-colors duration-fast ease-soft hover:(bg-white-faint text-fg) focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)])",
    "composer-queue-icon-svg": "w-3.5 h-3.5",
    /*
     * Sole field chrome owner: 1px border + shared metrics; data-state / focus-within
     * change color only. Idle + focus borders are transparent (no nested line box);
     * listening / dragover still tint. Height derives from the textarea.
     * overflow-hidden clips radius only — textarea owns min-h / max-h / field-sizing.
     */
    /* Drop target + attachment strip + field; keeps drag handlers above the wrap. */
    "composer-input-stack": "flex w-full flex-col gap-0 min-w-0",
    "composer-input-wrap":
      "relative w-full overflow-hidden rounded-soft border border-field bg-transparent transition-[border-color,background-color,opacity] duration-fast ease-soft data-[state=idle]:focus-within:border-field-focus data-[state=listening]:border-field-listening data-[state=dragover]:(border-field-dragover bg-field-dragover-bg) data-[state=disabled]:opacity-55",
    "composer-input-highlight":
      "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pt-0.5 px-0.5 text-body-md leading-relaxed tracking-tight text-fg",
    /* Sole height clamp + auto-grow; padding must match .composer-input-highlight. */
    "composer-input":
      "relative z-1 w-full min-h-11 max-h-40 resize-none border-none bg-transparent pt-0.5 px-0.5 text-body-md leading-relaxed tracking-tight text-transparent caret-fg placeholder:text-fg-muted focus-visible:outline-none [field-sizing:content]",
    /* Mention chip chrome is only in base.css — dynamic class names + must not
     * change glyph metrics (font-weight/padding) or the caret misaligns. */
    /*
     * Slash / @ menu (bottom-anchored above the field):
     * - height tracks match count (content-sized); max-h-80 + overflow-y for long lists
     * - each row is shrink-0 so a flex-col + overflow-y parent never compresses
     *   items (min-h-0 + default shrink caused text to paint over neighbors)
     * - overflow-anchor-none stops scroll anchoring from shifting rows when the
     *   filtered list mutates mid-keystroke
     * - scrollbar-gutter-stable keeps label ellipsis width fixed when the thumb
     *   appears (otherwise text reflows horizontally and looks like jitter)
     */
    "composer-suggestions":
      "absolute right-0 bottom-[calc(100%+8px)] left-0 flex max-h-80 flex-col overflow-x-hidden overflow-y-auto overflow-anchor-none scrollbar-gutter-stable border border-line-suggestion rounded-card bg-composer-suggestion shadow-composer-suggestions animate-overlay-in py-1",
    /* Inner stack; shrink-0 so flex never crushes rows when the shell scrolls. */
    "composer-suggestions-content": "flex w-full shrink-0 flex-col",
    "composer-suggestion":
      "block w-full shrink-0 overflow-hidden border-none border-b border-line-subtle bg-transparent px-3 py-2.5 m-0 text-left text-fg transition-colors duration-fast ease-soft hover:bg-composer-suggestion-hover last:border-b-0",
    "composer-suggestion-active": "bg-composer-suggestion-hover",
    "composer-suggestion-main":
      "flex w-full min-w-0 flex-col gap-0.5",
    "composer-suggestion-title-row":
      "flex w-full min-w-0 items-center gap-1.75",
    /* Kind glyph from the shared MentionIconView; never shrinks so long paths
     * truncate in the label instead of squashing the icon. */
    "composer-suggestion-icon": "shrink-0 w-3.5 h-3.5",
    "composer-suggestion-label":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-medium tracking-tight leading-5",
    "composer-suggestion-detail":
      "block w-full m-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-suggestion-detail text-11px leading-4",
    /* ACP input.hint on its own line — never concatenated into description. */
    "composer-suggestion-hint":
      "block w-full m-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-10px leading-4 text-fg-muted",
    "composer-suggestion-kind":
      "shrink-0 rounded-pill px-2 py-0.5 text-10px font-medium leading-none",
    "composer-suggestion-kind-file":
      "text-mention-file bg-mention-file-bg",
    "composer-suggestion-kind-directory":
      "text-mention-dir bg-mention-dir-bg",
    "composer-suggestion-kind-command":
      "text-mention-command bg-mention-command-bg",
    "composer-suggestion-kind-skill":
      "text-mention-skill bg-mention-skill-bg",
    /* Secondary badge: gitignored path — muted so kind badge stays primary. */
    "composer-suggestion-kind-gitignored":
      "text-fg-muted bg-white-faint",
    /* Fixed one-line min height so loading ↔ empty copy swaps do not reflow the panel. */
    "composer-suggestions-empty":
      "m-0 p-3 min-h-10 text-fg-suggestion-detail text-body-sm leading-5",
    /*
     * Two-level wrap. Groups are shrink-0 (not min-w-0): shrinking the
     * cluster lets nowrap chips overflow and paint over Mic / Weekly.
     * When left+right no longer fit, `ml-auto` drops the right cluster
     * onto its own row and keeps Send on the trailing edge. max-w-full
     * lets one over-wide cluster wrap its own chips.
     */
    "composer-bar":
      "flex items-center gap-x-2 gap-y-1 m-0 w-full min-w-0 flex-wrap",
    "composer-bar-left":
      "flex items-center gap-1.5 shrink-0 max-w-full flex-wrap",
    "composer-bar-right":
      "relative ml-auto flex items-center gap-1.5 shrink-0 max-w-full flex-wrap",
    /*
     * Project switcher on the composer bar (session cwd context). Chip-sized
     * trigger; menu opens upward so it does not cover the textarea.
     * Locked when the open session has user/agent messages.
     */
    "project-switcher": "relative shrink-0 max-w-40",
    "project-switcher-trigger":
      "flex items-center gap-1.25 h-7.5 max-w-full pl-2 pr-1.5 border-none rounded-8px bg-white-faint text-fg-secondary text-12px font-normal text-left transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
    "project-switcher-trigger-open": "bg-white-soft text-fg",
    "project-switcher-trigger-locked": "opacity-90",
    "project-switcher-trigger-icon": "w-3.5 h-3.5 shrink-0 text-fg-muted",
    "project-switcher-trigger-label":
      "min-w-0 max-w-28 whitespace-nowrap overflow-hidden text-ellipsis text-fg",
    "project-switcher-trigger-chevron": "w-3 h-3 shrink-0 text-fg-faint opacity-70",
    "project-switcher-menu":
      "absolute left-0 bottom-[calc(100%+8px)] z-40 flex flex-col w-64 max-h-72 rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 animate-modal-in",
    "project-switcher-search-wrap":
      "flex items-center gap-1.5 w-full h-8 px-2 mb-1 rounded-7px bg-white-faint",
    "project-switcher-search-icon":
      "shrink-0 text-fg-muted text-12px leading-none opacity-75",
    "project-switcher-search":
      "flex-1 min-w-0 h-full border-none bg-transparent text-fg text-12px p-0 placeholder:text-fg-muted focus-visible:outline-none",
    "project-switcher-list":
      "flex flex-col gap-px min-h-0 overflow-y-auto max-h-40 py-0.5",
    "project-switcher-empty":
      "px-2.5 py-2 text-11px text-fg-muted leading-snug",
    "project-switcher-item":
      "flex items-center gap-2 w-full min-h-8 px-2 rounded-7px border-none bg-transparent text-fg-secondary text-12px text-left cursor-pointer transition-colors duration-fast ease-soft hover:enabled:(text-fg bg-white-faint) disabled:(opacity-45 cursor-not-allowed)",
    "project-switcher-item-active": "text-fg bg-white-soft",
    "project-switcher-item-locked": "opacity-45 cursor-not-allowed",
    "project-switcher-item-icon": "w-3.5 h-3.5 shrink-0 text-fg-muted",
    "project-switcher-item-label":
      "flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis",
    "project-switcher-item-check": "w-3.5 h-3.5 shrink-0 text-fg",
    "project-switcher-footer":
      "flex flex-col gap-px pt-1 mt-1 border-t border-line-subtle",
    /* Create project dialog (Codex-style name + source folder). */
    "create-project-dialog":
      "w-[min(400px,92vw)] bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal p-5 animate-modal-in flex flex-col gap-4",
    "create-project-dialog-head":
      "flex items-center justify-between gap-3",
    "create-project-dialog-close":
      "shrink-0 flex items-center justify-center w-7 h-7 p-0 m-0 border-none rounded-7px bg-transparent text-fg-muted cursor-pointer hover:(text-fg bg-white-soft) focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)])",
    "create-project-field": "flex flex-col gap-1.5",
    "create-project-field-label":
      "text-11px text-fg-muted font-medium tracking-wide",
    "create-project-name-row":
      "flex items-center gap-2 h-10 px-2.5 rounded-9px border border-field bg-transparent transition-colors duration-fast ease-soft focus-within:border-field-focus",
    "create-project-name-icon": "w-4 h-4 shrink-0 text-fg-muted",
    "create-project-name-input":
      "flex-1 min-w-0 h-full border-none bg-transparent text-fg text-13px p-0 placeholder:text-fg-muted focus-visible:outline-none",
    "create-project-folder-block": "flex flex-col gap-1.5",
    "create-project-folder-zone":
      "flex flex-col items-center justify-center gap-2 min-h-28 px-4 py-4 rounded-12px border border-dashed border-line-muted bg-white-faint text-center cursor-text transition-colors duration-fast ease-soft hover:border-line-strong focus-within:(border-field-focus bg-white-soft)",
    "create-project-folder-icon": "w-6 h-6 text-fg-faint",
    "create-project-folder-hint": "text-12px text-fg-muted leading-snug",
    "create-project-folder-input":
      "w-full max-w-full border-none bg-transparent text-center text-12px text-fg p-0 placeholder:text-fg-faint focus-visible:outline-none",
    "composer-icon-btn":
      "flex items-center justify-center w-7.5 h-7.5 border-none rounded-8px bg-transparent text-fg-secondary text-15px transition-colors duration-fast ease-soft hover:enabled:(bg-white-faint text-fg) disabled:(opacity-45 cursor-not-allowed)",
    /* Codex-style + attach chip on the left of the composer bar. */
    "composer-attach-btn": "shrink-0",
    "composer-attach-icon": "w-4 h-4",
    /*
     * Layout-inert file input (imperative openFilePicker / showPicker).
     * Must not use the classic sr-only 1px+clip pattern: focusing that node
     * scrolls it into view inside the flex column and jitters composer height.
     * fixed + zero box keeps .click()/showPicker working without reflow.
     */
    "composer-attach-input":
      "pointer-events-none fixed top-0 left-0 z-0 h-0 w-0 max-h-0 max-w-0 m-0 p-0 opacity-0 overflow-hidden border-0 appearance-none focus:outline-none focus-visible:outline-none",
    /*
     * Pending image strip (above the textarea): horizontal thumbnails with a
     * corner remove control, matching Codex attach previews.
     */
    "composer-attachments":
      "flex flex-wrap items-start gap-2 m-0 mb-1.5 p-0 list-none",
    /* Pair with literal `group` on the <li> — UnoCSS rejects `group` inside shortcuts.
     * Locked 56×56 (min=max) so a large paste cannot inflate the strip and
     * reflow the composer card while the thumb decodes. */
    "composer-attachment":
      "relative shrink-0 w-14 h-14 min-w-14 min-h-14 max-w-14 max-h-14 rounded-10px overflow-hidden border border-line-subtle bg-white-faint",
    /* Full-tile hit target: open lightbox (previewable) or system viewer. */
    "composer-attachment-open":
      "relative block w-full h-full min-w-0 min-h-0 p-0 m-0 border-0 bg-transparent cursor-pointer text-inherit overflow-hidden",
    /* Out of flow so intrinsic screenshot size never contributes min-content. */
    "composer-attachment-thumb":
      "absolute inset-0 block w-full h-full max-w-full max-h-full object-cover pointer-events-none",
    "composer-attachment-fallback":
      "flex items-center justify-center w-full h-full px-1 text-10px text-fg-muted text-center leading-tight break-all",
    /*
     * Remove control stays hidden until the thumb is hovered (or focus lands
     * inside the tile / on the button) so the preview is not cluttered at rest.
     * Snaps visible — no opacity transition. z-1 keeps the control above the
     * full-tile open button; pointer-events-none while hidden lets open
     * clicks fall through.
     */
    "composer-attachment-remove":
      "absolute top-0.5 right-0.5 z-1 flex items-center justify-center w-4.5 h-4.5 p-0 m-0 border border-line-subtle rounded-full bg-elevated text-fg-secondary cursor-pointer opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) hover:(bg-high text-fg) focus-visible:(opacity-100 pointer-events-auto outline-none ring-2 ring-[var(--color-focus-ring)])",
    "composer-attachment-remove-icon": "w-3 h-3",
    /* Aliases → shared image-lightbox (chrome) so composer + timeline stay in sync. */
    "composer-attachment-lightbox": "image-lightbox",
    "composer-attachment-lightbox-img": "image-lightbox-img",
    "composer-attachment-lightbox-close": "image-lightbox-close",
    "composer-attachment-lightbox-close-icon": "image-lightbox-close-icon",
    "composer-chip-btn":
      "flex items-center gap-1.25 h-7.5 px-2.25 border-none rounded-8px bg-transparent text-fg-secondary text-12px font-normal transition-colors duration-fast ease-soft hover:enabled:(bg-white-faint text-fg) disabled:(opacity-45 cursor-not-allowed)",
    "composer-chip-btn-active":
      "bg-primary text-on-primary hover:enabled:(bg-accent-hover text-on-primary)",
    /* Mic chip: fixed label width so listening state (dot only) cannot reflow the bar. */
    "composer-mic-chip": "min-w-14 justify-center",
    /* Mic status pulse — idle is a muted dot; live matches danger semantic. */
    "composer-mic-dot":
      "w-1.5 h-1.5 rounded-full shrink-0 bg-fg-muted opacity-55",
    "composer-mic-dot-live":
      "bg-danger opacity-100 animate-mic-pulse",
    /* Agent mode control (sole mode UI — not top-nav) */
    "composer-mode": "relative shrink-0",
    "composer-mode-trigger":
      "flex items-center gap-1.25 h-7.5 px-2.25 border-none rounded-8px bg-white-faint text-fg-secondary text-12px font-normal transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) disabled:(opacity-70 cursor-wait)",
    "composer-mode-trigger-pending": "text-fg-muted",
    "composer-mode-build": "text-fg-secondary",
    "composer-mode-plan":
      "text-fg-secondary bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]",
    "composer-mode-ask": "text-fg-muted",
    "composer-mode-label": "whitespace-nowrap",
    "composer-mode-chevron": "text-10px opacity-70",
    "composer-mode-spinner": "text-fg-muted",
    "composer-mode-menu":
      "absolute left-0 bottom-[calc(100%+8px)] z-30 min-w-56 w-max max-w-72 rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 flex flex-col gap-0.5 animate-modal-in",
    "composer-mode-option":
      "flex w-full items-start gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-mode-option-active": "bg-white-soft",
    "composer-mode-option-check":
      "w-3.5 shrink-0 text-fg-secondary text-12px leading-5",
    "composer-mode-option-text": "min-w-0 flex flex-col gap-0.5",
    "composer-mode-option-label": "font-medium text-fg",
    "composer-mode-option-desc": "text-11px text-fg-muted leading-snug",
    "composer-mode-hint":
      "m-0 mt-1 px-2.5 py-1.5 text-10px text-fg-muted border-t border-line-subtle",
    "composer-model-trigger":
      "flex items-center gap-1.5 h-7.5 px-2.5 border-none rounded-pill bg-white-faint text-fg-secondary text-12px font-normal whitespace-nowrap transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg) aria-expanded:bg-white-soft aria-expanded:text-fg",
    "composer-model-trigger-dot":
      "w-1 h-1 rounded-full bg-fg-muted opacity-70",
    "composer-menu":
      "absolute right-0 bottom-[calc(100%+8px)] z-30 min-w-56 w-max max-w-72 rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 animate-modal-in",
    "composer-menu-row":
      "flex w-full items-center justify-between gap-3 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-menu-row-active": "bg-white-faint",
    "composer-menu-label": "text-fg-muted shrink-0",
    "composer-menu-value":
      "flex items-center gap-1.5 min-w-0 text-fg font-medium",
    "composer-menu-chevron": "text-fg-muted text-11px opacity-70",
    "composer-menu-divider":
      "my-1.5 h-px border-none bg-line-subtle",
    "composer-menu-sub":
      "absolute right-[calc(100%+6px)] bottom-0 z-40 min-w-44 max-h-64 overflow-y-auto rounded-shell border border-line-subtle bg-high shadow-popover p-1.5 animate-overlay-in",
    "composer-menu-item":
      "flex w-full items-center justify-between gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "composer-menu-item-active": "bg-white-soft",
    "composer-menu-check": "text-fg-secondary text-12px",
    "composer-send":
      "flex items-center justify-center w-8 h-8 border-none rounded-pill bg-primary text-on-primary text-14px font-semibold transition-all duration-fast ease-soft hover:enabled:bg-accent-hover active:enabled:scale-96 disabled:(opacity-35 cursor-not-allowed)",
    "composer-stop":
      "flex items-center justify-center h-8 px-3 border border-line-muted rounded-pill bg-white-faint text-fg-secondary text-12px font-medium transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg)",
    /*
     * Weekly remaining chip (F-CTX-01 sibling): sits immediately left of the
     * context pie. Pair with literal `group` so group-hover reveals the tip.
     */
    "composer-weekly":
      "relative shrink-0 flex items-center gap-1 h-7.5 px-1 rounded-pill cursor-default select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
    "composer-weekly-period":
      "text-10px font-medium leading-none text-fg-muted",
    "composer-weekly-value":
      "text-11px font-medium tabular-nums leading-none",
    "composer-weekly-value-ok": "text-fg-secondary",
    "composer-weekly-value-warn": "text-warning",
    "composer-weekly-value-danger": "text-danger",
    /*
     * Hover + keyboard (:focus-visible) only. group-focus-within would pin the
     * bubble after a mouse click (tabIndex host keeps :focus until elsewhere).
     */
    "composer-weekly-tip":
      "pointer-events-none absolute left-1/2 bottom-[calc(100%+8px)] z-50 flex w-max max-w-64 translate-x-center flex-col gap-0.5 overflow-hidden rounded-12px border border-line-subtle bg-elevated px-3 py-2 text-left shadow-popover opacity-0 transition-opacity duration-fast ease-soft group-hover:opacity-100 group-focus-visible:opacity-100",
    /*
     * Context-usage pie (F-CTX-01): sits in composer-bar-right just left of
     * the model name chip. 14×14 SVG inside a 30px hit target so the meter
     * reads at weekly-chip x-height without shrinking the tap area.
     * Fill (not stroke) and the same fg-secondary / warning / danger tokens
     * as the weekly chip — never brand/primary, which shouted next to chrome.
     * Pair with literal `group` on the host so group-hover reveals the tip.
     * Enter motion (`composer-usage-reveal`) is in base.css — grow width
     * first (pushes Weekly), then fade the disk; not here so fill-mode both
     * and the gap-cancel margin stay one keyframe.
     */
    "composer-usage":
      "relative shrink-0 flex items-center justify-center w-7.5 h-7.5 rounded-full cursor-default select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
    "composer-usage-svg": "block w-14px h-14px",
    "composer-usage-track": "fill-fg-faint opacity-35",
    "composer-usage-fill": "block",
    "composer-usage-fill-idle": "fill-fg-faint opacity-40",
    "composer-usage-fill-ok": "fill-fg-secondary",
    "composer-usage-fill-warn": "fill-warning",
    "composer-usage-fill-danger": "fill-danger",
    /*
     * Hover tip bubble — centered above the meter (正上方中间).
     * left-1/2 + translate-x-center pulls the bubble back by half its own width.
     * translate-x-center is a plain rule in uno.config; presetUno's
     * -translate-x-1/2 needs a preflight this app disables and silently resolves
     * to transform:none, which parked the bubble's left edge on the meter center.
     * Show/hide is opacity-only so nothing competes for the transform slot.
     * pointer-events-none so the tip never steals hover from the meter host.
     * group-focus-visible (not focus-within): click must not pin the bubble.
     */
    "composer-usage-tip":
      "pointer-events-none absolute left-1/2 bottom-[calc(100%+8px)] z-50 flex w-max max-w-64 translate-x-center flex-col gap-0.5 overflow-hidden rounded-12px border border-line-subtle bg-elevated px-3 py-2 text-left shadow-popover opacity-0 transition-opacity duration-fast ease-soft group-hover:opacity-100 group-focus-visible:opacity-100",
    "composer-usage-tip-title":
      "m-0 text-11px font-medium leading-snug text-fg-muted",
    /*
     * Body lines wrap inside max-w-64. nowrap + a sentence-length empty
     * state overflowed the rounded bubble and pulled the centered tip
     * over the weekly chip.
     */
    "composer-usage-tip-line":
      "m-0 text-12px font-normal leading-snug text-fg break-words",
    /* Hairline between occupancy and last-turn billed usage in the tip. */
    "composer-usage-tip-divider":
      "my-1 h-px w-full border-none bg-line-subtle",
    /* Always-mounted status row: fixed one-line height; tone classes change color only. */
    "composer-status":
      "mt-2 mb-0 min-h-4.5 mx-1 text-center text-12px leading-4.5 tracking-normal truncate",
    "composer-status-neutral": "text-fg-secondary",
    "composer-status-info": "text-fg-secondary",
    "composer-status-warn": "text-warning",
    /* Legacy aliases kept for any residual class references during migration. */
    "composer-hint": "text-12px text-fg-secondary tracking-normal",
    "composer-hint-footer": "mt-2 mb-0 text-center",
    "composer-hint-warn": "mt-1.5 mx-1 mb-0 text-center text-fg-secondary",
    "composer-hint-kbd": "text-fg-muted",
};
