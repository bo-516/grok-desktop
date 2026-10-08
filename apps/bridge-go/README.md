# bridge-go

Go implementation of the grok-desktop local bridge. This is the only bridge process.

**Hard constraints**

- Spawns real `grok agent stdio` only — no mock agent product path
- Does **not** port timeline reduce; forwards raw `session_update` to the UI
- Session ops (`set_model`, `set_mode`, `compact`, `token_usage`, `fork_session`) and the CLI channel are the product protocol
- `check_environment` marks `ok=false` when `grok --version` is missing, unparseable, below `0.9.0`, or silent for 15s (reported as a timeout, not as unparseable), even if the user is logged in
- Every failed probe carries a structured `failureKind` (`not_installed`, `bin_invalid`, `probe_timeout`, `version_unreadable`, `too_old`, `signed_out`) plus the install / update commands for the host (`setup`); the desktop branches on these, never on `message`
- `grok_setup_run {runId, action: "install"|"update"}` runs the official installer (`curl -fsSL https://x.ai/cli/install.sh | bash`, Windows `irm https://x.ai/cli/install.ps1 | iex`) or `grok update` and streams `grok_setup_started` / `grok_setup_output` / `grok_setup_exit`; the client sends only the action, never a command line. `grok_setup_cancel {runId}` stops it
- `grok_bin_get` / `grok_bin_set {path}` read and validate the custom grok path, stored in `<UserConfigDir>/grok-desktop/grok-cli.json` and re-read on every spawn (no restart)

## Build

```bash
cd apps/bridge-go
go build -o bin/bridge-go ./cmd/bridge
```

## Test

```bash
cd apps/bridge-go
go test ./...
```

## Run

```bash
./bin/bridge-go
# or
go run ./cmd/bridge
```

On start the process prints a machine-readable ready line on **stderr**:

```text
[bridge] ready {"host":"127.0.0.1","port":8765,"token":"…","impl":"go","version":"0.1.0"}
```

Connect the desktop UI with:

```text
ws://127.0.0.1:<port>?token=<token>
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_HOST` | `127.0.0.1` | Bind host |
| `BRIDGE_PORT` | `8765` | Bind port (`0` = ephemeral) |
| `BRIDGE_TOKEN` | random | Shared secret (`?token=` / `X-Bridge-Token` / `Authorization: Bearer`) |
| `BRIDGE_ALLOWED_ORIGINS` | Vite dev + `null` + `file://` | Comma-separated Origin allow-list |
| `BRIDGE_CWD` | monorepo root in a checkout; `<Documents>/Grok` when packaged | Default workspace |
| `BRIDGE_ALWAYS_APPROVE` | unset | `1` → auto-approve tool permission with `allow_once` |
| `BRIDGE_POOL_CAPACITY` | `8` | Max concurrent agent processes (1–16); full+busy waits for a free slot |
| `GROK_BIN` | custom path from Settings, then `~/.grok/bin/grok` (`grok.exe` on Windows), then `PATH` | grok CLI path; wins over the Settings path, and a missing / non-executable value is an error rather than a fallback |
| `XAI_API_KEY` | — | Auth source for agent + environment probe |

Missing `Origin` is allowed (non-browser clients). Illegal Origin → **403**. Missing/wrong token → **401**.

## Hello message

```json
{
  "type": "hello",
  "cwd": "…",
  "port": 8765,
  "poolCapacity": 8,
  "impl": "go",
  "version": "0.1.0"
}
```

## Layout

```text
cmd/bridge/          process entry
pkg/jsonrpc/         NDJSON JSON-RPC 2.0 framing (codec + line splitter)
pkg/workspacepath/   workspace path sandbox + read guards
pkg/envfilter/       grok child env whitelist
pkg/bridgeauth/      token / Origin / listen-port helpers
internal/acp/        thin ACP client + handshake (uses pkg/jsonrpc)
internal/spawn/      grok process tree (setpgid on posix; kill-on-close Job Object on Windows)
internal/pool/       RuntimePool LRU
internal/wsapi/      WS server, message routing (auth re-exports pkg/bridgeauth)
internal/reverse/    fs read/write, terminal registry (uses pkg/workspacepath)
internal/session/    disk list, workspace entries, crash recovery seeds
```

## Relay hot path

| Direction | Message | Notes |
|---|---|---|
| bridge → UI | `session_update` | raw ACP update + optional `eventId` |
| bridge → UI | `session_lifecycle` | status / permission / model / mode without full timeline |
| bridge → UI | `state` | hydrate only (start, reconnect, get_state, permission) |
| UI → bridge | `get_state` | on-demand full snapshot |

## Session ops & CLI channel

| Request | Status |
|---|---|
| `set_model` / `set_mode` | ACP RPC; `restart_required` on method-not-found |
| `compact` / `token_usage` / `billing` / `fork_session` | ACP RPC (`token_usage` / `billing` / `fork_session` reply on `cli_result`) |
| `cli` → `sessions_list` | disk walk under `~/.grok/sessions` |
| `cli` → `inspect` / `mcp_*` / `worktree_*` / `auth_*` / … | one-shot `grok` via `spawn.RunGrokCli` |
| `cli` → `prompts_*` | disk user-prompts store |
| `cli` → `mcp_stderr_log` | read `~/.grok/logs/mcp` |

## Pool capacity

| Variable | Default | Cap |
|---|---|---|
| `BRIDGE_POOL_CAPACITY` | `8` | max `16` (min effective `1`) |

Concurrent `start` / crash recovery uses `BeginSpawn` reservations so resident + in-flight processes never exceed capacity.
When the pool is full and every resident is busy, `BeginSpawn` / `Insert` **wait** (poll idle status / close) instead of returning a pool-full error.
