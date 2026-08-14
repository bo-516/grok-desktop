[README](README.md) · [README (zh)](README.zh-CN.md)

# grok-desktop

> **Status: Work in progress (WIP)** — APIs, UI, and commands may change at any time; not recommended for production use.

Desktop ACP client for [grok-build](https://docs.x.ai/build/overview) — **do not rewrite the agent loop**; speak Agent Client Protocol over stdio.

| Doc | Topic |
|---|---|
| [`apps/bridge-go/README.md`](apps/bridge-go/README.md) | Go bridge env, pool, CLI channel |
| [`apps/shell/README.md`](apps/shell/README.md) | Wails host, config, logs |
| [`docs/design/ui-ux-agent-client.md`](docs/design/ui-ux-agent-client.md) | Shell IA and visual design |
| [`docs/protocol-freeze-relay-2026-08-10.md`](docs/protocol-freeze-relay-2026-08-10.md) | Bridge ↔ UI WebSocket relay |
| [`docs/qa/index.md`](docs/qa/index.md) | QA cases by surface |

## Product rule: real grok-build only

| Allowed | Forbidden (product / UI / acceptance) |
|---|---|
| `grok agent stdio` via `npm run bridge` / `npm run m0:live` / `npm run demo:e2e` | Mock agent UI, offline fixture as “session”, silent fallback to mock |
| Workspace demo under `demo/` | Pretending mock is a live agent |

Unit tests may use an in-process ACP mock for codec/timeline isolation only.

## Layout

```
packages/acp-core/   Pure protocol codec, timeline reducers, AcpClient
apps/bridge/         Node RuntimePool of real `grok agent stdio` + WebSocket
apps/bridge-go/      Go bridge (product default when the binary is present)
apps/desktop/        Vite + React shell (live-bridge only)
apps/shell/          Wails v3 host — own bridge process, embeds the UI
apps/m0/             CLI handshake (default: live only)
demo/                Constrained sandbox for `demo:e2e` / `m0:live`
```

## Prerequisites

- Node.js ≥ 20
- **Required for product use**: `grok` on PATH (or `~/.grok/bin/grok`) with `grok login` / auth
  - Auth: `grok login` (writes `~/.grok/auth.json`) **or** env `XAI_API_KEY`
  - UI shows an auth banner when the bridge reports missing credentials
- **Optional, for the Go bridge / desktop window**: Go 1.25+
  - `cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge`
  - Wails shell: see [`apps/shell/README.md`](apps/shell/README.md)

## Install

```bash
npm install
```

## Run (real agent)

UI is three columns: **session rail · timeline · Plan / Agents**. Composer sits under the transcript.

```bash
# Terminal A — real grok-build (prefers go-bridge; Node if the binary is missing)
# Default workspace = this checkout. Override with BRIDGE_CWD=…
npm run bridge

# Terminal B — web UI (auto-connects to the bridge; no mock)
npm run dev
```

Open http://localhost:8172.

One process for **web + desktop** (Vite HMR and a Wails window; each owns its own live bridge):

```bash
npm run run:both
# Node bridge instead of Go: npm run run:node-both
# Interactive menu (web / desktop / both × Go / Node): npm run run:dev
```

| Command | What |
|---|---|
| `npm run bridge` | Go binary if `apps/bridge-go/bin/bridge-go` exists, else Node |
| `npm run dev` | Vite web UI on `:8172` |
| `npm run run:both` | Go: Vite web + Wails desktop (two isolated bridges) |
| `npm run run:go-web` / `run:node-web` | One web UI + matching bridge |
| `npm run run:go-desktop` / `run:node-desktop` | Wails window (shell spawns its own bridge) |

### Workspace

- **Dev (this checkout, unset `BRIDGE_CWD`)**: monorepo root so chats sit next to the code
- **Packaged / no source tree**: `Documents/Grok` on macOS, Windows, and Linux
- **`demo/`**: constrained sandbox for `demo:e2e` / `m0:live` only — not the default chat cwd

### What you get

- **Multi-session**: one `grok agent stdio` process per live session; background chats keep streaming
- **LRU pool**: default capacity **8** (`BRIDGE_POOL_CAPACITY`); only **idle** sessions are reclaimed; full+busy waits for a free slot
- **Session rail**: project groups, a standalone no-project section, status pips (including background live), inline rename, “Show more”
- **Cold open**: disk `chat_history` / `updates.jsonl` paints immediately; `session/load` still resumes the real agent
- **Fan-out**: harness children stay off the rail; inspect them in the **Agents** companion without leaving the parent canvas
- **Timeline**: streaming markdown (fences, lists, bold/code), Shiki, KaTeX, tool cards, native diff review, document preview
- **Composer**: Enter to send, Shift+Enter for newline; Ask / Plan / Build; Thinking; `/model` `/effort` `/fork` `/rewind`; follow-up queue; context-usage ring; weekly remaining
- **⌘K**: actions, settings, slash stubs, MCP servers, and skills (sessions stay in the rail)
- Bridge down → offline banner; history still shown; **auto-reconnect every 3s** (footer Reconnect still works)

### Dev: ai-inspector (⌘-click → Grok Build)

Desktop **dev** embeds a vendored [ide-byebye](https://github.com/dravenLee/ide-byebye) build (`apps/desktop/vendor/ai-inspector/`) so you can pick a rendered element, describe the change, and hand off to **Grok Build** (and other agents) without leaving the UI. No external checkout is required.

- **Hotkey**: `Alt+Shift+I` toggles picker mode
- **Click**: hold ⌘ (macOS) / Ctrl (elsewhere) and click a component
- **Enter** in the intent dialog defaults to **Grok Build**; handoff `cwd` is the monorepo root
- Source `@` refs are monorepo-relative (`@apps/desktop/…`); screenshots / stills use **absolute** paths (configurable via `pathStyle` / `artifactPathStyle`)
- Artifacts land under `apps/desktop/.intent-inspector/` (gitignored)

### Live e2e (stdio, tools, subagent)

```bash
npm run demo:e2e
# log: demo/e2e-last-run.log
```

### M0 handshake (live)

```bash
M0_CWD="$(pwd)/demo" npm run m0:live
```

`npm run m0` is live-only (no mock fallback). `--mock` exists only for isolated protocol experiments and prints a warning.

## Tests

```bash
npm run test:all
npm run typecheck
npm run lint
```

Protocol unit tests may use mock transports; they do not replace live agent acceptance.

## Core APIs

```ts
import {
  AcpClient,
  applySessionUpdate,
  mergeBridgeSnapshot,
  parseBillingResponse,
  parseTokenUsageRpc,
} from "@grok-desktop/acp-core";
```

- `tool_call_update` **patch-merges** into `toolCalls[toolCallId]`
- Session status: `idle` | `streaming` | `waiting_permission` | `disconnected`
- Empty Go-bridge `state` frames keep client-owned timeline / goal / subagent maps
- Occupancy (`contextTokensUsed`) is preserved across `turn_completed` billed counters
