package wsapi

import (
	"fmt"
	"path/filepath"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
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
// the unsupported-command branch instead of panicking on a nil map; cwd falls
// back to the bridge's default list cwd.
//
// Every path replies with a cli_result envelope — successes and failures alike
// — because the desktop parks a pending promise per requestId (liveBridge.ts
// pendingCli). A bare `error` frame would leave that promise hung until the
// client-side timeout fires. cli_result is unicast: broadcasting it would
// settle the same requestId on unrelated clients.
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
	data, err := dispatchCliCommand(command, args, cwd)
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
// Ported surface today:
//   - sessions_list — pure disk walk (no CLI subprocess)
//   - inspect / mcp_list / mcp_doctor — one-shot `grok` via spawn.RunGrokCli
//     (Environment sheet load + doctor; mirrors Node cliCommands)
//
// Everything else returns an error naming that one command, so the UI can
// point at the missing feature rather than reporting the whole channel as dead.
func dispatchCliCommand(command string, args map[string]any, cwd string) (any, error) {
	switch command {
	case "sessions_list":
		return sessionsList()
	case "inspect":
		return inspectJSON(cwd)
	case "mcp_list":
		return mcpList(cwd)
	case "mcp_doctor":
		name := ""
		if args != nil {
			if n, ok := args["name"].(string); ok {
				name = n
			}
		}
		return mcpDoctor(name, cwd)
	default:
		return nil, fmt.Errorf(
			"cli command %q is not available on the Go bridge%s",
			command,
			NodeBridgeHint,
		)
	}
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
