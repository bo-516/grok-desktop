# grok-build Desktop Client Implementation Plan

> Goal: build a native desktop client similar to Claude Desktop / Codex App that wraps `grok-build` (xAI's terminal coding agent) as a GUI.
> Core conclusion: **do not rewrite the agent loop; implement yourself as an ACP client.**

---

## 0. TL;DR Architecture

```
┌───────────────────────────────────────────────┐
│  UI layer  React 19 + Vite + Tailwind + Zustand│
│  Session list / message stream / tool cards / Diff / terminal │
└───────────────┬───────────────────────────────┘
                │ Tauri invoke(commands) + emit(events), strongly typed
                ▼
┌───────────────────────────────────────────────┐
│  Rust bridge layer (src-tauri)                 │
│  ├ GrokRuntime  : one subprocess = one ACP connection │
│  ├ RuntimePool  : multi-session parallel + LRU reclaim │
│  ├ AcpCodec     : NDJSON / JSON-RPC 2.0 codec  │
│  └ ClientImpl   : reverse services fs/* terminal/* permissions │
└───────────────┬───────────────────────────────┘
                │ subprocess stdin/stdout (newline-framed)
                ▼
┌───────────────────────────────────────────────┐
│  grok agent stdio  (upstream CLI, used as-is) │
│  agent loop / tools / context / MCP / skills  │
└───────────────────────────────────────────────┘
```

One-liner: **UI only renders the event stream; Rust only shuttles JSON-RPC; all intelligence lives in the upstream CLI.**

---

## 1. Approach choice: why ACP is required

| Option | Approach | Fatal issue |
|---|---|---|
| A. Call `api.x.ai/v1` directly | Write your own agent loop, tool calls, context compression | Equals rewriting grok-build and always lagging upstream; tool/plan/permission all reimplemented by you |
| B. Wrap a PTY / tmux webview | Stuff the TUI into a webview | You are still reading scrollback, get no structured events, cannot do diff review or permission dialogs |
| C. headless `-p --output-format streaming-json` | Single-turn NDJSON events | Fine for scripts/CI, but **one-shot**: no session lifecycle, no reverse requests (when the agent needs to read files or ask permission it cannot call back) |
| **D. ACP over stdio** ✅ | `grok agent stdio`, bidirectional JSON-RPC 2.0 | The only way to get the full event surface |

After `grok agent stdio` starts it is an **Agent Client Protocol** server:
the agent streams via `session/update` (text deltas, thinking, tool calls, plan, mode changes),
the client sends commands via `session/prompt`, `session/cancel`, `session/set_model`, etc.,
**and the agent will call you back** (read/write files, open terminals, request permissions).

> ACP is an open protocol led by Zed (Apache-2.0). The same client code can later plug into Claude Code / Gemini CLI / OpenCode and other ACP agents — that is the biggest strategic value of choosing it.

---

## 2. Tech stack

### 2.1 Shell: Tauri 2 instead of Electron

| | Tauri 2 | Electron |
|---|---|---|
| Installer size | ~8–15 MB | ~150 MB |
| Idle memory | ~80 MB | ~300 MB |
| WebView | System native (WKWebView / WebView2) | Bundled Chromium |
| Backend language | Rust | Node.js |
| IPC | Typed function calls | JSON over IPC |

The real reason to pick Tauri is not "lightweight", but:

1. **The bridge layer should be Rust anyway.** Long-lived subprocesses, backpressure, process pools, graceful SIGTERM shutdown — Rust is more comfortable than Node; using Electron means maintaining both Rust and Node in one repo.
2. Distribution size matters a lot for developer tools.
3. On macOS, native WebView + `titleBarStyle: hiddenInset` feels more like a native app.

Trade-off: Windows needs the MSVC toolchain (GitHub Actions `windows-latest` has it built-in; no extra CI cost).

> If the team has no Rust capacity, Electron + Node `child_process` is fully viable; the protocol-layer logic in chapter 4 is identical — only the language changes.

### 2.2 Frontend stack

- React 19 + Vite + TypeScript
- **Zustand** for state (sessions are "streaming high-frequency writes"; Redux immutability cost is not worth it at token-level updates)
- Tailwind + shadcn/ui
- `@codemirror/*` for diff / file preview, `xterm.js` for embedded terminal
- `streaming-markdown` or a custom incremental markdown renderer (**do not re-run a full markdown parse on every token**)

---

## 3. Prerequisite: manage the CLI as a dependency

Health-check chain when the client starts:

```
1. Locate the grok executable
   - PATH
   - ~/.grok/bin/grok  (default location of the official install script)
   - Windows: %USERPROFILE%\.grok\bin\grok.exe
   - Path the user entered manually in settings
2. grok --version  → validate minimum version, record on the settings page
3. Not installed → guide install:
   macOS/Linux: curl -fsSL https://x.ai/cli/install.sh | bash
   Windows:     irm https://x.ai/cli/install.ps1 | iex
   or fall back to npx @xai-official/grok agent stdio (no local install; first run is slow)
4. Auth state check: whether ~/.grok/auth.json exists / whether XAI_API_KEY is set
```

**You must pass `--no-auto-update` to the subprocess**: otherwise CLI background self-update prints noise in your spawned process or even swaps the binary mid-run. You can also set `auto_update = false` under the `[cli]` section of `~/.grok/config.toml`.

---

## 4. Protocol layer: full ACP flow (the most critical chapter)

### 4.1 Transport and framing

- Transport: subprocess stdin/stdout
- Framing: **newline-delimited JSON (NDJSON)** — one JSON-RPC 2.0 message per line; no LSP-style `Content-Length` headers
- Capture stderr separately into the log panel (auth failures and sandbox errors all depend on it)

Three message kinds:
- **Request** (has `id`, expects a reply)
- **Response** (`result` or `error`)
- **Notification** (no `id`, no reply — e.g. `session/update`, `session/cancel`)

⚠️ **Bidirectional**: you are both client and server. `fs/read_text_file`, `terminal/create`, `session/request_permission` are requests **the agent sends to you**; if you do not reply, the whole turn freezes.

### 4.2 Method inventory

**Client → Agent**

| Method | Type | Description |
|---|---|---|
| `initialize` | req | Negotiate `protocolVersion`, exchange capabilities, return `authMethods` / `availableModels` |
| `authenticate` | req | Pass `methodId` (e.g. `xai.api_key` / `cached_token`) |
| `session/new` | req | Pass `cwd`, `mcpServers`, return `sessionId` |
| `session/load` | req | Resume a historical session; the agent replays history as `session/update` |
| `session/prompt` | req | Send one turn of user input, return `stopReason` (body text goes on the update stream) |
| `session/cancel` | notif | Interrupt the current turn |
| `session/set_model` | req | Switch model (requires agent to declare modelSelector capability) |
| `session/set_mode` | req | Switch run mode |

**Agent → Client**

| Method | Type | Description |
|---|---|---|
| `session/update` | notif | **Main event stream**, see 4.4 |
| `session/request_permission` | req | Request authorization (write files, run commands); you must return the user's choice |
| `fs/read_text_file` | req | Requires you declare `fs.readTextFile` |
| `fs/write_text_file` | req | Requires you declare `fs.writeTextFile` |
| `terminal/create` / `output` / `wait_for_exit` / `kill` / `release` | req | Requires you declare `terminal: true` |

### 4.3 Handshake sequence

```
Client                                  Agent (grok agent stdio)
  │── initialize ────────────────────────▶│
  │◀── { protocolVersion, agentCapabilities, authMethods, availableModels }
  │── authenticate { methodId } ─────────▶│
  │── session/new { cwd, mcpServers } ───▶│
  │◀── { sessionId }
  │── session/prompt { sessionId, prompt }▶│
  │◀── session/update (agent_thought_chunk)
  │◀── session/update (plan)
  │◀── session/update (tool_call  status=pending)
  │◀── session/request_permission ────────│  ← you must show a dialog and reply
  │── { outcome: { outcome:"selected", optionId:"allow_once" } } ▶│
  │◀── session/update (tool_call_update status=in_progress → completed)
  │◀── session/update (agent_message_chunk) × N
  │◀── PromptResponse { stopReason: "end_turn" }
```

Auth branch logic (copy this decision order for reliability):

```ts
const methods = new Set((init.authMethods ?? []).map(m => m.id));
const methodId =
  process.env.XAI_API_KEY && methods.has("xai.api_key") ? "xai.api_key"
  : methods.has("cached_token") ? "cached_token"
  : null;
if (!methodId) throw new Error("Please run grok login first, or set XAI_API_KEY");
```

> **Security red line**: do not put API keys in localStorage or URL query. Use the system keychain (`tauri-plugin-stores` + keychain / Credential Manager); inject as env vars when spawning the subprocess. Prefer local credentials from `grok login` by default so the client never has to touch the key.

### 4.4 Variants of `session/update` (the UI's entire input source)

`params.update.sessionUpdate` is the discriminant field:

| Variant | UI landing |
|---|---|
| `user_message_chunk` | User bubble when replaying history |
| `agent_message_chunk` | Assistant body text, incremental append |
| `agent_thought_chunk` | Collapsed "thinking" block |
| `tool_call` | **Create** a tool card (with `toolCallId`, `title`, `kind`, `status`) |
| `tool_call_update` | **In-place update** of an existing card by `toolCallId` (status, output, diff) |
| `plan` | Right-side plan panel (whole-package replace, not incremental) |
| `available_commands_update` | Slash-command autocomplete list |
| `current_mode_update` | Top-bar mode badge |
| `session_info_update` | Sidebar session title / metadata (`title` / `updatedAt`, not on timeline) |
| `config_option_update` | Config snapshot (model etc., not on timeline) |

`tool_call` `kind` (read / edit / execute / search / think / fetch…) determines how the card looks:
- `edit` → show diff with "Apply / Reject" buttons
- `execute` → collapsed terminal output block
- `read` → one-line filename + line count

**Merge rule (the place frontends most often get wrong)**:
the message stream is not a pure append list; it is `Map<toolCallId, ToolCallCard>` + an ordered array.
`tool_call_update` must do a **patch merge**, not a replace, because it may carry only `status` without `content`.

### 4.5 stopReason

`end_turn` / `max_tokens` / `refusal` / `cancelled`, etc.
Note: **a `session/prompt` response returning ≠ the text stream ending** — more updates may still be in flight (especially on cancel; the protocol requires the client keep receiving tool-call updates after sending `session/cancel`).
UI "generating" state should be decided by `promptResponse already returned && update queue quiet for N ms` together — do not rely on either alone.

---

## 5. Rust bridge layer implementation

### 5.1 Layout

```
apps/desktop/src-tauri/src/
├── main.rs
├── commands.rs        # all #[tauri::command] exits
├── acp/
│   ├── codec.rs       # NDJSON read/write, JSON-RPC wrappers
│   ├── types.rs       # serde-derived protocol types (can be generated from ACP JSON Schema)
│   ├── runtime.rs     # GrokRuntime: one subprocess
│   ├── pool.rs        # RuntimePool: multi-session + LRU
│   └── client.rs      # reverse services: fs/*, terminal/*, permission
├── discovery.rs       # find grok binary, version check
├── store.rs           # SQLite persistence
└── secrets.rs         # keychain
```

### 5.2 GrokRuntime skeleton

```rust
pub struct GrokRuntime {
    child:    Child,
    stdin:    Mutex<ChildStdin>,
    pending:  Arc<DashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>,
    next_id:  AtomicU64,
    pub session_id: String,
    pub last_used:  AtomicI64,
}

impl GrokRuntime {
    pub async fn spawn(app: AppHandle, opts: SpawnOptions) -> Result<Self> {
        let mut cmd = Command::new(&opts.grok_bin);
        cmd.args(["agent", "stdio", "--no-auto-update"]);
        cmd.args(["--sandbox", opts.mode.sandbox_profile()]);  // see 6.2
        cmd.current_dir(&opts.cwd);
        cmd.env("XAI_API_KEY", &opts.api_key);

        // ⚠️ must explicitly forward locale; see 6.5
        if let Some(v) = locale_env_value(opts.locale.as_deref()) {
            cmd.env("LANG", &v);
            cmd.env("LC_ALL", &v);
        }

        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);   // do not pop a black console window

        let mut child = cmd.spawn()?;
        // start one task each for the read loop and stderr loop
        tokio::spawn(read_loop(child.stdout.take().unwrap(), pending.clone(), app.clone()));
        tokio::spawn(stderr_loop(child.stderr.take().unwrap(), app.clone()));
        ...
    }

    pub async fn request<T: DeserializeOwned>(&self, method: &str, params: Value)
        -> Result<T> { /* auto-increment id → write one line → wait oneshot → timeout */ }

    pub async fn notify(&self, method: &str, params: Value) -> Result<()> { ... }
}
```

**Read-loop dispatch logic** (three branches; all required):

```rust
async fn read_loop(stdout: ChildStdout, pending: Pending, app: AppHandle) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            log::warn!("non-JSON line, ignore: {line}"); continue;   // tolerate; do not panic
        };
        match (msg.get("id"), msg.get("method")) {
            // 1) agent → client request: must reply
            (Some(id), Some(method)) => handle_incoming_request(id, method, &msg, &app).await,
            // 2) response to our request
            (Some(id), None)         => resolve_pending(&pending, id, &msg),
            // 3) notification (session/update lands here)
            (None, Some(_))          => emit_to_frontend(&app, &msg),
            _ => {}
        }
    }
}
```

### 5.3 RuntimePool: multi-session parallel

One session = one subprocess. `grok agent stdio` holds hundreds of MB of context in memory; **without reclamation it will eat all RAM**.

```rust
pub struct RuntimePool {
    map: LinkedHashMap<SessionId, Arc<GrokRuntime>>,  // access order = LRU order
    capacity: usize,                                   // default 4, tunable on settings page
}

impl RuntimePool {
    pub async fn acquire(&mut self, sid: &SessionId, opts: SpawnOptions) -> Arc<GrokRuntime> {
        if let Some(rt) = self.map.get_refresh(sid) { return rt.clone(); }  // hit, zero spawn
        while self.map.len() >= self.capacity {
            if let Some((_, victim)) = self.pop_lru_idle() {   // only evict idle ones
                victim.shutdown_graceful(Duration::from_secs(5)).await;
            } else { break; }   // all busy, do not evict
        }
        let rt = Arc::new(GrokRuntime::spawn(opts).await?);
        self.map.insert(sid.clone(), rt.clone());
        rt
    }
}
```

This design gives a killer experience for free: **background sessions keep streaming**. When the user switches tabs, that session's subprocess is still alive and still pushing `session/update`; switching back shows the latest state instead of a blank catch-up.

Before eviction you must check `is_idle` (no in-flight prompt), or you will kill a running job.

### 5.4 Tauri command / event contract

```ts
// Commands (frontend → Rust)
invoke("check_environment")                     // → { grokPath, version, authed }
invoke("start_session", { workspacePath, model, mode, locale, resumeId? })
invoke("send_prompt",   { sessionId, blocks })  // blocks: ContentBlock[]
invoke("cancel_turn",   { sessionId })
invoke("respond_permission", { sessionId, requestId, optionId })
invoke("set_model",     { sessionId, modelId })
invoke("set_mode",      { sessionId, mode })    // may trigger restart; see 6.2
invoke("close_session", { sessionId })

// Events (Rust → frontend)
listen("acp://update",     (e) => ...)   // pass through session/update as-is
listen("acp://permission", (e) => ...)   // needs a dialog
listen("acp://terminal",   (e) => ...)   // terminal output deltas
listen("acp://stderr",     (e) => ...)   // diagnostic logs
listen("acp://exit",       (e) => ...)   // subprocess exited unexpectedly → UI shows "agent disconnected [Reconnect]"
```

**Backpressure**: token-level events can be hundreds per second. On the Rust side, coalesce `agent_message_chunk` in a **16 ms window** before emit, or WebView IPC will be flooded and frames will drop.

---

## 6. Key feature design

### 6.1 Model / provider switching

The `initialize` response includes `availableModels`; `session/set_model` switches. **Provider API keys, request format, and stream parsing are all the CLI's job** — the client only passes a model id.

Custom models the user configured in `~/.grok/config.toml` also appear automatically in the dropdown:

```toml
[model.my-model]
model    = "model-id"
base_url = "https://api.example.com/v1"
name     = "Display Name"
env_key  = "API_KEY"

[models]
default = "my-model"
```

That means the same UI naturally supports xAI / OpenAI / Anthropic / DeepSeek / OpenRouter / Ollama and any OpenAI-compatible endpoint. **Do not make yourself a single-vendor client.**

### 6.2 Permission modes: Ask / Plan / Build

Map to the CLI's sandbox profiles (`workspace` / `read-only` / `strict` / `devbox` / `off`):

| UI mode | `--sandbox` | Shell | Write files | Network |
|---|---|---|---|---|
| Ask (ask me) | `strict` | ❌ | ❌ | ✅ |
| Plan (read-only planning) | `read-only` | ❌ | ❌ | ✅ |
| Build (full autonomy) | `workspace` / `off` | ✅ | ✅ | ✅ |

**Pitfall: sandbox is an argv flag at process creation time; a running runtime cannot change permissions.**
Switching mode = graceful shutdown of the old process + respawn with new args + `session/load` to restore context. There will be a 2–3 second pause, but that is better than "UI claims read-only while writes still work".

```rust
async fn switch_mode(pool: &mut RuntimePool, sid: &SessionId, mode: Mode) -> Result<()> {
    if let Some(old) = pool.map.remove(sid) {
        old.shutdown_graceful(Duration::from_secs(5)).await;
    }
    let rt = GrokRuntime::spawn(SpawnOptions { mode, ..prev }).await?;
    rt.request::<Value>("session/load", json!({ "sessionId": sid, "cwd": cwd })).await?;
    pool.map.insert(sid.clone(), rt);
    Ok(())
}
```

The `session/request_permission` dialog should support four options and remember the choice: **Allow once / Always allow this tool / Deny / Deny and abort**. Store "Always allow" at workspace-level config, not globally.

### 6.3 Context injection: @ mentions and drag-drop

- `@` in the input triggers fuzzy file search (Rust-side `ignore` crate respects .gitignore — an order of magnitude faster than walking from JS)
- Drop files / paste screenshots → assemble into ACP `ContentBlock`:

```json
{ "prompt": [
  { "type": "text", "text": "Help me fix this bug" },
  { "type": "resource_link", "uri": "file:///abs/path/src/main.rs" },
  { "type": "image", "mimeType": "image/png", "data": "<base64>" }
]}
```

- Top bar shows whether the current workspace hits `AGENTS.md` / `CLAUDE.md`; click to view effective project rules (users often do not realize project rules override UI settings)

### 6.4 Diff review

`tool_call` with `kind: "edit"` carries `{ type: "diff", path, oldText, newText }` in content.
This is the biggest GUI value over a TUI: **side-by-side diff + accept/reject per hunk**, instead of reading a pile of `+/-` in scrollback.

Two implementation postures:
- **A (simple)**: declare `fs.writeTextFile: false`, let the agent write to disk itself; you only display + fall back on `git diff`
- **B (recommended)**: declare `fs.readTextFile/writeTextFile: true`, all writes go through you — natural consistency with the "editor unsaved buffer" model + one-click undo

### 6.5 Locale must be forwarded explicitly (real pitfall)

UI language is set to English, but the agent replies in Chinese — because the subprocess inherited the system locale (`zh_CN`).

```rust
fn locale_env_value(tag: Option<&str>) -> Option<String> {
    let tag = tag?;
    let posix = match tag {
        "en-US" | "en" => "en_US".into(),
        "zh-CN" | "zh" => "zh_CN".into(),
        other => other.replacen('-', "_", 1),
    };
    Some(format!("{posix}.UTF-8"))
}
// on spawn, set both LANG and LC_ALL (some programs only look at LC_ALL)
```

Implication: **for any subprocess with user-visible output, the system locale is not enough — the choice in the UI is what the user actually controls.**

### 6.6 Session persistence

Two layers:
- **CLI side**: headless sessions live under `~/.grok/sessions`; `session/load` can restore the full conversation
- **Client side**: local SQLite stores session metadata (title, workspace, model, mode, last active time, message cache) so the sidebar can open the list instantly without spawning a process

Cold-start strategy: only render the SQLite cache → when the user opens a session, `acquire()` the process + `session/load`.

---

## 7. Frontend state model

```ts
type Session = {
  id: string;
  workspace: string;
  model: string;
  mode: "ask" | "plan" | "build";
  status: "idle" | "streaming" | "waiting_permission" | "disconnected";
  timeline: TimelineItem[];              // ordered render list
  toolCalls: Map<string, ToolCallCard>;  // toolCallId → card (for in-place patch)
  plan?: PlanEntry[];
  pendingPermission?: PermissionRequest;
};

type TimelineItem =
  | { kind: "user";    blocks: ContentBlock[] }
  | { kind: "agent";   text: string }          // incremental append
  | { kind: "thought"; text: string; collapsed: boolean }
  | { kind: "tool";    toolCallId: string }    // pointer; entity lives in toolCalls
  | { kind: "error";   message: string };
```

Three performance rules:
1. Batch-flush `agent_message_chunk` with `requestAnimationFrame` — do not setState once per token
2. Use `@tanstack/react-virtual` virtual scroll for long sessions
3. Incremental markdown: re-parse only the **last unfinished block**; cache AST for completed blocks

---

## 8. Repo structure (monorepo)

```
grok-desk/
├── apps/desktop/
│   ├── src/                 # React
│   └── src-tauri/           # Rust (see 5.1)
├── packages/
│   ├── acp-types/           # TS types generated from ACP JSON Schema (Rust side via typify)
│   ├── ui/                  # component library
│   └── core/                # stores, pure logic (testable)
├── scripts/
└── .github/workflows/release.yml
```

**Strong recommendation: generate protocol types from the official JSON Schema; do not hand-write.** ACP is still evolving; hand-written types are long-term debt.

---

## 9. Packaging and distribution (pitfalls not in the docs)

- **macOS ad-hoc signing is not real signing**. A `.app` from `codesign --sign -` is still unsigned to Gatekeeper and blocked on first open. Either tell users to right-click → Open / clear `com.apple.quarantine`, or properly buy Apple Developer ID ($99/year) + notarize with `xcrun notarytool`.
- **WiX (`light.exe`) on Windows CI often crashes** (.NET dependency issues). Fix: `tauri build --bundles nsis` — skip MSI and only ship NSIS (`makensis` ships with Tauri CLI; no dependency hell).
- **Auto-update**: `tauri-plugin-updater` + GitHub Releases; put signing keys in Actions secrets.
- **CLI version compatibility**: on client start, compare `grok --version` against a known compatible range; show a yellow banner on mismatch instead of hard-blocking.

---

## 10. Milestones

| Stage | Delivery | Acceptance |
|---|---|---|
| **M0 (3 days)** | Node script bare ACP | From CLI: initialize → authenticate → session/new → prompt; print streaming text |
| **M1 (2 weeks)** | Single-session MVP | Tauri shell + message stream + tool cards + cancel + permission dialog |
| **M2 (2 weeks)** | Multi-session + process pool | Background sessions keep streaming; LRU works; memory stays within budget |
| **M3 (2 weeks)** | Engineering UX | Diff review, @ file refs, plan panel, terminal panel, model/mode switch |
| **M4 (1 week)** | Distribution | Three-platform builds, signing, auto-update, crash reporting |

**Do M0 first** — a 30-line script validates protocol assumptions and is far cheaper than building UI first and discovering the protocol does not match.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| ACP / CLI version drift changes fields | Parse loosely (unknown `sessionUpdate` variants degrade to an "unknown event" card instead of crashing); codegen protocol types + CI runs a real handshake smoke test |
| Subprocess zombies/orphans | On exit walk the pool and SIGTERM, then SIGKILL after 5s; on Windows bind lifetime with a job object |
| Memory explosion | LRU cap + when a single session timeline is too long, spill history to SQLite and keep only a window in memory |
| Permission UI out of sync with real sandbox | Mode switch forces process restart; never fake privilege drop in the UI layer |
| Key leakage | Keychain storage + env injection; redact `xai-` prefixes in logs/telemetry |
| Upstream CLI not installed | Install guide + `npx @xai-official/grok agent stdio` fallback |

---

## 12. Appendix: M0 verification script (minimal runnable)

```js
import { spawn } from "node:child_process";
import readline from "node:readline";

const proc = spawn("grok", ["agent", "stdio", "--no-auto-update"], { stdio: "pipe" });
const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
let id = 0, out = "";

proc.stderr.on("data", d => process.stderr.write(d));

rl.on("line", line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "session/update") {
    const u = m.params?.update;
    if (u?.sessionUpdate === "agent_message_chunk") out += u.content?.text ?? "";
    if (u?.sessionUpdate === "tool_call") console.error("[tool]", u.title);
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result ?? {});
});

const call = (method, params) => new Promise((resolve, reject) => {
  const rid = ++id;
  pending.set(rid, { resolve, reject });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
});

const init = await call("initialize", {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
});
console.error("models:", init.availableModels?.map(m => m.id));

const ids = new Set((init.authMethods ?? []).map(m => m.id));
await call("authenticate", {
  methodId: process.env.XAI_API_KEY && ids.has("xai.api_key") ? "xai.api_key" : "cached_token",
  _meta: { headless: true },
});

const { sessionId } = await call("session/new", { cwd: process.cwd(), mcpServers: [] });
const res = await call("session/prompt", {
  sessionId,
  prompt: [{ type: "text", text: "Introduce this repository in one sentence" }],
});

await new Promise(r => setTimeout(r, 500));   // wait for trailing packets
console.log(out.trim(), "\nstopReason:", res.stopReason);
proc.kill();
```

Once this runs, the rest is just "swap `out` for React state".

---

## References

- Grok Build official docs: https://docs.x.ai/build/overview
- Headless & ACP: https://docs.x.ai/build/cli/headless-scripting
- Agent Client Protocol: https://agentclientprotocol.com
- ACP SDK: Rust `agent-client-protocol` / TS `@zed-industries/agent-client-protocol` / Python `agent-client-protocol`
- Existing implementation reference: grok-gui (Tauri 2 + React, MIT) https://github.com/timexingxin/grok-gui
