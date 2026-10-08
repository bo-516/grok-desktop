# bridge-go

Go implementation of the grok-desktop local bridge. This is the only bridge process.

**Hard constraints**

- Spawns real `grok agent stdio` only — no mock agent product path
- Does **not** port timeline reduce; forwards raw `session_update` to the UI
- Session ops (`set_model`, `set_mode`, `compact`, `token_usage`, `fork_session`) and the CLI channel are the product protocol
- `check_environment` marks `ok=false` when `grok --version` is missing, unparseable, below `0.9.0`, or silent for 15s (reported as a timeout, not as unparseable), even if the user is logged in

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
| `GROK_BIN` | `~/.grok/bin/grok` or `PATH` | grok CLI path |
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
| UI → bridge | `get_state` | on-demand full snapshot (carries `epoch` + `headSeq`) |
| UI → bridge | `resync` | `{sessionId, epoch, fromSeq}` → `resync_result` (`ok` + frames verbatim, or `too_old` / `epoch_mismatch`) |

Per-session frames (`session_update`, `session_lifecycle`, `state`, `replay_*`) carry `epoch` (one per agent runtime; a respawn / reload is a new epoch) and `seq` (monotonic per session + epoch, from 1). A bounded ring (1024 frames / 4 MiB per stream, `internal/sessionstream`) serves `resync`. Hydrate frames also carry `provenance` (`started` + echoed `startId`, `resumed`, or `child` + `parentSessionId` from an explicit `subagent_spawned` link).

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
