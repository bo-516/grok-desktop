/**
 * Timeline message / tool / markdown UnoCSS shortcuts.
 * Colors resolve through defineColor tokens via theme color names.
 */

export const timelineShortcuts: Record<string, string> = {
    /* ── Timeline ── */
    /* Bottom padding is modest: composer sits in flex flow under the timeline,
     * so we no longer reserve a fixed absolute-dock gutter (pb-42).
     * No scroll-smooth: session switch / stick-to-bottom must land instantly
     * (CSS scroll-behavior would turn scrollTo({ behavior: "auto" }) into a glide).
     * gap-7 (28px): spacing between top-level FadeContent children (user / turn / error).
     * In-turn spacing is turn-block gap-3; rail steps use turn-rail gap-1. */
    timeline:
      "flex-1 min-h-0 overflow-y-auto px-container pt-5 pb-5 flex flex-col gap-7 w-full",
    empty:
      "m-auto text-center text-fg-muted px-6 py-12 flex flex-col items-center gap-2",
    "empty-title":
      "m-0 text-18px font-medium tracking-tight text-fg-secondary",
    "empty-sub": "m-0 text-13px leading-snug text-fg-muted max-w-md",
    "msg-user-wrap": "flex flex-col items-end w-full gap-1.5",
    /* Sent image strip (above the text bubble); mirrors composer attach thumbs. */
    "msg-user-attachments":
      "flex flex-wrap justify-end items-start gap-2 m-0 p-0 list-none max-w-[min(80%,48rem)]",
    "msg-user-attachment":
      "relative shrink-0 w-20 h-20 rounded-12px overflow-hidden border border-line-subtle bg-white-faint",
    /* Full-tile hit target opens shared ImageLightboxView. */
    "msg-user-attachment-open":
      "block w-full h-full p-0 m-0 border-0 bg-transparent cursor-zoom-in text-inherit",
    "msg-user-attachment-thumb":
      "block w-full h-full object-cover pointer-events-none",
    "msg-user-attachment-fallback":
      "flex items-center justify-center w-full h-full px-1 text-10px text-fg-muted text-center leading-tight break-all",
    "item-user":
      "max-w-[min(80%,48rem)] px-3.75 py-2.75 rounded-bubble bg-user text-fg text-body-md tracking-tight whitespace-pre-wrap break-words",
    "msg-time":
      "text-12px leading-none text-fg-secondary opacity-85 px-0.5",
    "msg-agent-wrap": "flex justify-start w-full",
    /* relative + z: Copy sits in a reserved bottom pad (see msg-agent-inner-actions)
     * so it never paints over the next timeline unit ("Worked for …").
     * hover/focus-within z-2: keeps the row above a following process pill while
     * the pointer is on Copy (otherwise the next unit steals hover and hides it). */
    "msg-agent-inner":
      "relative z-0 w-full flex flex-col gap-2.5 hover:z-2 focus-within:z-2",
    /* pb = msg-actions chrome (~26px) + a little air above Copy so the
     * button does not sit flush against the last answer line.
     * Only applied when the Copy row exists — process/tool rows stay tight. */
    "msg-agent-inner-actions": "pb-9",
    "item-agent": "p-0 text-body-md tracking-tight text-fg break-words",
    /* Absolute inside the agent pad (bottom-0). Opacity still hides the chrome
     * when idle so the pad reads as quiet air under the answer only. */
    "msg-actions":
      "absolute left-0 bottom-0 z-1 flex items-center gap-0.5 px-0 py-0.5 opacity-0 pointer-events-none transition-opacity duration-normal ease-soft group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto)",
    "msg-action-btn":
      "border-none bg-transparent text-fg-muted text-12px px-2 py-1.25 rounded-7px transition-colors duration-fast ease-soft hover:(text-fg bg-white-faint)",
    /* Rail header only — shell-toggle is not used for nested thought/tool steps. */
    "shell-toggle":
      "inline-flex items-center gap-1.5 min-h-8 min-w-200px w-auto max-w-full border-none rounded-9px px-2.75 py-2 text-left font-normal text-11px leading-tight transition-colors duration-normal ease-soft",
    "shell-toggle-live":
      "bg-white-faint text-fg-muted hover:(bg-white-soft text-fg-secondary)",
    "shell-toggle-done":
      "bg-transparent text-fg-faint hover:(bg-white-faint text-fg-muted)",
    /* Lucide 12×12 slot — block + fixed box kills SVG baseline drift vs label text. */
    "shell-chevron": "block w-3 h-3 shrink-0 text-fg-faint",

    /* One turn = activity rail + final answer; inter-turn gap is on .timeline. */
    "turn-block": "flex flex-col gap-3 w-full",
    /* Quiet vertical guide instead of stacked filled pills. */
    "turn-rail":
      "flex flex-col gap-1 pl-3 border-l border-l-rail-line w-full max-w-full",
    "turn-step-row": "flex flex-col w-full max-w-full min-w-0",
    /* Shared step geometry for narration / thought / tool rows inside the rail.
     * items-center vertically aligns the 12px Lucide chevron with text-11px /
     * leading-snug (items-start left the icon riding above the first line).
     * Same icon+label axis as shell-toggle. */
    "turn-step":
      "inline-flex items-center gap-1.5 w-full max-w-full border-none bg-transparent px-0 py-1 text-left text-11px leading-snug text-fg-faint transition-colors duration-fast ease-soft hover:text-fg-muted",
    /* Current step while streaming — the only place that carries a fill cue. */
    "turn-step-active": "text-fg-muted",
    /* Label next to the step chevron (thought / tool summary / single-line). */
    "turn-step-label": "min-w-0",
    /* Narration label: clamp + wrap; min-w-0 so flex can shrink. */
    "turn-step-note": "min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap break-words",
    "turn-step-body":
      "mt-1 rounded-9px bg-white-faint px-3 py-2.5 text-12px leading-snug text-fg-secondary whitespace-pre-wrap break-words",

    "item-thought":
      "max-w-full min-w-200px bg-transparent border-none text-fg-muted text-11px",
    "thought-group-segments": "flex flex-col gap-1.5 mt-1",
    "item-tool":
      "max-w-full bg-white-faint border-none rounded-shell px-3 py-2.5",
    "item-error":
      "max-w-full border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-danger-muted rounded-card px-3 py-2.5 text-danger text-13px",
    "tool-head":
      "flex justify-between items-center gap-2 mb-2 text-fg-secondary text-12px",
    /* Kind pill + title share the shrinkable half; the status badge never shrinks. */
    "tool-head-main": "flex min-w-0 flex-1 items-center",
    /* Path-free title: plain tail truncation, nothing better to preserve. */
    "tool-title": "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    /* Title around a path: flex row so path-label-dir absorbs the shrinking. */
    "tool-title-split":
      "flex min-w-0 items-baseline overflow-hidden whitespace-nowrap",
    /* Text around the path shrinks proportionally (a long shell command loses
     * far more than a short `Edit \`` prefix); only the file name never gives. */
    "tool-title-text":
      "min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap",
    "tool-kind-label":
      "inline-flex items-center rounded-pill bg-white-soft px-1.75 py-0.5 text-10px font-medium uppercase tracking-wide text-fg-muted mr-1.5",
    "tool-mcp":
      "font-mono text-11px text-fg-secondary",
    /* File path chips — must set bg/border or native button paints OS white-out */
    "tool-locations":
      "flex flex-col gap-1 mb-2 min-w-0 max-w-full",
    "tool-loc-link":
      "flex w-full max-w-full min-w-0 items-center gap-2 overflow-hidden text-left font-mono text-11px leading-snug px-2.5 py-1.25 rounded-8px border-none bg-high text-fg-secondary transition-colors duration-fast ease-soft hover:(bg-highest text-fg)",
    /* Path label: the directory is the only part allowed to lose characters. */
    "path-label": "flex min-w-0 items-baseline",
    "path-label-dir":
      "min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap text-fg-muted",
    /* Colour is inherited on purpose: the file name reads at the weight of
     * whatever hosts it (chip text, tool head, preview title heading). */
    "path-label-base": "shrink-0 whitespace-nowrap",
    /* Transient double-click-to-copy confirmation, pushed to the row end. */
    "path-copied-flag": "ml-auto shrink-0 text-10px text-fg-muted",
    "tool-content":
      "m-0 mt-1 max-h-64 overflow-auto font-mono text-11px leading-relaxed text-fg-secondary whitespace-pre-wrap break-words",
    "tool-error": "text-danger",
    /* Collapsed read/search/list groups (ToolGroupView) inside the turn rail. */
    "tool-group":
      "flex flex-col gap-1.5 max-w-full min-w-200px",
    badge:
      "text-10px px-1.75 py-0.5 rounded-pill bg-white-soft text-fg-secondary",
    "badge-pending": "bg-white-soft text-fg-secondary",
    "badge-failed": "bg-danger-muted text-danger",
    "badge-ok": "bg-white-soft text-fg-muted",
    "mini-diff":
      "font-mono text-11px border-none rounded-8px overflow-hidden bg-white-faint",
    "mini-diff-path":
      "px-2.5 py-1.25 text-fg-secondary border-b border-line-subtle break-all",
    "mini-diff-add":
      "bg-diff-add-bg text-diff-add px-2.5 py-0.5 whitespace-pre-wrap break-words",
    "mini-diff-del":
      "bg-diff-del-bg text-diff-del px-2.5 py-0.5 whitespace-pre-wrap break-words",
    "msg-chips": "flex flex-wrap gap-1.5 pt-0.5",
    "msg-chip":
      "inline-flex items-center gap-1.5 h-5.25 px-2.25 rounded-pill bg-white-faint text-fg-muted text-11px leading-none border-none transition-colors duration-fast ease-soft hover:(bg-white-soft text-fg-secondary)",

    /* ── Markdown (Streamdown custom components → these shortcuts) ──
     *
     * Two constraints shape this block:
     *   1. presetUno preflight is off, so UA defaults leak into every element
     *      Streamdown emits (blockquote's 40px inline margin, ul/ol padding,
     *      p/pre margins). Each shortcut must zero what it does not want.
     *   2. Streamdown puts its own Tailwind classes (`space-y-4`, …) on the
     *      wrapper, and nothing compiles them here — block rhythm has to come
     *      from `md-streamdown` itself, not from the library.
     */
    "md-root": "min-w-0",
    /* Sole owner of block rhythm: flex gap, so children can stay margin-free. */
    "md-streamdown":
      "min-w-0 w-full flex flex-col items-stretch gap-[0.7em] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "md-p": "m-0 whitespace-pre-wrap",
    /* Headings buy extra air above only; the flex gap covers below. */
    "md-h":
      "mx-0 mb-0 mt-[0.55em] font-semibold text-fg leading-snug tracking-tight",
    "md-h1": "text-[1.3em]",
    "md-h2": "text-[1.15em]",
    "md-h3": "text-[1.05em]",
    "md-h4": "text-[1em]",
    /* m-0: outer spacing is the flex gap; nested lists re-add their own. */
    "md-list":
      "m-0 pl-[1.45em] [&>li]:my-[0.28em] [&>li]:marker:text-fg-muted [&_ul]:mt-[0.28em] [&_ol]:mt-[0.28em]",
    "md-list-ordered": "list-decimal",
    "md-inline-code":
      "font-mono text-[0.88em] px-[0.4em] py-[0.12em] rounded-1.5 bg-white-faint text-fg",
    "md-pre":
      "m-0 px-3.5 py-3 overflow-x-auto rounded-shell bg-white-faint font-mono text-12px leading-relaxed text-fg [&>code]:(font-inherit whitespace-pre)",
    "md-link":
      "text-fg underline underline-offset-2 decoration-line-strong transition-colors duration-fast ease-soft hover:decoration-fg",
    /* mx-0 kills the UA `margin-inline: 40px` that pushed quotes off the text column. */
    "md-blockquote":
      "m-0 pl-[0.9em] border-l-2 border-line-strong text-fg-secondary",
    /* h-0 + border-top only: a bare `hr` also carries a UA inset frame. */
    "md-hr": "mx-0 my-[0.35em] h-0 border-t border-t-line-muted",
    "md-del": "text-fg-muted line-through",
    "md-img": "m-0 max-w-full h-auto rounded-soft",
    /* GFM tables — frame lives on the wrapper so the radius clips the corners
     * (a border-collapse table paints its own border over any rounding). */
    "md-table-wrap":
      "w-full max-w-full overflow-x-auto rounded-soft border border-line-muted",
    "md-table": "w-full border-collapse text-[0.95em] leading-snug",
    "md-thead": "bg-white-faint",
    "md-tr": "border-b border-line-subtle last:border-b-0",
    "md-th": "px-3 py-2 text-left font-semibold text-fg align-top",
    "md-td": "px-3 py-2 text-fg align-top",
};
