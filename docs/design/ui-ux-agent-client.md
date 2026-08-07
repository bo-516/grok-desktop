# grok-desktop UI/UX Design

> **Scope**: visual & interaction design only — layout, IA, component inventory, tokens, and critical states.  
> **Not in scope**: Tauri/ACP implementation, protocol wiring, packaging.  
> **Product source**: `todo.md` (ACP desktop client over `grok agent stdio`).  
> **Engineering constraints**: `AGENTS.md` (colors via `defineColor.css`, shadcn/UnoCSS, widget patterns).  
> **Reference products**: OpenAI Codex app, Claude Code Desktop, Google Antigravity (Manager / Editor).

---

## 1. Design north star

Build a **native agent command surface**, not a chat website and not a full IDE.

| Principle | Meaning for this product |
|---|---|
| **Supervise first** | Default UI optimizes for watching many agent turns (status, tool cards, plan, permission) — Codex “command center” / Antigravity Manager density. |
| **Structured stream, not scrollback** | Timeline is typed events (`user` / `agent` / `thought` / `tool` / `error`), not a terminal dump. |
| **Trust via review** | Diffs, permissions, and mode badges are first-class; never hide sandbox reality behind decorative UI. |
| **Dark-first agent tool** | Dense, quiet chrome; high-contrast streaming content; semantic surfaces only (no ad-hoc hex in TSX). |
| **Thin client honesty** | UI renders ACP events; intelligence stays in CLI. Disconnect / mode-switch latency is visible, not papered over. |

**MVP positioning vs references**

| Product | We borrow | We deliberately defer |
|---|---|---|
| **Claude Code Desktop** | Session sidebar as mission control; multi-pane *entry points* (chat + plan + diff + terminal); permission modes; project-grouped sessions | Full drag-and-drop pane IDE, browser pane, iOS simulator, Verbose/Summary transcript modes |
| **Codex app** | Agent orchestration sidebar; in-thread tool/diff review; parallel session status; “command center” chrome density | Git worktree isolation UI, PR automations, computer-use |
| **Antigravity** | Agent-first density (Manager feel); plan/artifacts as side panel; supervise multi-stream work without living in a file tree | Separate Editor product surface; multi-agent Manager beyond multi-session; browser/recording artifacts |

**MVP shell = one window, three columns** (session rail | conversation + composer | context rail). Secondary panes (diff, terminal, settings) open as overlays or replace the context rail — not a free-form IDE mosaic in M1–M3.

---

## 2. Information architecture

### 2.1 Primary surfaces (from `todo.md`)

| # | Surface | Role | ACP / data source |
|---|---|---|---|
| A | **Session list / Mission Control** | Create, switch, monitor parallel sessions; show status dots | SQLite metadata + live `Session.status` |
| B | **Conversation timeline** | Ordered stream of user / agent / thought / tool / error | `session/update` variants |
| C | **Tool cards** | Structured tool UI by `kind` (read / edit / execute / search / …) | `tool_call` + `tool_call_update` patch map |
| D | **Plan panel** | Right-rail task list; whole-replace on update | `plan` update |
| E | **Permission flow** | Modal + sticky banner; four outcomes | `session/request_permission` |
| F | **Mode & model chrome** | Ask / Plan / Build + model picker + workspace rules badge | `set_mode` / `set_model` / `current_mode_update` / AGENTS.md hit |
| G | **Composer** | Prompt, @file, attachments, slash hints, send / cancel | `session/prompt`, `available_commands_update` |
| H | **Diff review** | Side-by-side / unified edit review; accept path | `tool_call` content `type: "diff"` |
| I | **Environment / system chrome** | CLI missing, auth, disconnect, stderr diagnostics | `check_environment`, `acp://exit`, `acp://stderr` |

### 2.2 Session status model

Maps 1:1 to `todo.md` frontend model:

| Status | User-visible meaning | Chrome |
|---|---|---|
| `idle` | Ready for input | Composer enabled; no progress pulse |
| `streaming` | Turn in flight (prompt sent and/or chunks still arriving) | Stop button; streaming cursor on last agent block; session list pulse |
| `waiting_permission` | Agent blocked on user decision | Permission modal + banner; composer disabled for send |
| `disconnected` | Runtime exited unexpectedly | Banner “Agent disconnected · Reconnect”; timeline frozen until reconnect |

**Streaming end rule** (product, not protocol): leave `streaming` only when `session/prompt` response has returned **and** update queue has been quiet for ~N ms (e.g. 150–300 ms). Cancel keeps receiving late tool updates.

### 2.3 Mode model (Ask / Plan / Build)

| UI mode | Intent | Shell / write / network (product promise) | Visual |
|---|---|---|---|
| **Ask** | Q&A, no side effects | No shell, no write; network ok | Cool badge, muted primary |
| **Plan** | Read-only exploration + plan | Read only; no shell/write | Neutral / indigo badge |
| **Build** | Full agent work | Workspace (or off) sandbox; write + shell ok | Warm / accent badge |

Mode switch may take 2–3 s (process restart + `session/load`). Show **blocking toast / rail spinner**: “Switching to Build…” — never silently claim a mode the process is not running under.

### 2.4 Default regions (ASCII wireframe)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● ● ●   grok-desktop          [ workspace /path… ▾ ]  [Model▾] [Mode▾]  │  ← Title / session toolbar
├──────────┬───────────────────────────────────────────┬───────────────────┤
│ Sessions │  Timeline (virtualized)                   │ Plan / Context    │
│          │                                           │                   │
│ [+] New  │  ┌ user ────────────────────────────────┐ │ ○ Plan steps     │
│          │  │ prompt + chips                       │ │ ○ …              │
│ Project  │  └──────────────────────────────────────┘ │                   │
│  · sessA │  ┌ thought ▸ collapsed ─────────────────┐ │ ── Diffs (N) ──  │
│  · sessB │  └──────────────────────────────────────┘ │  path.ts +12−3   │
│    ◉ run │  ┌ tool: edit src/x.ts  [completed] ────┐ │                   │
│  · sessC │  │ mini diff / open full review         │ │ ── Rules ──────  │
│          │  └──────────────────────────────────────┘ │  AGENTS.md ✓     │
│          │  ┌ agent ───────────────────────────────┐ │                   │
│ ───      │  │ markdown stream ▌                    │ │                   │
│ Settings │  └──────────────────────────────────────┘ │                   │
│          │                                           │                   │
│          ├───────────────────────────────────────────┤                   │
│          │ Composer                                  │                   │
│          │ [@ file] [attach]  /slash…                │                   │
│          │ ┌─────────────────────────────────────┐   │                   │
│          │ │ Ask anything…                       │   │                   │
│          │ └─────────────────────────────────────┘   │                   │
│          │              [Stop]  or  [Send ⏎]         │                   │
└──────────┴───────────────────────────────────────────┴───────────────────┘
```

**Region sizes (MVP defaults)**

| Region | Width | Collapsible |
|---|---|---|
| Session rail | 240–280 px | Yes → icon rail |
| Main column | flex 1 | No |
| Context rail | 280–360 px | Yes; auto-open when `plan` arrives or user opens Diffs |

---

## 3. Pattern ← product mapping

| UI pattern in grok-desktop | Borrowed from | Concrete adoption for MVP |
|---|---|---|
| **Session list as Mission Control** | Claude Code Desktop (multi-session sidebar, project grouping); Codex (agent orchestration sidebar) | Left rail: sessions grouped by workspace path; live status pip; parallel sessions keep streaming in background |
| **Command-center density** | Codex “command center for agents” | Quiet chrome, status-first session rows, tool cards over chat bubbles; no marketing hero empty state |
| **Tool cards + visual diff** | Codex (review changes in thread / right sidebar diffs); Claude (diff pane) | Inline collapsible tool card with mini-diff; “Open review” expands full diff surface |
| **Permission modes** | Claude Code Desktop (permission / autonomy modes) | Top-bar Ask / Plan / Build mapped to sandbox profiles; permission modal with Allow once / Always this tool / Deny / Deny & stop |
| **Multi-pane workspace (entry points)** | Claude Code Desktop (chat, diff, terminal, plan panes) | MVP: chat always center; Plan+Diffs in context rail; Terminal as bottom drawer or tab in context rail — not free-form mosaic |
| **Agent Manager vs chat-only** | Antigravity Manager surface (supervise agents, artifacts/plans) | Product *feels* like Manager: session fleet + plan artifacts + async status. **No** separate Editor IDE in this client — external editor / path open only |
| **Plan as artifact panel** | Antigravity artifacts; Claude plan pane | Right rail plan list whole-replaced from `plan` updates; steps show pending / active / done |
| **In-thread structured tools** | Codex + Claude | `toolCalls` map + timeline pointers; patch-merge on `tool_call_update` |
| **Disconnect honesty** | Agent-tool products generally | Explicit reconnect banner; do not fake connected idle |

---

## 4. Visual system & tokens

### 4.1 Token rules (hard)

- All colors live in `src/styles/defineColor.css` as CSS variables: `--color-*`, `--gradient-*`, `--shadow-*`.
- **TSX must not use** color literals (`#fff`, `rgb()`, named colors), color-bearing inline styles, or raw color utility classes (`text-white`, `bg-black`, `border-red-500`, …).
- Implementation maps semantic roles below → registered variables, then UnoCSS / shadcn primitives bridged to those variables (per `AGENTS.md`).

### 4.2 Semantic surface roles

| Role | CSS variable (planned name) | Usage |
|---|---|---|
| App canvas | `--color-bg-app` | Window background |
| Raised surface | `--color-bg-surface` | Session rail, context rail, cards |
| Elevated / popover | `--color-bg-elevated` | Menus, permission modal, command palette |
| Timeline canvas | `--color-bg-timeline` | Main scroll area (slightly different from rails for depth) |
| Composer surface | `--color-bg-composer` | Input dock |
| Border default | `--color-border-default` | Region separators, card outlines |
| Border strong | `--color-border-strong` | Focused card, permission modal ring |
| Text primary | `--color-text-primary` | Body, agent markdown |
| Text secondary | `--color-text-secondary` | Meta, timestamps, paths |
| Text muted | `--color-text-muted` | Placeholders, disabled |
| Accent / primary action | `--color-accent` | Send, primary CTAs |
| Accent hover | `--color-accent-hover` | Button hover |
| Accent muted | `--color-accent-muted` | Soft highlight backgrounds |
| Danger | `--color-danger` | Errors, deny, disconnect |
| Warning | `--color-warning` | Auth / version mismatch banners |
| Success | `--color-success` | Completed tools, applied diffs |
| Streaming | `--color-streaming` | Pulse / cursor / session “running” pip |
| Thought surface | `--color-bg-thought` | Collapsed thought block |
| Tool card surface | `--color-bg-tool` | Tool card body |
| Diff add | `--color-diff-add` / `--color-diff-add-bg` | + lines |
| Diff del | `--color-diff-del` / `--color-diff-del-bg` | − lines |
| Mode Ask | `--color-mode-ask` | Mode badge |
| Mode Plan | `--color-mode-plan` | Mode badge |
| Mode Build | `--color-mode-build` | Mode badge |
| Shadow modal | `--shadow-modal` | Permission dialog |
| Shadow popover | `--shadow-popover` | @ / slash menus |

**Dark-first defaults (illustrative HSL for `defineColor.css` only — not for TSX):**

- Canvas ~ `hsl(220 14% 8%)`, surface ~ `hsl(220 12% 11%)`, elevated ~ `hsl(220 12% 14%)`.
- Text primary ~ `hsl(210 20% 96%)`, secondary ~ `hsl(215 10% 65%)`.
- Accent: product brand (xAI-adjacent cool or warm — pick one in `defineColor.css` and stick to it); avoid rainbow chrome.
- Diff: green/red at reduced saturation suitable for dark UI; never pure neon.

Light mode: map the same roles later; MVP ships dark only.

### 4.3 Density & typography

| Token | Guidance |
|---|---|
| Base font | System UI stack; 13–14 px body |
| Mono | For paths, tool output, diffs: 12–13 px tabular |
| Session row height | 44–52 px |
| Timeline vertical rhythm | 12–16 px between items |
| Tool card padding | 10–12 px; radius 8–10 px |
| Composer min height | ~88 px; grows with content to ~40% viewport then scrolls |
| Radius | Controls 6–8 px; cards 8–10 px; modal 12 px |
| Focus ring | 2 px `--color-accent` outline, offset 2 px |

### 4.4 Hierarchy

1. **Timeline content** (agent text, tool results) — highest visual weight.  
2. **Composer** — always reachable, sticky bottom of main column.  
3. **Session status pips / mode badge** — glanceable in peripheral vision.  
4. **Rails chrome** — quieter than content; borders over heavy fills.  
5. **Decorative** — none required for MVP.

### 4.5 Motion (minimal)

- Streaming cursor blink on last incomplete agent block.
- Session pip soft pulse while `streaming`.
- Permission modal: short fade + scale (150–200 ms); no bounce.
- No confetti, no full-page skeleton theater.

---

## 5. Component inventory (MVP shell)

Naming follows planned widget style (`*View` stateless / `*Widget` stateful) — inventory is UX-level, not a module tree commitment.

### 5.1 Shell

| Component | Kind | Responsibility |
|---|---|---|
| `AppShellView` | Stateless | Three-region layout + optional bottom drawer slot |
| `TitleBarChromeView` | Stateless | Traffic lights area (macOS `hiddenInset`), workspace path, model, mode |
| `SessionRailWidget` | Stateful | List, create, select, group by workspace |
| `SessionRowView` | Stateless | Title, path snippet, status pip, mode chip |
| `MainColumnView` | Stateless | Timeline + composer stack |
| `ContextRailWidget` | Stateful | Tabs: Plan / Diffs / Rules (and later Terminal) |
| `SystemBannerView` | Stateless | Disconnect, CLI missing, version warning, mode-switch |

### 5.2 Timeline

| Component | Kind | Responsibility |
|---|---|---|
| `TimelineWidget` | Stateful | Virtual list; rAF-batched append; stick-to-bottom |
| `UserMessageView` | Stateless | Blocks: text, resource chips, image thumbs |
| `AgentMessageView` | Stateless | Incremental markdown; streaming caret |
| `ThoughtBlockView` | Stateless | Default collapsed; expand for full thought |
| `ToolCardView` | Stateless | Kind icon, title, status, body by kind |
| `ToolCardEditView` | Stateless | Mini unified diff + “Open review” |
| `ToolCardExecuteView` | Stateless | Collapsed terminal log; expand |
| `ToolCardReadView` | Stateless | Single-line path + line range |
| `ErrorItemView` | Stateless | Danger surface; optional retry |
| `UnknownEventView` | Stateless | Graceful unknown `sessionUpdate` |

### 5.3 Plan & context

| Component | Kind | Responsibility |
|---|---|---|
| `PlanPanelView` | Stateless | Ordered steps with status glyphs |
| `DiffListView` | Stateless | Paths with +/− counts; open review |
| `RulesBadgeView` | Stateless | AGENTS.md / CLAUDE.md hit indicator + peek |

### 5.4 Permission

| Component | Kind | Responsibility |
|---|---|---|
| `PermissionModalWidget` | Stateful | Focus trap; four options; keyboard 1–4 |
| `PermissionBannerView` | Stateless | Sticky under toolbar while waiting |
| `PermissionOptionView` | Stateless | Label + short consequence text |

### 5.5 Composer

| Component | Kind | Responsibility |
|---|---|---|
| `ComposerWidget` | Stateful | Draft, send, cancel, paste image, drop files |
| `ComposerEditorView` | Stateless | Multiline textarea / contenteditable |
| `AttachmentChipView` | Stateless | File / image chip with remove |
| `AtFilePickerWidget` | Stateful | Fuzzy file list on `@` |
| `SlashCommandMenuView` | Stateless | From `available_commands_update` |
| `SendStopButtonView` | Stateless | Send when idle; Stop when streaming |

### 5.6 Mode / model / diff

| Component | Kind | Responsibility |
|---|---|---|
| `ModeSwitcherView` | Stateless | Segmented Ask / Plan / Build |
| `ModelPickerView` | Stateless | List from `availableModels` |
| `DiffReviewWidget` | Stateful | Full side-by-side / unified; hunk navigation |
| `DiffHunkView` | Stateless | Line chrome; optional accept (M3+) |

### 5.7 Primitives (shadcn)

Button, Dialog, DropdownMenu, Tabs, Tooltip, ScrollArea, Badge, Separator, Command (for @ / slash). Business CTAs go through shared `AppButtonView` pattern when implemented.

---

## 6. Key screens & flows

### 6.1 First launch / environment gate

1. Splash or blank shell → `check_environment`.  
2. **CLI missing**: full-page empty state — install commands + “Open docs” + path override field.  
3. **Not authed**: banner + “Run `grok login`” / set key via secure settings (never show key in timeline).  
4. **OK**: empty session rail + centered “New session” CTA.

### 6.2 New session

1. User clicks **New** → picker: folder (workspace) + model + mode.  
2. Optimistic session row (`streaming` or loading) → `start_session`.  
3. On success: select session, empty timeline with composer focus + mode/model chrome filled.  
4. On failure: row error state + toast; do not leave ghost “running” sessions.

### 6.3 Send prompt (happy path)

1. User types (+ optional @files / images) → **Send**.  
2. Append `user` timeline item immediately (optimistic).  
3. Status → `streaming`; Stop visible.  
4. Events: thought (collapsed) → plan (context rail) → tool cards → agent chunks.  
5. Turn settles → `idle`; composer re-enabled; scroll pin if user was at bottom.

### 6.4 Permission

1. Status → `waiting_permission`; **modal centers**; banner also appears (if modal dismissed accidentally, banner reopens).  
2. Body: tool title, kind, path/command summary, risk line by mode.  
3. Options:  
   - **Allow once**  
   - **Always allow this tool** (workspace-scoped memory)  
   - **Deny**  
   - **Deny and stop** (deny + cancel turn)  
4. Response → continue stream or end; status leaves `waiting_permission`.

### 6.5 Mode switch

1. User picks new mode on toolbar.  
2. Confirm if mid-stream (“Cancel turn and switch?”).  
3. System banner: switching… (2–3 s).  
4. Timeline may re-hydrate via `session/load`; show subtle “Session reloaded under Build”.  
5. Mode badge updates only after success.

### 6.6 Open diff review

1. From edit tool card or Diffs list → **Open review**.  
2. Diff surface replaces context rail (or opens large modal ~80% viewport on narrow windows).  
3. Side-by-side default for wide; unified for narrow.  
4. Close returns to previous context tab.

### 6.7 Disconnect / reconnect

1. `acp://exit` → status `disconnected`; danger banner; composer send disabled.  
2. **Reconnect** → re-acquire runtime + `session/load`; banner clears; timeline appends continuity notice if gaps possible.

### 6.8 Cancel turn

1. **Stop** → `session/cancel`; keep `streaming` until quiet; late tool updates still patch cards.  
2. Show subtle “Cancelled” footer on the interrupted agent block.

---

## 7. State matrix

| State | Session rail | Timeline | Composer | Context rail | Overlays / banners |
|---|---|---|---|---|---|
| **Empty app** (no sessions) | Empty + New | Centered empty: “Start a session with a workspace” | Hidden or disabled | Hidden | Optional env warnings |
| **Session idle** | Selected row static | History; bottom spacer | Enabled Send | Plan if present | — |
| **Streaming** | Pip pulse on active | Growing agent/tool; caret | Stop; no Send | Live plan updates | — |
| **Waiting permission** | Pip “blocked” (warning color) | Last tool pending | Disabled send | Unchanged | **Permission modal + banner** |
| **Disconnected** | Pip danger | Frozen | Disabled send | Frozen | **Reconnect banner** |
| **Env error** (no CLI) | Disabled | Full-page install guide | Hidden | Hidden | — |
| **Mode switching** | Dimmed | Dimmed / non-interactive | Disabled | Dimmed | Switching banner |
| **Loading session** (cold open) | Selected | Skeleton or cached SQLite messages | Disabled until ready | Skeleton | Thin top progress |

---

## 8. Surface detail specs

### 8.1 Session list (Mission Control)

**Inspired by**: Claude multi-session sidebar + Codex agent sidebar.

- Group header = workspace basename + truncated path.  
- Row: title (auto from first user message or “New session”), relative time, **status pip**, tiny mode letter (A/P/B).  
- Hover: reveal close / pin (pin optional post-MVP).  
- Background sessions that are `streaming` keep pulsing — user can switch away without killing work (RuntimePool).  
- Context menu: rename, reveal in Finder, close, copy session id (debug).

### 8.2 Timeline + tool cards

**Inspired by**: Codex in-thread review + Claude structured tool visibility.

| Timeline item | Default presentation |
|---|---|
| `user` | Right-weighted or full-width card with secondary surface; attachment chips |
| `agent` | Full-width prose; markdown; code fences copy button |
| `thought` | Single line “Thinking” chevron; expanded mono/prose secondary |
| `tool` | Card with kind icon (read / edit / execute / search / fetch / think), status badge (pending / in_progress / completed / failed) |
| `error` | Danger border + message |

**Tool card rules**

- Identity is `toolCallId`; updates are **patch merge** (status-only updates must not wipe content).  
- `edit`: show first ~8 lines of unified diff; overflow “+N lines · Open review”.  
- `execute`: collapsed to exit code + last line; expand = scrollable log (not full xterm until Terminal panel).  
- `read` / `search`: dense one-liners; expand for full payload if large.  
- Failed: danger status + stderr snippet.

### 8.3 Plan panel

**Inspired by**: Antigravity plan/artifact panel + Claude plan pane.

- Appears when first `plan` update arrives (auto-open context rail if collapsed).  
- Whole list replace (not incremental merge).  
- Step rows: index, title, status icon (todo / active / done).  
- Empty: “No plan yet — Plan mode often produces one.”

### 8.4 Permission

**Inspired by**: Claude permission modes + explicit agent-tool consent UX.

- Modal is **blocking** for the session (not global app) — other sessions remain usable.  
- Keyboard: `Enter` = Allow once (safe default), `Esc` = Deny (not Always).  
- Copy is concrete: “Allow write to `src/foo.ts`?” not “Allow tool?”.  
- “Always allow this tool” scope = **current workspace**, not global.

### 8.5 Composer

**Inspired by**: Claude/Codex desktop composers with @ and attachments.

- Placeholder: “Message grok…  (@ to attach files, / for commands)”.  
- `@` → file fuzzy picker (respect .gitignore via bridge).  
- Drag/drop & paste image → attachment chips → ACP content blocks.  
- Slash menu from `available_commands_update`.  
- Cmd/Ctrl+Enter send; Enter = newline (agent tools prefer multi-line prompts).  
- While streaming: primary button is **Stop** (danger outline).

### 8.6 Mode & model chrome

- **Model**: dropdown of `availableModels`; show display name; custom models from CLI config appear automatically.  
- **Mode**: segmented control Ask | Plan | Build with color tokens.  
- **Workspace rules**: chip when `AGENTS.md` / `CLAUDE.md` present; click opens read-only peek.  
- Placement: session toolbar (right of title bar content), not buried in settings.

### 8.7 Diff review

**Inspired by**: Codex right-side diffs + Claude diff pane — GUI value over TUI `+/-`.

- List: path, +add/−del counts, tool status.  
- Detail: CodeMirror-style dual pane; line numbers; syntax optional for MVP.  
- M1: view-only is acceptable if writes go through agent; M3: accept/reject / write-through per `todo.md` option B.  
- Never use red/green text without also using background tokens (colorblind-safe pair of markers).

---

## 9. Empty, loading, error copy (concise)

| Situation | Title | Body / CTA |
|---|---|---|
| No sessions | Start working with grok | Choose a workspace folder to open a session. **[New session]** |
| Empty timeline | Ready | Describe a task, or attach files with @. |
| CLI missing | Grok CLI not found | Install or set path. |
| Auth missing | Sign in required | Run `grok login` or configure API key in Settings. |
| Disconnected | Agent disconnected | The agent process exited. **[Reconnect]** |
| Permission | Permission required | Agent wants to {action}. Choose an option to continue. |
| Unknown event | Unsupported event | Protocol update ignored; session continues. |

---

## 10. Accessibility & input (MVP bar)

- Full keyboard: session list arrows, composer focus (`/ ` or `c`), Escape closes menus/modals.  
- Focus visible via token ring.  
- Prefer text + icon status, not color alone (pip + label tooltip).  
- Reduced motion: disable pulse, keep static badges.  
- Contrast: secondary text must remain readable on surface tokens (verify when defining CSS vars).

---

## 11. Out of scope for this design goal

- Implementing React/Tauri/ACP runtime.  
- Pixel clones of Claude / Codex / Antigravity branding or proprietary assets.  
- Full multi-pane drag layout, browser preview, iOS simulator, cloud remote sessions.  
- Multi-agent Manager beyond multi-session mission control.  
- Light theme parity, formal a11y certification, rich motion system.

---

## 12. Implementation handoff notes

When M1 UI starts:

1. Create `src/styles/defineColor.css` with §4.2 roles first.  
2. Shell regions before polish.  
3. Timeline + tool card patch map before markdown perfection.  
4. Permission modal before pretty empty states.  
5. Diff review can ship view-only after tool cards.  
6. Follow `AGENTS.md`: shadcn primitives, no color literals in TSX, Stateful widgets thin.

This document is the single UI/UX source of truth for the MVP shell.

---

## Appendix A — Region map (narrow window)

Below ~1000 px width: collapse context rail to icon buttons; Diff review becomes full-screen modal; session rail becomes overlay drawer.

## Appendix B — Event → UI quick map

| `sessionUpdate` | UI target |
|---|---|
| `user_message_chunk` | User bubble (history replay) |
| `agent_message_chunk` | Agent message append |
| `agent_thought_chunk` | Thought block |
| `tool_call` | New tool card + timeline pointer |
| `tool_call_update` | Patch existing card |
| `plan` | Plan panel replace |
| `available_commands_update` | Slash menu data |
| `current_mode_update` | Mode badge sync |
