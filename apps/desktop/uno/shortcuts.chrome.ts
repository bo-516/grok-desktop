/**
 * Buttons, side panels, modals, command palette, settings palette UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const chromeShortcuts: Record<string, string> = {
    /* ── Chrome / modal / plan ── */
    chip:
      "border-none bg-white-faint text-fg-secondary rounded-pill px-2.25 py-1 text-11px leading-none",
    btn: "rounded-control border border-line-subtle bg-white-faint text-fg px-3 py-1.5 text-12px transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft border-line-muted) disabled:(opacity-45 cursor-not-allowed)",
    "btn-primary":
      "bg-primary border-primary text-on-primary hover:enabled:(bg-accent-hover border-accent-hover)",
    "btn-danger":
      "border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] text-danger bg-danger-muted hover:enabled:(bg-[color-mix(in_oklch,var(--color-danger)_22%,transparent)] border-[color-mix(in_srgb,var(--color-danger)_55%,transparent)] text-danger)",
    "btn-ghost":
      "rounded-control border border-transparent bg-transparent text-fg-secondary px-2.5 py-1.25 text-12px transition-colors duration-fast ease-soft hover:enabled:(bg-white-soft text-fg) disabled:(opacity-45 cursor-not-allowed)",
    "btn-new":
      "text-11px border-none bg-accent text-fg-inverse rounded-8px px-2 py-1 cursor-pointer",
    /*
     * Non-modal plan companion drawer (full-height, edge-docked).
     * Always mounted; open/closed classes drive translate + inert at the widget.
     */
    "context-drawer":
      "fixed top-0 right-0 bottom-0 z-50 w-rail-right max-w-full flex flex-col min-h-0 border-l border-line-subtle bg-surface transition-transform duration-slow ease-out",
    "context-drawer-open": "translate-x-none",
    /*
     * translateX(100%) = own width. Do not use --rail-right-width (plan 280):
     * preview rail is 420–900px and would leave a strip visible when "closed".
     */
    "context-drawer-closed": "translate-x-full pointer-events-none",
    /* Overlay mode adds depth; push mode is flush with the pushed content. */
    "context-drawer-overlay": "shadow-modal",
    /*
     * Head is a narrow rail chrome (300px default) — do not use px-container
     * (clamp up to 80px); that squeezed title + close into the middle. Match
     * body/footer inset so Plan sits flush-left and dismiss flush-right.
     */
    "context-drawer-head":
      "flex items-center justify-between gap-2 h-topnav px-3.5 shrink-0 border-b border-line-subtle bg-titlebar",
    "context-drawer-tabs":
      "flex items-center gap-0.5 min-w-0 flex-1",
    "context-drawer-tab":
      "inline-flex items-center gap-1.5 border-none bg-transparent px-2 py-1 rounded-control text-12px font-medium text-fg-muted cursor-pointer transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg)",
    "context-drawer-tab-active": "bg-white-soft text-fg",
    "context-drawer-title":
      "m-0 flex items-center gap-1.5 min-w-0 flex-1 text-13px font-medium tracking-tight text-fg text-left",
    "context-drawer-count":
      "shrink-0 rounded-pill bg-white-soft text-fg-muted text-10px font-medium leading-none px-1.75 py-0.75 tabular-nums",
    "context-drawer-close":
      "shrink-0 ml-auto inline-flex items-center justify-center box-border w-24px h-24px p-0 -mr-1 rounded-control border-none bg-transparent text-fg-muted transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg) [&_svg]:(block shrink-0)",
    "context-drawer-body":
      "flex-1 min-h-0 flex flex-col overflow-hidden",
    "context-drawer-footer":
      "shrink-0 border-t border-line-subtle px-3.5 py-3 bg-surface",
    /*
     * Session-scoped Agents rail (L2). flex-1 lives on agents-rail-fill
     * (roster-only); inspect uses agents-rail-compact (title-only picker)
     * so the transcript owns leftover height. See uno/shortcuts.agents.ts.
     */
    "agents-rail":
      "flex flex-col min-h-0 overflow-y-auto",
    "agents-rail-section":
      "flex flex-col gap-2 px-3.5 py-3 border-b border-line-subtle last:border-b-0",
    "agents-rail-section-title":
      "m-0 text-10px font-semibold uppercase tracking-wide text-fg-muted",
    "agents-rail-goal-line":
      "m-0 text-12px text-fg-secondary",
    "agents-rail-goal-objective":
      "m-0 text-11px text-fg-muted line-clamp-3",
    "agents-rail-round": "flex flex-col gap-1.5",
    "agents-rail-round-title":
      "m-0 text-11px font-medium text-fg-secondary",
    "agents-rail-list": "m-0 p-0 list-none flex flex-col gap-1",
    "agents-rail-row":
      "w-full text-left text-12px leading-snug text-fg px-1.5 py-1 rounded-control",
    "agents-rail-row-disabled": "text-fg-muted cursor-default",
    /* Plan panel — display-only checklist (no approval dock) */
    "plan-panel": "flex flex-col flex-1 min-h-0",
    "plan-empty":
      "flex flex-col items-start gap-2 p-4 text-fg-muted text-12px leading-snug",
    "plan-empty-title": "m-0 text-13px font-medium text-fg-secondary",
    "plan-empty-hint": "m-0 text-12px leading-snug text-fg-muted",
    "plan-progress":
      "shrink-0 flex flex-col gap-1.5 px-3.5 pt-3 pb-2 border-b border-line-subtle",
    "plan-progress-meta":
      "flex items-center justify-between gap-2 text-11px text-fg-muted",
    "plan-progress-count": "tabular-nums font-medium text-fg-secondary",
    "plan-progress-track":
      "h-1 w-full rounded-pill overflow-hidden bg-white-faint",
    "plan-progress-fill":
      "h-full rounded-pill bg-success transition-[width] duration-300 ease-soft",
    "plan-list-scroll": "flex-1 min-h-0 overflow-y-auto",
    "plan-list": "m-0 p-0 list-none flex flex-col",
    "plan-item":
      "relative flex gap-2.5 items-start px-3.5 py-2.5 border-b border-line-subtle last:border-b-0",
    "plan-item-done": "opacity-70",
    "plan-item-active": "bg-white-faint",
    "plan-marker":
      "relative z-1 shrink-0 mt-0.5 w-5 h-5 rounded-pill flex items-center justify-center text-10px font-medium leading-none",
    "plan-marker-pending":
      "border border-line-strong bg-transparent text-fg-muted",
    "plan-marker-active":
      "border border-primary bg-primary text-on-primary shadow-[0_0_0_3px_var(--color-accent-muted)]",
    "plan-marker-done":
      "border border-transparent bg-success-muted text-success",
    "plan-item-body": "min-w-0 flex-1 flex flex-col gap-0.5",
    "plan-text":
      "text-12px leading-snug text-fg break-words",
    "plan-text-done": "text-fg-muted line-through decoration-fg-faint",
    "plan-text-active": "text-fg font-medium",
    "plan-status-label":
      "text-10px uppercase tracking-wide text-fg-muted leading-none",
    "plan-status-label-active": "text-fg-secondary",
    "plan-status-label-done": "text-success",
    /* Full-screen dimmer shared by confirm dialogs + command palette */
    overlay:
      "fixed inset-0 bg-overlay flex items-center justify-center z-100 animate-overlay-in",
    "modal-backdrop":
      "fixed inset-0 bg-overlay flex items-center justify-center z-100 animate-overlay-in",
    /* Full-page image preview dialog (composer attach + timeline history).
     * Portaled to body; light backdrop-blur so the page is still faintly readable. */
    "image-lightbox":
      "fixed inset-0 z-110 flex items-center justify-center p-6 bg-overlay backdrop-blur-8px animate-overlay-in cursor-zoom-out",
    "image-lightbox-img":
      "max-w-[min(96vw,1200px)] max-h-[min(90vh,900px)] w-auto h-auto object-contain rounded-12px shadow-modal cursor-default select-none",
    "image-lightbox-close":
      "absolute top-4 right-4 z-1 flex items-center justify-center w-9 h-9 p-0 m-0 border border-line-subtle rounded-full bg-elevated text-fg-secondary cursor-pointer transition-colors duration-fast ease-soft hover:(bg-high text-fg)",
    "image-lightbox-close-icon": "w-4.5 h-4.5",
    modal:
      "w-[min(420px,92vw)] bg-container border border-line-subtle rounded-modal shadow-modal p-5 animate-modal-in",
    /* Confirm dialog shell (ConfirmDialogView) — elevated surface, never white-out */
    "modal-panel":
      "w-[min(400px,92vw)] bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal px-5 pt-5 pb-4 animate-modal-in flex flex-col gap-4",
    "modal-title":
      "m-0 min-w-0 flex-1 text-15px font-medium tracking-tight leading-snug text-fg",
    "modal-details":
      "m-0 pl-4.5 text-13px leading-snug text-fg-secondary list-disc",
    "modal-actions": "flex flex-row justify-end items-center gap-2 pt-1",
    /*
     * Confirm footer. Descendant radius/size beat `btn` / `btn-ghost`
     * `rounded-control` so Cancel (ghost) and Confirm (filled) share one
     * pill — the filled 8px control otherwise reads as a sharp box.
     */
    "confirm-actions":
      "flex flex-row justify-end items-center gap-2 pt-1 [&_button]:(rounded-pill min-h-8 px-3.5)",
    "confirm-head": "flex items-center gap-3 min-w-0",
    "confirm-icon":
      "shrink-0 w-8 h-8 rounded-10px flex items-center justify-center",
    "confirm-icon-danger": "bg-danger-muted text-danger",
    "confirm-icon-default": "bg-white-soft text-fg-secondary",
    "confirm-icon-svg": "block w-4 h-4",
    "confirm-subject":
      "m-0 w-fit max-w-full rounded-8px border border-line-subtle bg-white-faint px-2.75 py-1.75 text-12px leading-snug text-fg break-words [overflow-wrap:anywhere] line-clamp-2",
    "confirm-details":
      "m-0 p-0 flex flex-col gap-1.5 text-13px leading-relaxed text-fg-secondary",
    "confirm-detail": "m-0",

    /*
     * Signed-out gate (LoginGateView). Not a modal: while the CLI has no
     * credential this *is* the window, so it paints the opaque app background
     * (never `bg-overlay`, which would leave the real UI legible underneath)
     * above every other layer, lightbox included.
     */
    "login-gate-screen":
      "fixed inset-0 z-120 flex items-center justify-center p-8 bg-app text-fg animate-overlay-in",
    /* Centered column: logo, title, copy, one action, fallback hint. */
    "login-gate":
      "flex flex-col gap-3.5 items-center text-center w-[min(360px,86vw)]",
    /*
     * 80px: bigger than the modal's 56px mark since the screen is otherwise
     * empty, still short of a splash logo. The asset is the app tile (dark,
     * self-contained), so it needs no ring or fill — only the matching radius.
     */
    "login-gate-logo": "block w-20 h-20 rounded-20px select-none",
    "login-gate-title":
      "m-0 text-18px font-medium tracking-tight leading-snug text-fg",
    "login-gate-copy":
      "m-0 max-w-[34ch] text-13px leading-relaxed text-fg-secondary",
    "login-gate-primary": "w-full min-h-9 rounded-pill font-medium mt-1",
    "login-gate-hint":
      "m-0 max-w-[38ch] text-11px leading-snug text-fg-muted [overflow-wrap:anywhere]",

    /*
     * Side drawers (Settings / Environment / Overview / Tasks).
     * Fixed overlay + elevated dark surface + explicit text-fg — without these
     * the panel was a bare flex child (native white form chrome + light text =
     * white-out / "can't close" UX).
     */
    "side-panel-backdrop":
      "fixed inset-0 z-90 bg-overlay animate-overlay-in border-none p-0 m-0 cursor-default",
    "side-panel":
      "fixed top-0 right-0 bottom-0 z-95 w-side-panel max-w-full flex flex-col min-h-0 border-l border-line-subtle bg-elevated text-fg shadow-modal animate-modal-in",
    "side-panel-head":
      "flex items-center justify-between gap-3 shrink-0 px-4 py-3.5 border-b border-line-subtle bg-elevated",
    "side-panel-title":
      "m-0 text-14px font-medium tracking-tight text-fg",
    "side-panel-close":
      "shrink-0 rounded-control border border-line-muted bg-white-soft text-fg px-3 py-1.5 text-12px font-medium transition-colors duration-fast ease-soft hover:(bg-white-hover border-line-strong)",
    /*
     * Sections own their own vertical rhythm (py + hairline rule) so the body
     * itself adds no gap — stacking body gap on top of section padding is what
     * made every drawer read as one undifferentiated column.
     */
    "side-panel-body":
      "flex-1 min-h-0 overflow-y-auto px-4 py-0 flex flex-col text-fg",
    /*
     * Pin between header and scroll body (e.g. Overview search). Outside
     * overflow so it stays put; bottom hairline is the only rule against the
     * list so the first body section can keep first:border-t-0.
     */
    "side-panel-toolbar":
      "shrink-0 z-10 flex flex-col px-4 pt-3.5 pb-4 border-b border-line-subtle bg-elevated",
    /*
     * Pin between scroll body and footer (e.g. Account). Outside overflow so it
     * stays visible; sections inside drop their top hairline so the pin border
     * is the only rule against the body.
     */
    "side-panel-sticky":
      "shrink-0 z-10 flex flex-col px-4 py-0 border-t border-line-subtle bg-elevated [&_.side-panel-section]:(border-t-0 py-3) [&_.side-panel-section:first-child]:pt-3",
    /* Sticky apply region pinned to drawer bottom (always visible while scrolling). */
    "side-panel-footer":
      "shrink-0 sticky bottom-0 z-10 flex items-center justify-between gap-3 px-4 py-2.75 border-t border-line-subtle bg-elevated",
    "side-panel-footer-dirty":
      "border-t-[color-mix(in_oklch,var(--color-warning)_40%,var(--color-line-subtle))]",
    "side-panel-hint":
      "m-0 text-11px leading-snug text-fg-muted",
    "side-panel-section":
      "flex flex-col gap-2.5 py-4 border-t border-line-subtle first:(pt-3.5 border-t-0)",
    /* Eyebrow, not a heading: small caps recede so the controls lead the eye. */
    "side-panel-section-title":
      "m-0 text-10px font-semibold uppercase tracking-wide text-fg-muted",
    "side-panel-section-danger":
      "flex flex-col gap-2.5 py-4 border-t border-[color-mix(in_oklch,var(--color-danger)_28%,transparent)]",
    "side-panel-section-title-danger":
      "m-0 text-10px font-semibold uppercase tracking-wide text-danger",
    "side-panel-actions":
      "flex flex-wrap items-center gap-2",
    /*
     * Toggle list card — hairline-separated rows inside one bordered surface, so
     * a run of checkboxes reads as a grouped list instead of floating text.
     */
    "panel-group":
      "flex flex-col rounded-card border border-line-subtle bg-white-faint overflow-hidden",
    "panel-row":
      "px-2.75 py-2.25 border-b border-line-subtle last:border-b-0 transition-colors duration-fast ease-soft hover:bg-white-soft",
    /*
     * In-drawer note. Distinct from `banner` (shell shortcuts): banner carries
     * mx-container/mt for the main column and paints inset inside a 400px drawer.
     */
    "panel-note":
      "m-0 rounded-card border border-line-subtle bg-white-faint px-2.75 py-2 text-11px leading-snug text-fg-secondary",
    /*
     * Tinted, not filled. --color-danger-muted (28% danger) is sized for a
     * button face; across a full-width note it outweighed the section heading
     * and made an expected default state look like a failure.
     */
    "panel-note-danger":
      "border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] text-danger",
    "panel-note-warning":
      "border-line-muted bg-white-soft text-fg-secondary",
    /* Collapsible section header (parent owns the expanded flag). */
    "panel-disclosure-btn":
      "flex w-full items-center gap-1.5 border-none bg-transparent p-0 text-left cursor-pointer text-10px font-semibold uppercase tracking-wide text-fg-muted transition-colors duration-fast ease-soft hover:text-fg-secondary",
    "panel-disclosure-icon":
      "w-3.5 h-3.5 shrink-0 transition-transform duration-fast ease-soft",
    "panel-disclosure-count":
      "ml-auto text-10px font-normal normal-case tracking-normal text-fg-faint",
    "field-label":
      "flex flex-col gap-1.5 text-11px font-medium text-fg-secondary",
    "text-input":
      "w-full min-h-8.5 px-2.5 py-1.75 rounded-control border border-line-muted bg-high text-fg text-12px transition-colors duration-fast ease-soft focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] border-line-focus bg-highest) placeholder:text-fg-muted",
    "check-row":
      "flex items-start gap-2 text-12px leading-snug text-fg cursor-pointer",
    /*
     * Tokenized checkbox (shadcn/Radix-style face, no new deps).
     *
     * Empty: high surface + muted border so the face reads on elevated panels
     * without a harsh outline. Checked: solid primary + on-primary mark via
     * `ui-check-box-on` / `ui-check-mark-on` (class-driven from React — do not
     * use peer-checked; shortcuts never emit a real .peer class).
     *
     * Radius stays ~3.5px: --radius-sm (6px) on a 15px box is nearly circular
     * and reads as radio / exclusive choice.
     *
     * Vertical alignment: `ui-check-face` is one label line tall (`1lh`) and
     * flex-centers the 15px box, so the control lines up with the title — not
     * the midpoint of title+description. Do not put mt/pt on box/text for this.
     *
     * Pair the label with a literal `group` class (see Checkbox.tsx) so
     * group-hover / group-focus-within variants resolve.
     */
    "ui-check":
      "relative flex w-full items-start gap-2.5 text-12px leading-snug text-fg cursor-pointer select-none",
    "ui-check-disabled": "opacity-50 cursor-not-allowed pointer-events-none",
    /*
     * One label-line tall shell. Centers the square on the first text line and
     * hosts the invisible native input so hit/focus geometry matches the box
     * even when the outer row adds padding (absolute-to-label was wrong).
     */
    "ui-check-face":
      "relative flex h-[1lh] w-[15px] shrink-0 items-center justify-center",
    /*
     * Visually hidden but still focusable for keyboard. Fills the face so
     * space/enter and pointer land on the same square users see.
     */
    "ui-check-input":
      "absolute inset-0 m-0 h-full w-full opacity-0 cursor-pointer appearance-none",
    "ui-check-box":
      "shrink-0 w-[15px] h-[15px] rounded-[3.5px] border border-line-muted bg-high flex items-center justify-center transition-colors duration-fast ease-soft group-hover:border-line-focus group-focus-within:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-1 ring-offset-[var(--color-bg-surface)])",
    /* Checked face — toggled from Checkbox via className, not :checked. */
    "ui-check-box-on":
      "bg-primary border-primary group-hover:(bg-accent-hover border-accent-hover)",
    /*
     * Check glyph: hidden/scaled when off so mount is stable for a short
     * scale-in; color is always on-primary (only visible over primary fill).
     */
    "ui-check-mark":
      "block shrink-0 text-on-primary opacity-0 scale-75 transition-all duration-fast ease-soft",
    "ui-check-mark-on": "opacity-100 scale-100",
    /* Text column: title + optional description, left edge under the gap. */
    "ui-check-text": "min-w-0 flex-1 flex flex-col gap-0.5",
    "ui-check-label": "min-w-0 font-medium leading-snug text-fg",
    "ui-check-desc": "m-0 text-11px leading-snug text-fg-muted",
    /* Native arrow is suppressed by appearance-none; ui-select-chevron redraws it. */
    "ui-select-wrap": "relative flex w-full items-center",
    "ui-select":
      "w-full min-h-8.5 pl-2.5 pr-8 py-1.75 rounded-control border border-line-muted bg-high text-fg text-12px cursor-pointer transition-colors duration-fast ease-soft appearance-none focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] border-line-focus bg-highest) disabled:opacity-50",
    "ui-select-chevron":
      "pointer-events-none absolute right-2.5 w-3.5 h-3.5 text-fg-muted",
    "ui-select-disabled": "opacity-50 cursor-not-allowed",
    /* Deny/allow are a pair — two columns keep them comparable and off the scroll. */
    "settings-rule-grid": "grid grid-cols-2 gap-2",
    "settings-restart-notice": "flex items-start gap-2 pt-3",
    "settings-apply-hint":
      "m-0 min-w-0 flex-1 text-11px leading-snug text-warning",
    "settings-footer-note":
      "m-0 min-w-0 flex-1 text-11px leading-snug text-fg-muted",
    "settings-env-key":
      "text-10px text-fg-faint font-mono",
    "code-block":
      "m-0 max-h-48 overflow-auto rounded-shell bg-high border border-line-subtle px-2.5 py-2 font-mono text-11px leading-relaxed text-fg-secondary whitespace-pre-wrap break-words",
    "row-gap": "flex flex-wrap items-center gap-2",
    "banner-info": "border-line-subtle bg-white-faint text-fg-secondary",

    /*
     * Command palette (⌘K) — three-column table, not a flex bag.
     * Kind is sized for the longest token (COMMAND / SETTING) so titles
     * and descriptions share one vertical start across rows. Both text
     * columns are minmax(0,1fr): missing descriptions leave an empty
     * third cell instead of letting the title eat the right half.
     * Overflow tips portal above the modal (z-110) as GitHub-style pre
     * text, hugging the truncated cell's bottom-right or top-right corner.
     */
    "palette-panel":
      "w-palette max-w-[92vw] max-h-[min(70vh,560px)] flex flex-col overflow-hidden bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal animate-modal-in",
    "palette-input":
      "w-full shrink-0 border-none border-b border-line-subtle bg-transparent px-4 py-3.5 text-14px text-fg placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-inset ring-[var(--color-focus-ring)])",
    "palette-list":
      "m-0 p-1.5 list-none overflow-y-auto flex-1 min-h-0",
    "palette-item":
      "grid w-full grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2.5 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "palette-item-active": "bg-white-soft",
    "palette-kind":
      "justify-self-start w-max inline-flex items-center justify-center text-10px uppercase tracking-wide text-fg-muted px-1.5 py-0.5 rounded-pill bg-white-faint",
    "palette-label": "min-w-0 truncate text-fg font-medium",
    "palette-desc":
      "min-w-0 text-fg-muted text-11px overflow-hidden text-ellipsis whitespace-nowrap",
    "palette-empty": "px-3 py-6 text-center text-12px text-fg-muted",
    "overflow-tip":
      "fixed z-110 rounded-8px border border-line-subtle bg-elevated text-fg shadow-popover px-2.5 py-2 pointer-events-auto",
    "overflow-tip-pre":
      "m-0 max-h-48 overflow-auto font-mono text-11px leading-relaxed text-fg whitespace-pre-wrap break-words",

    /*
     * Environment sheet (Agent environment) — wide two-pane modal catalog.
     * Grammar matches palette-panel (elevated + modal shadow), not side-panel.
     */
    "env-sheet":
      "w-env-sheet max-w-[92vw] h-[min(640px,86vh)] max-h-[86vh] flex flex-col overflow-hidden bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal animate-modal-in",
    "env-sheet-head":
      "flex items-center justify-between gap-3 shrink-0 px-4 py-3 border-b border-line-subtle",
    "env-sheet-title":
      "m-0 text-14px font-medium tracking-tight text-fg",
    "env-sheet-body":
      "flex flex-1 min-h-0 min-w-0",
    "env-nav":
      "w-env-nav shrink-0 flex flex-col gap-0.5 p-2 border-r border-line-subtle overflow-y-auto",
    "env-nav-item":
      "flex w-full items-center gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg-secondary cursor-pointer transition-colors duration-fast ease-soft hover:(bg-white-faint text-fg)",
    "env-nav-item-active":
      "bg-white-soft text-fg font-medium",
    "env-nav-label": "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
    "env-nav-count":
      "shrink-0 text-10px font-normal text-fg-muted tabular-nums px-1.5 py-0.5 rounded-pill bg-white-faint",
    "env-page":
      "flex flex-1 min-w-0 min-h-0 flex-col",
    "env-toolbar":
      "flex flex-wrap items-center gap-2 shrink-0 px-3 py-2.5 border-b border-line-subtle",
    "env-toolbar-search":
      "min-w-0 flex-1 max-w-xs",
    "env-toolbar-meta":
      "shrink-0 text-11px text-fg-muted",
    "env-list":
      "m-0 p-2 list-none flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5",
    "env-row":
      "flex flex-col gap-0.5 rounded-8px px-2.75 py-2 transition-colors duration-fast ease-soft hover:bg-white-soft",
    "env-row-main":
      "flex items-center gap-2 min-w-0",
    "env-row-meta":
      "flex items-center gap-2 min-w-0 pl-4 text-11px text-fg-muted",
    "env-row-name":
      "min-w-0 flex-1 font-medium text-12px text-fg overflow-hidden text-ellipsis whitespace-nowrap",
    "env-row-desc":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
    /* Hover-reveal row controls; snap visible, no opacity transition. */
    "env-row-actions":
      "shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100",
    "env-chip":
      "shrink-0 text-10px uppercase tracking-wide text-fg-muted px-1.5 py-0.5 rounded-pill bg-white-faint border border-line-subtle",
    "env-status-dot":
      "shrink-0 w-2 h-2 rounded-full",
    "env-status-healthy": "bg-success",
    "env-status-failing": "bg-danger",
    "env-status-disabled": "bg-fg-muted opacity-50",
    "env-status-unchecked":
      "bg-transparent border border-line-strong",
    "env-empty":
      "flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center",
    "env-empty-title":
      "m-0 text-13px font-medium text-fg",
    "env-empty-hint":
      "m-0 text-12px text-fg-muted max-w-sm",
    "env-overview-grid":
      "grid grid-cols-2 gap-2 p-3",
    "env-overview-card":
      "flex flex-col gap-1 rounded-card border border-line-subtle bg-white-faint px-3 py-2.5 text-left cursor-pointer transition-colors duration-fast ease-soft hover:bg-white-soft",
    "env-overview-card-label":
      "m-0 text-10px font-semibold uppercase tracking-wide text-fg-muted",
    "env-overview-card-value":
      "m-0 text-18px font-medium tabular-nums text-fg",
    "env-overview-meta":
      "flex flex-col gap-1.5 px-3 pb-3 text-12px text-fg-secondary",

    /* Rules & prompts page (three stacked scopes + evidence bar) */
    "prompt-page":
      "flex flex-1 min-h-0 min-w-0 flex-col",
    "prompt-page-intro":
      "shrink-0 px-3 pt-2.5 pb-1 border-b border-line-subtle",
    "prompt-page-intro-title":
      "m-0 text-12px font-medium text-fg",
    "prompt-page-intro-body":
      "m-0 mt-0.5 text-11px leading-snug text-fg-muted",
    "prompt-scopes":
      "flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-3",
    "prompt-scope":
      "flex flex-col gap-1.5 rounded-card border border-line-subtle bg-white-faint px-3 py-2.5",
    "prompt-scope-foreign": "opacity-90",
    "prompt-scope-unavailable": "opacity-70",
    "prompt-scope-pending": "ring-1 ring-line-strong",
    "prompt-scope-head":
      "flex flex-wrap items-center justify-between gap-2 min-w-0",
    "prompt-scope-head-left":
      "flex items-center gap-1.5 min-w-0 text-fg",
    "prompt-scope-head-right":
      "flex items-center gap-2 min-w-0 text-11px text-fg-muted",
    "prompt-scope-title":
      "m-0 text-12px font-medium text-fg",
    "prompt-scope-project": "font-normal text-fg-secondary",
    "prompt-scope-path":
      "max-w-xs overflow-hidden text-ellipsis whitespace-nowrap text-10px text-fg-muted",
    "prompt-scope-tok": "shrink-0 tabular-nums",
    "prompt-scope-subhint":
      "m-0 text-10px leading-snug text-fg-muted",
    "prompt-scope-empty": "py-1.5 flex flex-col gap-0.5",
    "prompt-scope-empty-title":
      "text-12px text-fg-secondary",
    "prompt-scope-foot":
      "flex flex-wrap items-center gap-1.5 pt-1",
    "prompt-add-input": "min-w-0 flex-1",
    "prompt-add-cat":
      "shrink-0 max-w-28 text-11px rounded-control border border-line-subtle bg-elevated text-fg px-1.5 py-1",
    "prompt-entry-list":
      "m-0 p-0 list-none flex flex-col gap-1",
    "prompt-entry-row":
      "flex items-center gap-1.5 min-w-0 rounded-8px px-1 py-0.5 hover:bg-white-soft",
    "prompt-entry-row-disabled": "opacity-70",
    "prompt-entry-grip":
      "shrink-0 text-fg-muted cursor-grab active:cursor-grabbing",
    "prompt-entry-input": "min-w-0 flex-1 text-12px",
    "prompt-entry-cat":
      "shrink-0 max-w-22 text-10px rounded-control border border-line-subtle bg-elevated text-fg-secondary px-1 py-0.5",
    "prompt-entry-enable": "shrink-0 flex items-center",
    "prompt-entry-menu": "relative shrink-0",
    "prompt-entry-menu-btn": "p-1 list-none [&::-webkit-details-marker]:hidden",
    "prompt-entry-menu-panel":
      "absolute right-0 z-10 mt-1 min-w-40 flex flex-col gap-0.5 rounded-8px border border-line-subtle bg-elevated p-1 shadow-modal",
    "prompt-entry-menu-item":
      "w-full justify-start text-left text-12px",
    "prompt-badge":
      "shrink-0 text-10px px-1.5 py-0.5 rounded-pill border border-line-subtle bg-white-soft text-fg-muted",
    "prompt-badge-git": "text-fg-secondary",
    /* no-underline: this chip is not the disabled (struck) input. */
    "prompt-badge-overridden": "text-fg-muted no-underline",
    "prompt-badge-overrides": "text-fg-secondary",
    "prompt-overlay-hint":
      "m-0 py-0.5 text-center text-10px text-fg-muted",
    "prompt-foreign-banner":
      "flex flex-col gap-1.5 rounded-8px border border-line-subtle bg-white-soft px-2 py-1.5",
    "prompt-foreign-actions":
      "flex flex-wrap items-center gap-1",
    "prompt-evidence":
      "flex flex-wrap items-center gap-2 shrink-0 px-3 py-2 border-t border-line-subtle text-12px text-fg-secondary",
    "prompt-evidence-warn": "text-warning",
    "prompt-evidence-text": "min-w-0 flex-1",
    "settings-prompts-link":
      "mt-3 flex flex-col gap-1.5 rounded-8px border border-line-subtle bg-white-faint px-2.5 py-2",

    /* Multi-session overview rows */
    "overview-bucket":
      "m-0 text-11px font-medium tracking-wide text-fg-muted uppercase",
    "overview-list": "m-0 p-0 list-none flex flex-col gap-1",
    "overview-row":
      "flex w-full items-center justify-between gap-2 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "overview-row-live": "bg-white-faint",
    "overview-title":
      "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg",
    "overview-status": "shrink-0 text-11px text-fg-muted",
    "overview-actions": "flex flex-wrap items-center gap-1.5 px-1 pb-1",
    "peek-panel":
      "mt-2 flex flex-col gap-2 rounded-shell border border-line-subtle bg-high p-3",

    /* Composer send nested in StarBorder + ClickSpark */
    "composer-send-star": "rounded-pill shrink-0 [&_.rb-star-border-inner]:(rounded-inherit leading-none) [&_.composer-send]:pointer-events-none",
    "settings-apply-star": "block w-full rounded-control [&_.rb-star-border-inner]:(rounded-inherit w-full)",
    "settings-apply-inner": "w-full flex justify-center rounded-inherit pointer-events-none",
    /*
     * Settings UI color palette swatches (fills from defineColor tokens).
     * Swatch-only by design: per-swatch captions truncated to "Bla…"/"Oran…" at
     * drawer width, so the name of the active option is shown once below the row
     * (palette-current) and every swatch keeps its title/aria-label.
     */
    "palette-picker": "flex flex-wrap gap-1.5 m-0 p-0 list-none",
    "palette-picker-item": "m-0 p-0",
    "palette-swatch-btn":
      "flex items-center justify-center border-none bg-transparent p-0.5 rounded-pill cursor-pointer transition-colors duration-fast ease-soft hover:bg-white-soft",
    "palette-swatch": "block w-6 h-6 rounded-pill border border-line-muted shadow-[inset_0_0_0_1px_var(--color-border-subtle)] transition-all duration-fast ease-soft",
    "palette-swatch-active": "border-fg shadow-[0_0_0_2px_var(--color-bg-elevated),0_0_0_4px_var(--color-accent-muted)]",
    "palette-current": "m-0 text-11px leading-snug text-fg-secondary",
    "palette-swatch-black": "bg-[var(--palette-swatch-black)]",
    "palette-swatch-white": "bg-[var(--palette-swatch-white)]",
    "palette-swatch-blue": "bg-[var(--palette-swatch-blue)]",
    "palette-swatch-purple": "bg-[var(--palette-swatch-purple)]",
    "palette-swatch-pink": "bg-[var(--palette-swatch-pink)]",
    "palette-swatch-red": "bg-[var(--palette-swatch-red)]",
    "palette-swatch-orange": "bg-[var(--palette-swatch-orange)]",
    "palette-swatch-yellow": "bg-[var(--palette-swatch-yellow)]",
    "palette-swatch-green": "bg-[var(--palette-swatch-green)]",
    "palette-swatch-gray": "bg-[var(--palette-swatch-gray)]",
    /* Modal body copy (replaces base.css .modal h2/p) */
    "modal-body": "m-0 mb-4 text-fg-secondary text-13px leading-snug",
    "banner-code": "text-[0.95em] px-1.25 py-px rounded-1 bg-white-soft",
};
