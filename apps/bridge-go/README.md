# bridge-go

Go implementation of the grok-desktop local bridge (T0+T1+T2 of the dual-bridge plan).

Matches the frozen relay WebSocket protocol in
[`docs/protocol-freeze-relay-2026-08-10.md`](../../docs/protocol-freeze-relay-2026-08-10.md).

**Hard constraints**

- Spawns real `grok agent stdio` only — no mock agent product path
- Does **not** port timeline reduce; forwards raw `session_update` to the UI
- Session ops (`set_model`, `set_mode`, `compact`, `token_usage`, `fork_session`) and the full CLI channel match the Node bridge protocol surface

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
| `BRIDGE_CWD` | repo `demo/` or cwd | Default workspace |
| `BRIDGE_ALWAYS_APPROVE` | unset | `1` → auto-approve tool permission with `allow_once` |
| `BRIDGE_POOL_CAPACITY` | `4` | Max concurrent agent processes (1–16) |
| `GROK_BIN` | `~/.grok/bin/grok` or `PATH` | grok CLI path |
| `XAI_API_KEY` | — | Auth source for agent + environment probe |

Missing `Origin` is allowed (non-browser clients). Illegal Origin → **403**. Missing/wrong token → **401**.

## Hello message

```json
{
  "type": "hello",
  "cwd": "…",
  "port": 8765,
  "poolCapacity": 4,
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
internal/spawn/      grok process tree (setpgid on posix; Job Object stub on Windows)
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
| `compact` / `token_usage` / `fork_session` | ACP RPC (`token_usage` / `fork_session` reply on `cli_result`) |
| `cli` → `sessions_list` | disk walk under `~/.grok/sessions` |
| `cli` → `inspect` / `mcp_*` / `worktree_*` / `auth_*` / … | one-shot `grok` via `spawn.RunGrokCli` |
| `cli` → `prompts_*` | disk user-prompts store |
| `cli` → `mcp_stderr_log` | read `~/.grok/logs/mcp` |

## Pool capacity

| Variable | Default | Cap |
|---|---|---|
| `BRIDGE_POOL_CAPACITY` | `4` | max `16` (min effective `1`) |

Concurrent `start` / crash recovery uses `BeginSpawn` reservations so resident + in-flight processes never exceed capacity.
