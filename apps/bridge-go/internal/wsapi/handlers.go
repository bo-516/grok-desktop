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
)

// NodeBridgeHint is appended to T3 error messages so the UI can direct the user.
const NodeBridgeHint = " (switch to Node bridge for this feature)"

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
	return &Handlers{
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

	case "list_pool":
		h.Send(ws, map[string]any{"type": "pool", "entries": h.Pool.List()})
		return nil

	case "get_state":
		sessionID, _ := msg["sessionId"].(string)
		rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
		if err != nil {
			h.Send(ws, map[string]any{"type": "error", "message": err.Error(), "sessionId": sessionID})
			return nil
		}
		h.Send(ws, map[string]any{"type": "state", "session": rt.GetSessionState()})
		return nil

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
		return rt.RespondPermission(optionID)

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

	// --- T3 surfaces: explicit Node bridge hint ---
	case "set_model", "set_mode", "compact", "token_usage", "cli":
		return fmt.Errorf("%s is not available on the Go bridge%s", typ, NodeBridgeHint)

	default:
		if typ == "" {
			return fmt.Errorf("missing message type")
		}
		return fmt.Errorf("unknown message type: %s", typ)
	}
}

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
	return session.StartOrResume(h.lifecycleDeps(), struct {
		Cwd           string
		AlwaysApprove bool
		ResumeID      string
		Seed          *acp.SessionState
		ForceNew      bool
		SpawnConfig   *pool.SessionSpawnConfig
	}{
		Cwd: cwd, AlwaysApprove: approve, ResumeID: resumeID,
		Seed: seed, ForceNew: forceNew, SpawnConfig: spawnConfig,
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
	abs, err := reverse.ResolveWorkspacePath(writeCwd, pathStr)
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
