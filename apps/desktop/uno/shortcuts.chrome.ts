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
      "border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] text-danger bg-danger-muted",
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
     * Head is a narrow rail chrome (280px) — do not use px-container (clamp up
     * to 80px); that squeezed title + close into the middle. Match body/footer
     * inset so Plan sits flush-left and the dismiss control flush-right.
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
      "shrink-0 ml-auto inline-flex items-center justify-center w-7 h-7 -mr-1 rounded-control border-none bg-transparent text-fg-muted transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg)",
    "context-drawer-body":
      "flex-1 min-h-0 flex flex-col overflow-hidden",
    "context-drawer-footer":
      "shrink-0 border-t border-line-subtle px-3.5 py-3 bg-surface",
    /* Session-scoped Agents rail (L2) */
    "agents-rail":
      "flex flex-col flex-1 min-h-0 overflow-y-auto",
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
      "w-[min(420px,92vw)] bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal p-5 animate-modal-in flex flex-col gap-3",
    "modal-title":
      "m-0 text-15px font-medium tracking-tight text-fg",
    "modal-details":
      "m-0 pl-4.5 text-13px leading-snug text-fg-secondary list-disc",
    "modal-actions": "flex flex-row justify-end gap-2",

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
     * Tokenized checkbox — empty = faint fill + strong border (readable on
     * elevated panels); checked = primary fill + on-primary mark; hover border
     * uses focus token, checked-hover uses accent-hover.
     *
     * Radius stays at 4px: --radius-sm (6px) on a 16px box is all but a circle,
     * which read as a radio group and made multi-select toggles look exclusive.
     */
    "ui-check":
      "group flex w-full items-start gap-2.5 text-12px leading-snug text-fg cursor-pointer select-none",
    "ui-check-disabled": "opacity-50 cursor-not-allowed pointer-events-none",
    "ui-check-input":
      "absolute opacity-0 w-4 h-4 m-0 peer",
    "ui-check-box":
      "mt-px shrink-0 w-4 h-4 rounded-4px border border-line-strong bg-white-faint flex items-center justify-center transition-colors duration-fast ease-soft group-hover:border-line-focus peer-focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] ring-offset-2 ring-offset-[var(--color-bg-elevated)]) peer-checked:(bg-primary border-primary) peer-checked:group-hover:(bg-accent-hover border-accent-hover)",
    "ui-check-mark": "block w-3 h-3 text-on-primary",
    "ui-check-text": "min-w-0 flex-1 flex flex-col",
    "ui-check-label": "min-w-0",
    "ui-check-desc": "m-0 mt-0.5 text-10px leading-snug text-fg-muted",
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

    /* Command palette (⌘K) */
    "palette-panel":
      "w-palette max-w-[92vw] max-h-[min(70vh,560px)] flex flex-col overflow-hidden bg-elevated text-fg border border-line-subtle rounded-modal shadow-modal animate-modal-in",
    "palette-input":
      "w-full shrink-0 border-none border-b border-line-subtle bg-transparent px-4 py-3.5 text-14px text-fg placeholder:text-fg-muted focus-visible:(outline-none ring-2 ring-inset ring-[var(--color-focus-ring)])",
    "palette-list":
      "m-0 p-1.5 list-none overflow-y-auto flex-1 min-h-0",
    "palette-item":
      "flex w-full items-center gap-2.5 border-none rounded-8px bg-transparent px-2.5 py-2 text-left text-12px text-fg transition-colors duration-fast ease-soft hover:bg-white-faint",
    "palette-item-active": "bg-white-soft",
    "palette-kind":
      "shrink-0 text-10px uppercase tracking-wide text-fg-muted px-1.5 py-0.5 rounded-pill bg-white-faint",
    "palette-label": "min-w-0 flex-1 text-fg font-medium",
    "palette-desc":
      "min-w-0 flex-1 text-fg-muted text-11px overflow-hidden text-ellipsis whitespace-nowrap",
    "palette-empty": "px-3 py-6 text-center text-12px text-fg-muted",

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
    "env-row-actions":
      "shrink-0 flex items-center gap-1 opacity-0 transition-opacity duration-fast ease-soft group-hover:opacity-100 focus-within:opacity-100",
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
