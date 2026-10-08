package wsapi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/reverse"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/userterm"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/worktree"
	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/workspacepath"
)

// Handlers owns focused session, seeds, and client message dispatch.
type Handlers struct {
	Pool          *pool.RuntimePool
	AlwaysApprove bool
	DefaultCwd    string
	PoolCapacity  int
	State         *session.HandlerState
	SessionSeeds  sync.Map
	Send          func(ws *websocket.Conn, msg map[string]any)
	Broadcast     func(msg map[string]any)
	// Terminals owns the user's interactive PTY terminals (terminal_* messages);
	// killed on socket disconnect, close_session and Server.Close.
	Terminals *userterm.Manager
	// Streams stamps per-session frames (epoch/seq), serves `resync` and
	// holds provenance. Set by NewServer; nil keeps the unstamped relay.
	Streams *sessionstream.Hub
}

// NewHandlers constructs bridge handlers bound to pool and I/O closures.
func NewHandlers(
	p *pool.RuntimePool,
	alwaysApprove bool,
	defaultCwd string,
	poolCapacity int,
	send func(ws *websocket.Conn, msg map[string]any),
	broadcast func(msg map[string]any),
) *Handlers {
	h := &Handlers{
		Pool:          p,
		AlwaysApprove: alwaysApprove,
		DefaultCwd:    defaultCwd,
		PoolCapacity:  poolCapacity,
		State: &session.HandlerState{
			DefaultListCwd: defaultCwd,
		},
		Send:      send,
		Broadcast: broadcast,
	}
	h.Terminals = newTerminalManager(h)
	return h
}

// BroadcastPool sends the current pool summary to all clients.
func (h *Handlers) BroadcastPool() {
	h.Broadcast(map[string]any{"type": "pool", "entries": h.Pool.List()})
}

func (h *Handlers) lifecycleDeps() session.LifecycleDeps {
	return session.LifecycleDeps{
		Pool:          h.Pool,
		AlwaysApprove: h.AlwaysApprove,
		State:         h.State,
		SessionSeeds:  &h.SessionSeeds,
		Broadcast:     h.Broadcast,
		BroadcastPool: h.BroadcastPool,
		Streams:       h.Streams,
	}
}

// OnClientMessage dispatches one browser JSON text frame.
func (h *Handlers) OnClientMessage(ws *websocket.Conn, raw string) {
	var msg map[string]any
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		h.Send(ws, map[string]any{"type": "error", "message": "invalid JSON"})
		return
	}
	typ, _ := msg["type"].(string)
	if err := h.dispatch(ws, typ, msg); err != nil {
		message := err.Error()
		fmt.Fprintf(os.Stderr, "[bridge] error %s\n", message)
		h.Send(ws, map[string]any{"type": "error", "message": message})
		h.Broadcast(map[string]any{"type": "error", "message": message})
	}
}

func (h *Handlers) dispatch(ws *websocket.Conn, typ string, msg map[string]any) error {
	switch typ {
	case "ping":
		h.Send(ws, map[string]any{"type": "pong"})
		return nil

	case "check_environment":
		env := session.CheckEnvironment(h.PoolCapacity)
		h.Send(ws, map[string]any{"type": "environment", "env": env})
		return nil

	// Login state only — an env read plus one stat, no `grok --version` spawn.
	// That cheapness is the contract: the desktop polls this every 3s to catch
	// a browser login or a `grok logout` that happened outside the app.
	case "check_auth":
		h.Send(ws, map[string]any{"type": "auth_state", "auth": session.ProbeAuth()})
		return nil

	case "list_pool":
		h.Send(ws, map[string]any{"type": "pool", "entries": h.Pool.List()})
		return nil

	// CLI onboarding: run the official installer / `grok update` with live
	// output, and the custom grok binary path setting (grok_setup.go,
	// grok_bin_setting.go).
	case "grok_setup_run":
		return h.handleGrokSetupRun(ws, msg)
	case "grok_setup_cancel":
		return h.handleGrokSetupCancel(msg)
	case "grok_bin_get":
		return h.handleGrokBinGet(ws, msg)
	case "grok_bin_set":
		return h.handleGrokBinSet(ws, msg)

	case "get_state":
		sessionID, _ := msg["sessionId"].(string)
		rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
		if err != nil {
			h.Send(ws, map[string]any{"type": "error", "message": err.Error(), "sessionId": sessionID})
			return nil
		}
		// Snapshot carries epoch/headSeq so a client falling back from a
		// failed resync can re-anchor its stream position.
		h.sendStateSnapshot(ws, rt.GetSessionState())
		return nil

	// Catch up one (session, epoch) stream after a client-detected gap.
	case "resync":
		return h.handleResync(ws, msg)

	case "list_workspace_entries":
		requestID, _ := msg["requestId"].(string)
		query, _ := msg["query"].(string)
		listCwd := h.State.DefaultListCwd
		if c, ok := msg["cwd"].(string); ok && c != "" {
			listCwd, _ = filepath.Abs(c)
		}
		entries, err := session.ListWorkspaceEntries(listCwd, query)
		if err != nil {
			entries = []session.WorkspaceEntry{}
		}
		h.Send(ws, map[string]any{
			"type": "workspace_entries", "requestId": requestID, "entries": entries,
		})
		return nil

	case "write_workspace_file":
		return h.handleWriteWorkspaceFile(ws, msg)

	case "read_workspace_file":
		return h.handleReadWorkspaceFile(ws, msg)

	case "preview_workspace_file":
		return h.handlePreviewWorkspaceFile(ws, msg)

	case "close_session":
		sessionID, _ := msg["sessionId"].(string)
		closed := h.Pool.Close(sessionID)
		// Drop crash-recovery seed so long-running bridges do not retain timelines forever.
		h.SessionSeeds.Delete(sessionID)
		// User terminals opened for this session die with it.
		h.Terminals.CloseSession(sessionID)
		if h.State.FocusedSessionID == sessionID {
			list := h.Pool.List()
			h.State.FocusedSessionID = ""
			if len(list) > 0 {
				h.State.FocusedSessionID = list[len(list)-1].SessionID
			}
		}
		message := "session not in pool: " + sessionID
		if closed {
			message = "closed session " + sessionID
		}
		h.Send(ws, map[string]any{"type": "info", "message": message, "sessionId": sessionID})
		h.BroadcastPool()
		return nil

	case "start":
		return h.handleStart(msg)

	case "prompt":
		return h.handlePrompt(msg)

	case "cancel":
		sessionID, _ := msg["sessionId"].(string)
		rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
		if err != nil {
			return err
		}
		h.Pool.Touch(rt.SessionID)
		rt.Cancel()
		return nil

	case "permission":
		sessionID, _ := msg["sessionId"].(string)
		optionID, _ := msg["optionId"].(string)
		rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
		if err != nil {
			return err
		}
		h.Pool.Touch(rt.SessionID)
		// A second window answering the same prompt must not write another
		// JSON-RPC response (RespondPermission drops that under its mutex)
		// and must not broadcast "No pending permission request" into the
		// window that already cleared the dialog. The clear itself is the
		// state broadcast emitState already sent to every socket.
		if permErr := rt.RespondPermission(optionID); permErr != nil {
			h.Send(ws, map[string]any{
				"type": "error", "message": permErr.Error(), "sessionId": rt.SessionID,
			})
			return nil
		}
		return nil

	case "set_model":
		return h.handleSetModel(ws, msg)

	case "set_mode":
		return h.handleSetMode(ws, msg)

	case "compact":
		return h.handleCompact(msg)

	case "token_usage":
		return h.handleTokenUsage(ws, msg)

	case "billing":
		return h.handleBilling(ws, msg)

	case "fork_session":
		return h.handleForkSession(ws, msg)

	case "restart_session":
		sessionID, _ := msg["sessionId"].(string)
		approve := h.AlwaysApprove
		if v, ok := msg["alwaysApprove"].(bool); ok {
			approve = v
		}
		var spawnConfig *pool.SessionSpawnConfig
		if raw, ok := msg["spawnConfig"]; ok && raw != nil {
			spawnConfig = parseSpawnConfig(raw)
		}
		return session.RestartSession(h.lifecycleDeps(), sessionID, spawnConfig, approve)

	// Initialize-only model catalog. Reuses a pooled session when one already
	// has models; otherwise spawns a short-lived grok and does not session/new.
	case "read_model_catalog":
		h.readModelCatalog(ws, msg)
		return nil

	// CLI channel: one-shot grok + disk helpers (see cli.go / cli_commands.go).
	case "cli":
		return h.handleCli(ws, msg)

	// Integrated terminal panel: PTY-backed user shells (see terminal.go).
	case "terminal_create", "terminal_input", "terminal_resize",
		"terminal_ack", "terminal_kill", "terminal_list":
		return h.handleTerminal(ws, typ, msg)

	default:
		if typ == "" {
			return fmt.Errorf("missing message type")
		}
		return fmt.Errorf("unknown message type: %s", typ)
	}
}

// handleStart opens or resumes a session. An optional `worktree` object
// (`name` and `ref` strings, both optional) creates a grok worktree first
// and spawns the agent there. A missing or null worktree field does not
// create one. A non-object, or a name/ref that starts with "-" or contains
// a newline, fails the start. Create failures propagate and do not fall
// back to the source checkout.
//
// @param msg Decoded client frame. cwd, alwaysApprove, forceNew, resumeId,
// seed, and spawnConfig keep their previous meaning.
// @returns The start error, including worktree parse and create failures.
func (h *Handlers) handleStart(msg map[string]any) error {
	cwd := h.State.DefaultListCwd
	if cwd == "" {
		cwd = h.DefaultCwd
	}
	if c, ok := msg["cwd"].(string); ok && c != "" {
		cwd, _ = filepath.Abs(c)
	}
	approve := h.AlwaysApprove
	if v, ok := msg["alwaysApprove"].(bool); ok {
		approve = v
	}
	forceNew, _ := msg["forceNew"].(bool)
	var resumeID string
	if !forceNew {
		resumeID, _ = msg["resumeId"].(string)
	}
	var seed *acp.SessionState
	if !forceNew {
		if raw, ok := msg["seed"]; ok && raw != nil {
			seed = parseSeed(raw)
		}
	}
	var spawnConfig *pool.SessionSpawnConfig
	if raw, ok := msg["spawnConfig"]; ok && raw != nil {
		spawnConfig = parseSpawnConfig(raw)
	}
	wtReq, err := worktree.ParseRequest(msg["worktree"])
	if err != nil {
		return err
	}
	// Client-generated id echoed in the new session's provenance.
	startID, _ := msg["startId"].(string)
	return session.StartOrResume(h.lifecycleDeps(), session.StartOpts{
		Cwd: cwd, AlwaysApprove: approve, ResumeID: resumeID,
		Seed: seed, ForceNew: forceNew, SpawnConfig: spawnConfig,
		Worktree: wtReq, StartID: startID,
	})
}

func (h *Handlers) handlePrompt(msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	text, _ := msg["text"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		return err
	}
	h.Pool.Touch(rt.SessionID)
	h.State.FocusedSessionID = rt.SessionID
	var blocks []acp.ContentBlock
	if raw, ok := msg["blocks"].([]any); ok {
		for _, b := range raw {
			if m, ok := b.(map[string]any); ok {
				blocks = append(blocks, acp.ContentBlock(m))
			}
		}
	}
	return rt.Prompt(text, blocks)
}

func (h *Handlers) handleWriteWorkspaceFile(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	pathStr, _ := msg["path"].(string)
	content, _ := msg["content"].(string)
	writeCwd := h.State.DefaultListCwd
	if c, ok := msg["cwd"].(string); ok && c != "" {
		writeCwd, _ = filepath.Abs(c)
	}
	abs, err := workspacepath.ResolveWorkspacePath(writeCwd, pathStr)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "write_workspace_file_result", "requestId": requestID,
			"ok": false, "error": err.Error(),
		})
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		h.Send(ws, map[string]any{
			"type": "write_workspace_file_result", "requestId": requestID,
			"ok": false, "error": err.Error(),
		})
		return nil
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		h.Send(ws, map[string]any{
			"type": "write_workspace_file_result", "requestId": requestID,
			"ok": false, "error": err.Error(),
		})
		return nil
	}
	h.Send(ws, map[string]any{
		"type": "write_workspace_file_result", "requestId": requestID, "ok": true,
	})
	return nil
}

func (h *Handlers) handleReadWorkspaceFile(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	pathStr, _ := msg["path"].(string)
	readCwd := h.State.DefaultListCwd
	if c, ok := msg["cwd"].(string); ok && c != "" {
		readCwd, _ = filepath.Abs(c)
	}
	result := reverse.ReadWorkspaceFileForEmbed(readCwd, pathStr)
	h.Send(ws, map[string]any{
		"type": "read_workspace_file_result", "requestId": requestID,
		"ok": result.OK, "content": result.Content, "mimeType": result.MimeType,
		"bytes": result.Bytes, "reason": result.Reason, "error": result.Error,
	})
	return nil
}

func (h *Handlers) handlePreviewWorkspaceFile(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	pathStr, _ := msg["path"].(string)
	readCwd := h.State.DefaultListCwd
	if c, ok := msg["cwd"].(string); ok && c != "" {
		readCwd, _ = filepath.Abs(c)
	}
	maxBytes := 0
	if v, ok := msg["maxBytes"].(float64); ok {
		maxBytes = int(v)
	}
	result := reverse.ReadWorkspaceFileForPreview(readCwd, pathStr, maxBytes)
	out := map[string]any{
		"type": "preview_workspace_file_result", "requestId": requestID,
		"ok": result.OK, "content": result.Content, "mimeType": result.MimeType,
		"bytes": result.Bytes, "reason": result.Reason, "error": result.Error,
	}
	if result.Truncated {
		out["truncated"] = true
	}
	h.Send(ws, out)
	return nil
}

func parseSeed(raw any) *acp.SessionState {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var s acp.SessionState
	if err := json.Unmarshal(b, &s); err != nil {
		return nil
	}
	if s.Timeline == nil {
		s.Timeline = []any{}
	}
	if s.ToolCalls == nil {
		s.ToolCalls = map[string]any{}
	}
	return &s
}

func parseSpawnConfig(raw any) *pool.SessionSpawnConfig {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var cfg pool.SessionSpawnConfig
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil
	}
	return &cfg
}
