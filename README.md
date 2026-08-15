[README](README.md) · [README (zh)](README.zh-CN.md)

# grok-desktop

A desktop client for [grok-build](https://docs.x.ai/build/overview). It speaks Agent Client Protocol (ACP) over stdio to a real `grok agent stdio` process — the agent loop stays in grok-build; this is the window onto it.

## Download

| Platform | Download | Then |
|---|---|---|
| **macOS** — Apple silicon + Intel | [**Grok-Desktop-macos-universal.zip**](https://github.com/bo-516/grok-desktop/releases/latest/download/Grok-Desktop-macos-universal.zip) | Unzip, drag **Grok Desktop.app** to `/Applications` |
| **Windows** — x64 | [**Grok-Desktop-windows-amd64.zip**](https://github.com/bo-516/grok-desktop/releases/latest/download/Grok-Desktop-windows-amd64.zip) | Unzip, keep both `.exe` files in one folder, run `grok-desktop.exe` |
| **Linux** | build from source | Wails needs cgo + webkit2gtk — see [Build a release](#build-a-release) |

Every version: [Releases](https://github.com/bo-516/grok-desktop/releases).

**First, install the agent.** The app is a window onto the real `grok` CLI, so it has to be on PATH (or at `~/.grok/bin/grok`) and signed in with `grok login` — or set `XAI_API_KEY`. Without it the bridge starts and the UI shows an auth banner.

**macOS**: builds are ad-hoc signed, not notarized, so Gatekeeper blocks the first launch. Clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/Grok Desktop.app"
```

**Windows 10** also needs the [Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/); Windows 11 ships with it.

> Hit a bug or want a feature? Please [open an issue](https://github.com/bo-516/grok-desktop/issues).

| Doc | Topic |
|---|---|
| [`apps/bridge-go/README.md`](apps/bridge-go/README.md) | Go bridge env, pool, CLI channel |
| [`apps/shell/README.md`](apps/shell/README.md) | Wails host, config, logs |
| [`docs/design/ui-ux-agent-client.md`](docs/design/ui-ux-agent-client.md) | Shell IA and visual design |
| [`docs/protocol-freeze-relay-2026-08-10.md`](docs/protocol-freeze-relay-2026-08-10.md) | Bridge ↔ UI WebSocket relay |
| [`docs/qa/index.md`](docs/qa/index.md) | QA cases by surface |

## Real grok-build only

| Allowed | Never |
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

## Build a release

```bash
bash scripts/build-release.sh          # both targets → release/
bash scripts/build-release.sh mac      # or: windows
```

Produces `release/Grok-Desktop-macos-universal.zip` (ad-hoc signed `.app`, arm64 + x86_64) and `release/Grok-Desktop-windows-amd64.zip`.

Every bundle carries **two** binaries: the Wails shell (with the Vite build embedded) and the Go bridge it spawns as a child process. The shell looks for the bridge in `Contents/Resources` on macOS and next to its own `.exe` on Windows — see [`apps/shell/paths.go`](apps/shell/paths.go).

Windows cross-compiles from macOS: Wails reaches WebView2 through `go-winloader`, so no cgo toolchain is involved. **Linux cannot be cross-compiled** — its webview binding needs cgo plus `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`. On a Linux host:

```bash
npm run build -w @grok-desktop/desktop
bash apps/shell/build/sync-frontend.sh
(cd apps/shell && CGO_ENABLED=1 go build -o bin/grok-desktop .)
(cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge)
```

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
