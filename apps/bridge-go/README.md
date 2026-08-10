# bridge-go

Go implementation of the grok-desktop local bridge (T0+T1+T2 of the dual-bridge plan).

Matches the frozen relay WebSocket protocol in
[`docs/protocol-freeze-relay-2026-08-10.md`](../../docs/protocol-freeze-relay-2026-08-10.md).

**Hard constraints**

- Spawns real `grok agent stdio` only — no mock agent product path
- Does **not** port timeline reduce; forwards raw `session_update` to the UI
- T3 features (`set_model`, `set_mode`, `compact`, `token_usage`, `cli`, …) return an explicit error with a **switch to Node bridge** hint

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
internal/acp/        NDJSON codec, line framing, thin ACP client + handshake
internal/spawn/      grok process tree (setpgid on posix; Job Object stub on Windows)
internal/pool/       RuntimePool LRU
internal/wsapi/      WS server, auth, message routing
internal/reverse/    fs read/write, terminal registry, path guards
internal/session/    disk list, workspace entries, crash recovery seeds
```

## Relay hot path

| Direction | Message | Notes |
|---|---|---|
| bridge → UI | `session_update` | raw ACP update + optional `eventId` |
| bridge → UI | `session_lifecycle` | status / permission / model / mode without full timeline |
| bridge → UI | `state` | hydrate only (start, reconnect, get_state, permission) |
| UI → bridge | `get_state` | on-demand full snapshot |

## T3 (not implemented)

Requests `set_model`, `set_mode`, `compact`, `token_usage`, and `cli` respond with:

```text
<feature> is not available on the Go bridge (switch to Node bridge for this feature)
```
