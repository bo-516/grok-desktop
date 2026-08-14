package wsapi

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/userprompts"
)

// sessionsListLimit caps rows returned by sessions_list. Mirrors the Node
// bridge's cliCommands.sessionsList so both bridges truncate history at the
// same depth; ListSessionsFromDisk clamps anything above 2000 on its own.
const sessionsListLimit = 500

// Timeouts for one-shot CLI channel commands (ms). Match Node cliCommands so
// Environment sheet UX is the same on either bridge.
const (
	inspectTimeoutMs   = 45_000
	mcpListTimeoutMs   = 30_000
	mcpDoctorTimeoutMs = 120_000
)

// handleCli answers one `cli` channel request on the reply socket ws, reading
// requestId / command / args / cwd out of the raw client frame msg. Missing or
// mistyped fields degrade to their zero value, so a malformed frame lands in
// the unknown-command branch instead of panicking on a nil map; cwd falls
// back to the bridge's default list cwd.
//
// Every path replies with a cli_result envelope — successes and failures alike
// — because the desktop parks a pending promise per requestId (liveBridge.ts
// pendingCli). A bare `error` frame would leave that promise hung until the
// client-side timeout fires. cli_result is unicast: broadcasting it would
// settle the same requestId on unrelated clients.
//
// auth_logout disposes the whole runtime pool after a successful CLI call
// (F-AUTH-07), matching Node handleCli.onAuthLogout.
//
// Always returns nil; command failures ride inside the envelope, so returning
// an error here would double-report them as a second `error` frame.
func (h *Handlers) handleCli(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	command, _ := msg["command"].(string)
	args, _ := msg["args"].(map[string]any)
	cwd := h.State.DefaultListCwd
	if c, ok := msg["cwd"].(string); ok && c != "" {
		cwd, _ = filepath.Abs(c)
	}
	onAuthLogout := func() {
		h.Pool.DisposeAll()
		h.State.FocusedSessionID = ""
		h.BroadcastPool()
	}
	data, err := dispatchCliCommand(command, args, cwd, onAuthLogout)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID,
				"ok":        false,
				"error":     err.Error(),
			},
		})
		return nil
	}
	h.Send(ws, map[string]any{
		"type": "cli_result",
		"result": map[string]any{
			"requestId": requestID,
			"ok":        true,
			"data":      data,
		},
	})
	return nil
}

// dispatchCliCommand routes command (a ClientMsg.cli id such as
// `sessions_list` / `inspect`) to its Go implementation and returns the
// payload for cli_result.data. args is the free-form bag from the UI and may
// be nil, so ported commands must read it defensively; cwd is the resolved
// workspace for commands that scope to one project, and is ignored by
// sessions_list on purpose (see sessionsList).
//
// Ported surface mirrors Node cliDispatch (sessions / MCP / worktree / auth /
// models / memory / plugin / prompts / mcp_stderr_log / import_claude).
// Unknown command ids return an error naming that one command.
//
// onAuthLogout is invoked after a successful auth_logout so the pool can dispose
// all runtimes (F-AUTH-07); nil is safe when the caller does not need the hook.
func dispatchCliCommand(command string, args map[string]any, cwd string, onAuthLogout func()) (any, error) {
	switch command {
	case "sessions_list":
		return sessionsList()
	case "session_history":
		return sessionHistory(stringArg(args, "sessionId"), cwd, stringArg(args, "cwd"))
	case "sessions_search":
		return sessionsSearch(stringArg(args, "query"), cwd)
	case "sessions_delete":
		return sessionsDelete(stringArg(args, "sessionId"))
	case "export":
		outFile := stringArg(args, "outFile")
		return sessionsExport(stringArg(args, "sessionId"), outFile)
	case "inspect":
		return inspectJSON(cwd)
	case "mcp_list":
		return mcpList(cwd)
	case "mcp_doctor":
		return mcpDoctor(stringArg(args, "name"), cwd)
	case "mcp_add_stdio":
		return mcpAddStdio(args, cwd)
	case "mcp_enable":
		return mcpEnable(stringArg(args, "name"), cwd)
	case "mcp_disable":
		return mcpDisable(stringArg(args, "name"), cwd)
	case "mcp_remove":
		scope := "user"
		if stringArg(args, "scope") == "project" {
			scope = "project"
		}
		return mcpRemove(stringArg(args, "name"), scope, cwd)
	case "mcp_add_http":
		return mcpAddHttp(args, cwd)
	case "worktree_list":
		return worktreeList(cwd)
	case "worktree_rm":
		return worktreeRm(stringArg(args, "name"), boolArg(args, "dryRun"), cwd)
	case "worktree_gc":
		maxAge := stringArg(args, "maxAge")
		if maxAge == "" {
			maxAge = "7d"
		}
		return worktreeGc(maxAge, cwd)
	case "models_list":
		return modelsList()
	case "memory_clear":
		scope := stringArg(args, "scope")
		if scope == "" {
			scope = "workspace"
		}
		return memoryClear(scope, cwd)
	case "auth_login":
		return authLogin(boolArg(args, "deviceAuth"))
	case "auth_logout":
		data, err := authLogout()
		if err == nil && onAuthLogout != nil {
			onAuthLogout()
		}
		return data, err
	case "update_check":
		return updateCheck()
	case "plugin":
		return pluginAction(stringArg(args, "action"), stringArg(args, "name"), cwd)
	case "marketplace":
		return marketplaceAction(stringArg(args, "action"), stringArg(args, "name"))
	case "mcp_stderr_log":
		return mcpStderrLog(args)
	case "import_claude":
		return importClaude(cwd)
	case "prompts_get":
		// Paths derived only from GROK_HOME + project root of cwd — ignore path args.
		return userprompts.PromptsGet(cwd)
	case "prompts_set":
		scope := userprompts.PromptScope(stringArg(args, "scope"))
		entries := coercePromptEntries(args)
		return userprompts.PromptsSet(scope, entries, cwd)
	case "prompts_clear":
		scope := userprompts.PromptScope(stringArg(args, "scope"))
		return userprompts.PromptsClear(scope, cwd)
	case "prompts_move":
		from := userprompts.PromptScope(stringArg(args, "from"))
		to := userprompts.PromptScope(stringArg(args, "to"))
		idx := intArg(args, "entryIndex")
		return userprompts.PromptsMove(from, to, idx, cwd)
	default:
		return nil, fmt.Errorf("unknown cli command: %s", command)
	}
}

// stringArg reads a string from the free-form args bag.
func stringArg(args map[string]any, key string) string {
	if args == nil {
		return ""
	}
	v, ok := args[key]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// intArg reads an integer from the free-form args bag (JSON numbers are float64).
func intArg(args map[string]any, key string) int {
	if args == nil {
		return 0
	}
	switch v := args[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	default:
		return 0
	}
}

// boolArg reads a boolean from the free-form args bag.
func boolArg(args map[string]any, key string) bool {
	if args == nil {
		return false
	}
	v, ok := args[key]
	if !ok || v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

// stringSliceArg reads a []string from JSON arrays (or returns nil).
func stringSliceArg(args map[string]any, key string) []string {
	if args == nil {
		return nil
	}
	raw, ok := args[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		out = append(out, fmt.Sprint(item))
	}
	return out
}

// coercePromptEntries maps args.entries into []PromptEntry.
// Enabled defaults to true when the field is absent (JS clients omit it).
func coercePromptEntries(args map[string]any) []userprompts.PromptEntry {
	if args == nil {
		return nil
	}
	raw, ok := args["entries"].([]any)
	if !ok {
		return nil
	}
	out := make([]userprompts.PromptEntry, 0, len(raw))
	for i, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := m["id"].(string)
		if id == "" {
			id = fmt.Sprintf("e%d", i)
		}
		text, _ := m["text"].(string)
		enabled := true
		if ev, exists := m["enabled"]; exists {
			if b, ok := ev.(bool); ok {
				enabled = b
			}
		}
		var cat userprompts.PromptCategory
		if c, ok := m["category"].(string); ok && c != "" {
			cat = userprompts.PromptCategory(c)
		}
		e := userprompts.PromptEntry{
			Id:      id,
			Text:    text,
			Enabled: enabled,
		}
		if cat != "" {
			e.Category = cat
		}
		out = append(out, e)
	}
	return out
}

// sessionHistory reads one session's chat_history.jsonl (or updates.jsonl)
// without spawning grok-build. cwd from the CLI frame is a lookup hint; an
// explicit args.cwd wins. Missing files return an empty payload so the
// desktop can keep waiting on session/load.
func sessionHistory(sessionID, frameCwd, argsCwd string) (any, error) {
	hint := stringsTrim(argsCwd)
	if hint == "" {
		hint = stringsTrim(frameCwd)
	}
	hist := session.ReadSessionHistoryFromDisk(sessionID, hint, "", 0)
	return hist, nil
}

func stringsTrim(s string) string {
	return strings.TrimSpace(s)
}

// sessionsList enumerates `~/.grok/sessions` across every workspace folder and
// returns the `{"sessions": [...]}` envelope normalizeSessionsList expects.
// Rows carry `cwd`, which the desktop's normalizeOneSession maps onto
// `workspace` for rail grouping. Subagent rows stay in the list; the rail
// filters them at render time.
//
// No cwd filter is applied: the rail groups by project, so scoping to the open
// session's workspace would collapse the side-nav to one group and hide every
// other project's history (same reasoning as the Node cliCommands.sessionsList).
//
// Unlike Node there is no `grok sessions list` fallback — this path is disk
// only — so an unreadable or absent tree yields an empty list. That is safe:
// mergeRemoteSessionsIntoCatalog leaves the local catalog untouched on empty
// input, so a bad read can never wipe the rail.
func sessionsList() (any, error) {
	rows, err := session.ListSessionsFromDisk(sessionsListLimit, "", "")
	if err != nil {
		return nil, err
	}
	if rows == nil {
		// Marshal as [] rather than null so the client's Array.isArray holds.
		rows = []session.DiskSessionRow{}
	}
	return map[string]any{"sessions": rows}, nil
}

// inspectJSON runs `grok inspect --json` for the Environment sheet snapshot.
// On non-zero exit or non-JSON stdout it falls back to plain `grok inspect`
// and returns `{raw: stdout}`, matching Node cliCommands.inspectJson so
// normalizeInspect can still surface a degraded view.
//
// @param cwd Project workspace for project-scoped rules / MCP / skills.
// @returns Parsed inspect object, or `{raw: string}` on plain fallback.
func inspectJSON(cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"inspect", "--json"}, cwd, inspectTimeoutMs)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli([]string{"inspect"}, cwd, inspectTimeoutMs)
	if err != nil {
		return nil, err
	}
	if err := spawn.AssertCliOk(plain, "inspect"); err != nil {
		return nil, err
	}
	return map[string]any{"raw": plain.Stdout}, nil
}

// mcpList runs `grok mcp list --json` for config-defined MCP servers.
// Environment merges this with inspect.mcpServers (plugin-provided servers
// only appear in inspect). Falls back to plain text on JSON failure.
//
// @param cwd Optional project cwd for project-scope config discovery.
// @returns Parsed list/object, or `{raw: string}` on plain fallback.
func mcpList(cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"mcp", "list", "--json"}, cwd, mcpListTimeoutMs)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli([]string{"mcp", "list"}, cwd, mcpListTimeoutMs)
	if err != nil {
		return nil, err
	}
	if err := spawn.AssertCliOk(plain, "mcp list"); err != nil {
		return nil, err
	}
	return map[string]any{"raw": plain.Stdout}, nil
}

// mcpDoctor runs `grok mcp doctor <name> --json` for one server health check.
// On JSON failure returns a soft envelope `{ok, raw, code}` so the UI can show
// the diagnostic text without treating the channel as dead (same as Node).
//
// @param name Server id; empty name still invokes the CLI (it will error).
// @param cwd Optional project cwd.
// @returns Doctor JSON, or a soft `{ok, raw, code}` map.
func mcpDoctor(name, cwd string) (any, error) {
	result, err := spawn.RunGrokCli(
		[]string{"mcp", "doctor", name, "--json"},
		cwd,
		mcpDoctorTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli(
		[]string{"mcp", "doctor", name},
		cwd,
		mcpDoctorTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	code := 1
	if plain.Code != nil {
		code = *plain.Code
	}
	return map[string]any{
		"ok":   code == 0,
		"raw":  plain.Stdout + plain.Stderr,
		"code": code,
	}, nil
}
