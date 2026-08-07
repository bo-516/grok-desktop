# grok-desktop

> **Status: 正在开发中（WIP）** — API、UI 与命令可能随时变更，暂不建议生产使用。

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
apps/bridge/         Spawns real `grok agent stdio` + WebSocket for UI
apps/m0/             CLI handshake (default: live only)
apps/desktop/        Vite + React shell (live-bridge only)
demo/                Constrained workspace for live demos
```

## Prerequisites

- Node.js ≥ 20
- **Required for product use**: `grok` on PATH (or `~/.grok/bin/grok`) with `grok login` / auth

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

- **New chat** / sidebar sessions: grouped by project, full history, click to resume (`session/load`)
- Composer: Enter to send, Shift+Enter for newline; Ask/Plan/Build chip
- Bridge down → offline banner; history still shown; reconnect via footer "Connect live grok"

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
