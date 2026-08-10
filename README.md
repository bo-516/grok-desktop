# grok-desktop

> **Status: Work in progress (WIP)** — APIs, UI, and commands may change at any time; not recommended for production use.

Desktop ACP client for [grok-build](https://docs.x.ai/build/overview) — **do not rewrite the agent loop**; speak Agent Client Protocol over stdio.

## Product rule: real grok-build only

| Allowed | Forbidden (product / UI / acceptance) |
|---|---|
| `grok agent stdio` via `npm run bridge` / `npm run m0:live` / `npm run demo:e2e` | Mock agent UI, offline fixture as “session”, silent fallback to mock |
| Workspace demo under `demo/` | Pretending mock is a live agent |

Unit tests may use an in-process ACP mock for codec/timeline isolation only.

## Layout

```
packages/acp-core/   Pure protocol codec, timeline reducers, AcpClient
apps/bridge/         RuntimePool of real `grok agent stdio` + WebSocket for UI
apps/m0/             CLI handshake (default: live only)
apps/desktop/        Vite + React shell (live-bridge only)
demo/                Constrained workspace for live demos
```

## Prerequisites

- Node.js ≥ 20
- **Required for product use**: `grok` on PATH (or `~/.grok/bin/grok`) with `grok login` / auth
  - Auth: `grok login` (writes `~/.grok/auth.json`) **or** env `XAI_API_KEY`
  - UI shows an auth banner when the bridge reports missing credentials

## Install

```bash
npm install
```

## Run (real agent)

UI layout follows the Framer prototype (left sessions · chat · bottom composer).

```bash
# Terminal A — real grok-build, cwd=demo/
npm run bridge

# Terminal B — UI (auto-connects to bridge; no mock)
npm run dev
```

Open http://localhost:8172.

- **Multi-session**: one `grok agent stdio` process per live session; background chats keep streaming
- **LRU pool**: default capacity **4** (`BRIDGE_POOL_CAPACITY`); only **idle** sessions are reclaimed
- **New chat** / sidebar: project groups, status pips (including background live), `session/load` resume
- **Streaming markdown** in agent bubbles (fences, lists, bold/code while tokens still arrive)
- Composer: Enter to send, Shift+Enter for newline; Ask/Plan/Build chip
- Bridge down → offline banner; history still shown; reconnect via footer

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
```

Protocol unit tests may use mock transports; they do not replace live agent acceptance.

## Core APIs

```ts
import {
  AcpClient,
  applySessionUpdate,
  patchToolCard,
} from "@grok-desktop/acp-core";
```

- `tool_call_update` **patch-merges** into `toolCalls[toolCallId]`
- Session status: `idle` | `streaming` | `waiting_permission` | `disconnected`

## Design

See `docs/design/ui-ux-agent-client.md`.
