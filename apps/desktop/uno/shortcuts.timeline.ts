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
     * In-turn spacing is turn-block gap-3; rail steps use turn-rail gap-1.
     * min-w-0 + overflow-x-hidden: overflow-y:auto makes overflow-x compute
     * to auto, so a wide fence used to paint a horizontal bar across the
     * whole middle column. Fences wrap; this clip is the last resort.
     * bg-timeline: the scroller owns the canvas fill (matches `.main`). */
    timeline:
      "flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-timeline px-container pt-5 pb-5 flex flex-col gap-7 w-full",
    empty:
      "m-auto text-center text-fg-muted px-6 py-12 flex flex-col items-center gap-2",
    "empty-title":
      "m-0 text-18px font-medium tracking-tight text-fg-secondary",
    "empty-sub": "m-0 text-13px leading-snug text-fg-muted max-w-md",
    "msg-user-wrap": "flex flex-col items-end w-full gap-1.5",
    /* Sent image strip (above the text bubble); mirrors composer attach thumbs.
     * Tile is a locked 80×80 box (min=max=w/h) so a decoded screenshot's
     * intrinsic size cannot grow the flex item and shove the whole timeline. */
    "msg-user-attachments":
      "flex flex-wrap justify-end items-start gap-2 m-0 p-0 list-none max-w-[min(80%,48rem)]",
    "msg-user-attachment":
      "relative shrink-0 w-20 h-20 min-w-20 min-h-20 max-w-20 max-h-20 rounded-12px overflow-hidden border border-line-subtle bg-white-faint",
    /* Full-tile hit target opens shared ImageLightboxView. */
    "msg-user-attachment-open":
      "relative block w-full h-full min-w-0 min-h-0 p-0 m-0 border-0 bg-transparent cursor-zoom-in text-inherit overflow-hidden",
    /* Out of flow: width/height attrs + inset fill; never contributes min-content. */
    "msg-user-attachment-thumb":
      "absolute inset-0 block w-full h-full max-w-full max-h-full object-cover pointer-events-none",
    "msg-user-attachment-fallback":
      "flex items-center justify-center w-full h-full px-1 text-10px text-fg-muted text-center leading-tight break-all",
    "item-user":
      "max-w-[min(80%,48rem)] px-3.75 py-2.75 rounded-bubble bg-user text-fg text-body-md tracking-tight whitespace-pre-wrap break-words",
    "msg-time":
      "text-12px leading-none text-fg-secondary opacity-85 px-0.5",
    "msg-agent-wrap": "flex justify-start w-full",
    /* relative + z: Copy sits in a reserved bottom pad (see msg-agent-inner-actions)
     * so it never paints over the next timeline unit ("Worked for …").
     * hover/focus-within z-2: keeps the row above a following Worked-for header while
     * the pointer is on Copy (otherwise the next unit steals hover and hides it). */
    "msg-agent-inner":
      "relative z-0 w-full flex flex-col gap-2.5 hover:z-2 focus-within:z-2",
    /* pb = msg-actions chrome (~26px) + a little air above Copy so the
     * button does not sit flush against the last answer line.
     * Only applied when the Copy row exists — process/tool rows stay tight. */
    "msg-agent-inner-actions": "pb-9",
    "item-agent":
      "p-0 min-w-0 max-w-full text-body-md tracking-tight text-fg break-words",
    /* Absolute inside the agent pad (bottom-0). Opacity still hides the chrome
     * when idle so the pad reads as quiet air under the answer only. Snaps
     * on hover / focus — no opacity transition. */
    "msg-actions":
      "absolute left-0 bottom-0 z-1 flex items-center gap-0.5 px-0 py-0.5 opacity-0 pointer-events-none group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto)",
    "msg-action-btn":
      "border-none bg-transparent text-fg-muted text-12px px-2 py-1.25 rounded-7px transition-colors duration-fast ease-soft hover:(text-fg bg-white-faint)",
    /* Rail header only — shell-toggle is not used for nested thought/tool steps.
     * Codex-style: full-width row, label left-aligned, chevron on the right,
     * rule under the button (head groups button+rule so parent gap stays clean). */
    "shell-toggle-head": "flex flex-col w-full max-w-full",
    "shell-toggle":
      "flex w-full max-w-full items-center gap-1.5 min-h-8 px-0 py-2 border-none bg-transparent text-left font-normal text-11px leading-tight transition-colors duration-normal ease-soft",
    "shell-toggle-live": "text-fg-muted hover:text-fg-secondary",
    "shell-toggle-done": "text-fg-faint hover:text-fg-muted",
    /* Label left-aligned; chevron sits to its right (Codex “已处理 3m >”). */
    "shell-toggle-label": "min-w-0 text-left",
    /* Full-width hairline under the Worked-for header (always, open or closed). */
    "shell-toggle-rule": "w-full h-0 border-0 border-t border-t-line-muted",
    /* Lucide 12×12 slot — block + fixed box kills SVG baseline drift vs label text. */
    "shell-chevron": "block w-3 h-3 shrink-0 text-fg-faint",

    /* One turn = activity rail + final answer; inter-turn gap is on .timeline. */
    "turn-block": "flex flex-col gap-3 w-full",
    /* Quiet vertical guide instead of stacked filled pills.
     * Max height tracks the viewport (50vh) so long tool/thought stacks do not
     * push the final answer off-screen; floor at 280px so short viewports still
     * get a usable pane; overflow scrolls inside the rail only.
     * Agents inspect (`.agents-transcript`) lifts max-h + overflow so the
     * 300px drawer has one scroller — the timeline — not a mid-pane bar. */
    "turn-rail":
      "flex flex-col pl-3 pb-2 border-l border-l-rail-line w-full max-w-full min-h-0 max-h-[max(280px,min(50vh,560px))] overflow-y-auto overscroll-contain",
    /* Growing inner: ResizeObserver target for live stick-to-bottom. Gap
     * lives here (not on the port) so the observer sees thought/tool growth. */
    "turn-rail-body": "flex flex-col gap-1 w-full max-w-full min-w-0",
    "turn-step-row": "flex flex-col w-full max-w-full min-w-0",
    /* Shared step geometry for narration / thought / tool rows inside the rail.
     * items-center vertically aligns the 12px Lucide chevron with text-12px /
     * leading-snug (items-start left the icon riding above the first line).
     * Chevron stays before the label (nested rows); shell-toggle is the reverse.
     * One step above meta chrome (11px) so thought process stays readable without
     * matching the 15px answer body. */
    "turn-step":
      "inline-flex items-center gap-1.5 w-full max-w-full border-none bg-transparent px-0 py-1 text-left text-12px leading-snug text-fg-faint transition-colors duration-fast ease-soft hover:text-fg-muted",
    /* Current step while streaming — the only place that carries a fill cue. */
    "turn-step-active": "text-fg-muted",
    /* Label next to the step chevron (thought / tool summary / single-line). */
    "turn-step-label": "min-w-0",
    /* Narration label: clamp + wrap (4 lines ≈ 2× the old 2-line default);
     * min-w-0 so flex can shrink without horizontal overflow. */
    "turn-step-note": "min-w-0 flex-1 line-clamp-4 whitespace-pre-wrap break-words",
    /* No fill: rail body sits on the canvas; a rounded chip fought the quiet
     * Codex-style Worked rail (only the final answer / user bubble should read
     * as a surface). Padding keeps the text from hugging the left guide.
     * 13px: slight step up from the 12px label so expanded thought body is easy
     * to scan without competing with the 15px final answer. */
    "turn-step-body":
      "mt-1 px-0 py-1 text-13px leading-snug text-fg-secondary whitespace-pre-wrap break-words",

    "item-thought":
      "max-w-full min-w-200px bg-transparent border-none text-fg-muted text-12px",
    /* Live thought row: one shimmering word (ShinyText owns the color sweep). */
    "thought-live-label": "font-medium tracking-tight",

    /* ── Live-turn strip (composer dock, mounted while streaming) ──
     *
     * Lives above the input card, not as a sticky child of `.timeline`.
     * A sticky pill inside that scroller sat on the last answer line, and
     * `bg-inherit` computed to transparent so the answer painted through it.
     *
     * Content-width pill, not a full-width bar: it reads as a status line
     * above the composer instead of a second toolbar. max-w-full + a
     * truncating detail keep long tool titles from widening the column.
     *
     * The fill must stay OPAQUE (bg-timeline, never inherit / white-*):
     * ShinyText uses a transparent glyph fill, and isolate keeps that
     * compositing against the pill. mb-2 separates it from the input card.
     */
    "turn-status":
      "relative z-10 isolate mb-2 ml-0.5 flex w-fit max-w-full items-center gap-2 rounded-pill bg-timeline px-3 py-1.5 shadow-float animate-turn-status-in",
    /* Radar ping + solid core; fixed 8px box so the pill height never shifts. */
    "turn-status-orb":
      "relative flex h-2 w-2 shrink-0 items-center justify-center",
    "turn-status-orb-ping":
      "absolute inset-0 rounded-full bg-primary animate-turn-orb-ping",
    "turn-status-orb-core": "relative h-1.5 w-1.5 rounded-full bg-primary",
    /* Shimmer owns the color (ShinyText background-clip) — no text-* here. */
    "turn-status-verb":
      "shrink-0 text-12px font-medium tracking-tight leading-4",
    "turn-status-detail":
      "min-w-0 truncate text-11px leading-4 text-fg-muted font-mono",
    "turn-status-meta": "flex shrink-0 items-center gap-1.5 pl-0.5",
    "turn-status-time": "text-11px leading-4 text-fg-secondary tabular-nums",
    "turn-status-dot": "text-11px leading-4 text-fg-faint",
    "turn-status-kbd":
      "inline-flex h-4 items-center rounded-kbd bg-kbd px-1 font-sans text-10px leading-none text-fg-muted",
    /* Hint text drops first on narrow columns; the kbd chip carries the meaning. */
    "turn-status-hint": "text-10px leading-4 text-fg-faint max-[520px]:hidden",
    "thought-group-segments": "flex flex-col gap-1.5 mt-1",

    /* L1 inline subagent fan-out group inside the turn rail */
    "subagent-group": "w-full max-w-full",
    "subagent-group-body": "flex flex-col gap-1 mt-1 pl-0.5",
    "subagent-step":
      "flex flex-col gap-0.5 w-full min-w-0",
    "subagent-step-openable": "",
    "subagent-step-main":
      "flex items-center gap-1.5 w-full min-w-0 text-left text-11px leading-snug text-fg-secondary",
    "subagent-step-label": "min-w-0 flex-1 truncate text-fg",
    "subagent-step-meta": "shrink-0 text-10px text-fg-muted tabular-nums",
    "subagent-step-output-toggle":
      "self-start text-10px text-fg-muted px-1 py-0.5",
    "subagent-step-output":
      "mt-1 max-h-48 overflow-y-auto text-12px text-fg-secondary",
    "tool-status-dot":
      "inline-block w-1.5 h-1.5 rounded-full shrink-0",
    "tool-status-completed": "bg-success",
    "tool-status-failed": "bg-danger",
    "tool-status-in_progress": "bg-primary",
    "tool-status-pending": "bg-fg-faint",
    "top-nav-back-btn":
      "shrink-0 text-11px text-fg-secondary px-1.5 py-0.5",
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
    /* Path label: the directory is the only part allowed to lose characters
     * on the default one-line chip. Preview head uses the *-wrap variants. */
    "path-label": "flex min-w-0 items-baseline",
    "path-label-dir":
      "min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap text-fg-muted",
    /* Colour is inherited on purpose: the file name reads at the weight of
     * whatever hosts it (chip text, tool head, preview title heading). */
    "path-label-base": "shrink-0 whitespace-nowrap",
    /* Preview-head wrap: both halves may break; flex-wrap drops the file
     * name onto the next line before either half is clipped. */
    "path-label-wrap": "flex-wrap w-full max-w-full",
    "path-label-dir-wrap": "min-w-0 max-w-full break-all text-fg-muted",
    "path-label-base-wrap": "min-w-0 max-w-full break-all",
    /* Transient double-click-to-copy confirmation, pushed to the row end. */
    "path-copied-flag": "ml-auto shrink-0 text-10px text-fg-muted",
    "tool-content-wrap": "mt-1 flex flex-col gap-1 min-w-0",
    "tool-content":
      "m-0 max-h-64 overflow-auto font-mono text-11px leading-relaxed text-fg-secondary whitespace-pre-wrap break-words",
    /* Large JSON / dumps start collapsed so the activity rail stays scannable. */
    "tool-content-collapsed": "max-h-28 overflow-hidden",
    "tool-content-toggle":
      "self-start border-none bg-transparent p-0 m-0 text-11px text-fg-muted cursor-pointer hover:text-fg focus-visible:(outline-none ring-2 ring-[var(--color-focus-ring)] rounded-4px)",
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
     *
     * Document preview uses a separate `doc-*` namespace (uno/shortcuts.doc.ts):
     * agent chat needs em sizes, soft-break preserve, hidden hr; disk docs need
     * absolute sizes, CommonMark soft-break fold, visible hr. Do not merge them.
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
    /* Slightly under body size so mono stays readable without dominating the line;
     * padding is in em of the chip font so the pill tracks the size bump.
     * Chip fill (white-chip 9%) is stronger than pre (white-code 5%) so small
     * inline chrome matches the panel's visual weight. */
    "md-inline-code":
      "font-mono text-[0.93em] px-[0.42em] py-[0.14em] rounded-1.5 bg-white-chip text-fg",
    /* Wrap (do not scroll-x): a nowrap fence's min-content width used to
     * drag the whole transcript sideways. Tokens inherit wrap via code-wrap. */
    "md-pre":
      "m-0 max-w-full min-w-0 px-3.5 py-3 overflow-x-hidden rounded-shell bg-white-code font-mono text-12px leading-relaxed text-fg code-wrap [&>code]:font-inherit",
    "md-link":
      "text-fg underline underline-offset-2 decoration-line-strong transition-colors duration-fast ease-soft hover:decoration-fg",
    /* mx-0 kills the UA `margin-inline: 40px` that pushed quotes off the text column. */
    "md-blockquote":
      "m-0 pl-[0.9em] border-l-2 border-line-strong text-fg-secondary",
    /* Thematic breaks: fully hidden for now (agent `---` must not read as shell
     * chrome). If product later wants real section rules, delete only `hidden`
     * below — the rest already keeps height 0 / no border as a soft fallback. */
    "md-hr": "hidden mx-0 my-[0.55em] h-0 border-none",
    "md-del": "text-fg-muted line-through",
    "md-img": "m-0 max-w-full h-auto rounded-soft",
    /* GFM tables — one signal only: thead soft fill + row hairlines (no outer
     * border). Radius still clips overflow on the wrap. */
    "md-table-wrap": "w-full max-w-full overflow-x-auto rounded-soft",
    "md-table": "w-full border-collapse text-[0.95em] leading-snug",
    "md-thead": "bg-white-soft border-b border-line-subtle",
    "md-tr": "border-b border-line-subtle last:border-b-0",
    "md-th": "px-3 py-2 text-left font-semibold text-fg align-top",
    "md-td": "px-3 py-2 text-fg align-top",
};
