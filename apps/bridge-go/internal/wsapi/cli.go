package wsapi

import (
	"fmt"
	"path/filepath"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// sessionsListLimit caps rows returned by sessions_list. Mirrors the Node
// bridge's cliCommands.sessionsList so both bridges truncate history at the
// same depth; ListSessionsFromDisk clamps anything above 2000 on its own.
const sessionsListLimit = 500

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
// `sessions_list`) to its Go implementation and returns the payload for
// cli_result.data. args is the free-form bag from the UI and may be nil, so
// ported commands must read it defensively; cwd is the resolved workspace for
// commands that scope to one project, and is ignored by sessions_list on
// purpose (see sessionsList).
//
// Only commands that need no `grok` CLI subprocess are ported. Everything else
// returns an error naming that one command, so the UI can point at the missing
// feature rather than reporting the whole channel as dead.
func dispatchCliCommand(command string, args map[string]any, cwd string) (any, error) {
	switch command {
	case "sessions_list":
		return sessionsList()
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
// Unlike Node there is no `grok sessions list` fallback — this bridge runs no
// CLI subprocess — so an unreadable or absent tree yields an empty list. That
// is safe: mergeRemoteSessionsIntoCatalog leaves the local catalog untouched on
// empty input, so a bad read can never wipe the rail.
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
