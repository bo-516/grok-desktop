# apps/shell — Wails v3 thin desktop shell

Thin host process for **Grok Desktop**. Spawns bridge-go as a **separate child process**, embeds the Vite-built React UI, injects a per-start bridge WebSocket URL, and kills the bridge process group on exit.

**Does not** contain ACP reduce / business logic.

## Version pin

| Dep | Version |
|---|---|
| **Wails** | **`v3.0.0-beta.6`** (pinned in `go.mod` — do not float `latest`) |
| Go | 1.25+ (matches Wails beta.6) |
| CLI | `~/go/bin/wails3 version` → `v3.0.0-beta.6` |

## Layout

```
apps/shell/
  main.go              # Wails app + lifecycle
  bridge_launcher.go   # spawn bridge-go, process-group kill
  config.go            # bridge.impl (go only) + GROK_DESKTOP_BRIDGE
  port_token.go        # free port + random token
  paths.go             # monorepo root / tsx / bridge-go discovery
  embed.go             # go:embed frontend/dist
  frontend/dist/       # copy of apps/desktop/dist (build step)
  build/               # sync-frontend.sh, build.sh
  bin/grok-desktop     # go build output
```

## Bridge selection (cold switch only)

1. Env **`GROK_DESKTOP_BRIDGE`** (wins when set). Empty or `go` starts bridge-go. `node` exits 1 with `node bridge was removed; unset GROK_DESKTOP_BRIDGE or set it to go`.
2. User config file `bridge.impl` / nested `bridge.impl` — same values
3. Default: **`go`**

Config file path:

- macOS: `~/Library/Application Support/grok-desktop/config.json`
- Linux: `$XDG_CONFIG_HOME/grok-desktop/config.json` or `~/.config/...`
- Windows: `%AppData%/grok-desktop/config.json`

## Session logs (crash diagnosis)

On every start the shell writes under:

| OS | Directory |
|---|---|
| macOS | `~/Library/Logs/grok-desktop/` |
| Linux | `$XDG_STATE_HOME/grok-desktop/logs` or `~/.local/state/grok-desktop/logs` |
| Windows | `%LOCALAPPDATA%/grok-desktop/logs` |

Per session:

- `shell-YYYYMMDD-HHMMSS.log` — shell + mirrored bridge/UI lines
- `bridge-….log` — bridge child stdout/stderr
- `ui-….log` — frontend boot/crash POSTs (`src=boot`, `react.boundary`, …)

**Retention:** files older than **12 hours** are deleted on the next start.

Black WebView? Check `ui-*.log` first (boot missing ⇒ JS never ran; `react.boundary` ⇒ render throw).

Example:

```json
{ "bridge.impl": "go" }
```

`{"bridge":{"impl":"node"}}` and `{"bridge.impl":"node"}` fail at startup. The shell does not rewrite the file.

Go bridge is the only implementation. If no binary is found under:

- `apps/bridge-go/bin/bridge`
- `apps/bridge-go/bridge`
- `bin/bridge-go`

the shell **errors clearly** (no silent fallback). The error includes `(cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge)`.

## What the shell passes to the bridge

| Env | Value |
|---|---|
| `BRIDGE_PORT` | Free port chosen at launch |
| `BRIDGE_TOKEN` | Random base64url secret |
| `BRIDGE_HOST` | `127.0.0.1` |
| `BRIDGE_ALLOWED_ORIGINS` | `null`, `file://`, `wails://localhost`, Vite dev origins, … |
| `BRIDGE_CWD` | Monorepo root in a checkout; `<Documents>/Grok` when packaged (or env override) |

Frontend receives:

```js
window.__GROK_BRIDGE_URL__ = "ws://127.0.0.1:<port>?token=<token>";
```

`apps/desktop` `defaultBridgeUrl()` reads this first (then `VITE_BRIDGE_URL`).

## Build

```bash
# 1) Frontend
npm run build -w @grok-desktop/desktop

# 2) Sync dist into embed tree
bash apps/shell/build/sync-frontend.sh

# 3) Go binary (CGO on for macOS WKWebView)
cd apps/shell
go mod tidy
go build -o bin/grok-desktop .
# or: bash build/build.sh
```

Binary: **`apps/shell/bin/grok-desktop`**

## Run

From the monorepo (shell discovers repo root via `apps/bridge-go/cmd/bridge/main.go`):

```bash
# Default: Go bridge (needs apps/bridge-go/bin/bridge-go)
./apps/shell/bin/grok-desktop

# Explicit Go
GROK_DESKTOP_BRIDGE=go ./apps/shell/bin/grok-desktop

# Optional workspace root for agent sessions
BRIDGE_CWD=/path/to/project ./apps/shell/bin/grok-desktop
```

## Tests

```bash
cd apps/shell
go test ./...
```

Covers config resolution (`go` default, `node` rejected), free port + token generation, env override for bridge spawn, inject JS escaping.

## Packaging notes

- `go:embed` cannot reach outside `apps/shell/`; always sync `apps/desktop/dist` → `apps/shell/frontend/dist` before `go build`.
- Bridge remains an external process in packaged builds so the UI can still be browser-debugged.
- On exit (window close / SIGINT / SIGTERM / `OnShutdown`): SIGTERM process group, then SIGKILL after grace (Unix `Setpgid`).

## Env blockers / requirements

| Need | Why |
|---|---|
| CGO + macOS SDK | Wails WKWebView |
| Go 1.25+ | bridge-go and the shell binary |
| Real `grok` CLI on PATH | Bridge product path (not mock) |
| Frontend dist present | Embed fails without `index.html` |
