package acp

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// HandshakeOpts configures initialize → authenticate → session/new|load.
type HandshakeOpts struct {
	Cwd                string
	ProtocolVersion    int
	McpServers         []any
	ClientCapabilities any
	AuthMethodID       string
	EnvAPIKeyPresent   bool
	ResumeID           string
	Seed               *SessionState
}

// HandshakeResult is returned after a successful handshake.
type HandshakeResult struct {
	Init      InitializeResult
	SessionID string
	Resumed   bool
}

// Handshake runs initialize → authenticate → session/new | session/load.
// Timeline reduce is not performed; seed is applied as a hydrate snapshot only.
func (c *Client) Handshake(opts HandshakeOpts) (HandshakeResult, error) {
	proto := opts.ProtocolVersion
	if proto == 0 {
		proto = 1
	}
	caps := opts.ClientCapabilities
	if caps == nil {
		caps = map[string]any{
			"fs":       map[string]any{"readTextFile": true, "writeTextFile": true},
			"terminal": true,
		}
	}
	mcp := opts.McpServers
	if mcp == nil {
		mcp = []any{}
	}

	initRaw, err := c.Request("initialize", map[string]any{
		"protocolVersion":    proto,
		"clientCapabilities": caps,
	})
	if err != nil {
		return HandshakeResult{}, err
	}
	init, _ := initRaw.(map[string]any)
	if init == nil {
		init = map[string]any{}
	}
	meta := extractInitializeMetadata(init)
	agentCaps := init["agentCapabilities"]

	// Authenticate when agent advertises methods.
	methodID := opts.AuthMethodID
	if methodID == "" {
		methods := authMethodSet(init)
		if opts.EnvAPIKeyPresent && methods["xai.api_key"] {
			methodID = "xai.api_key"
		} else if methods["cached_token"] {
			methodID = "cached_token"
		} else {
			for m := range methods {
				methodID = m
				break
			}
		}
	}
	if methodID != "" {
		if _, err := c.Request("authenticate", map[string]any{
			"methodId": methodID,
			"_meta":    map[string]any{"headless": true},
		}); err != nil {
			return HandshakeResult{}, err
		}
	}

	if opts.ResumeID != "" {
		// Hydrate from seed when provided (client-side full timeline).
		if opts.Seed != nil && opts.Seed.ID == opts.ResumeID {
			seed := *opts.Seed
			seed.Workspace = firstNonEmpty(opts.Cwd, seed.Workspace)
			if seed.Model == "" {
				seed.Model = meta.Model
			}
			if len(seed.AvailableModels) == 0 {
				seed.AvailableModels = meta.AvailableModels
			}
			if seed.AgentCapabilities == nil {
				seed.AgentCapabilities = agentCaps
			}
			seed.Status = StatusIdle
			seed.PendingPermission = nil
			if seed.Timeline == nil {
				seed.Timeline = []any{}
			}
			c.ReplaceSessionState(seed)
		} else {
			st := EmptySession(opts.ResumeID, opts.Cwd, meta.Model, "build")
			st.AvailableModels = meta.AvailableModels
			st.AvailableCommands = meta.AvailableCommands
			st.AgentCapabilities = agentCaps
			c.ReplaceSessionState(st)
		}

		c.SetReplaying(true)
		loadResult, err := c.Request("session/load", map[string]any{
			"sessionId":  opts.ResumeID,
			"cwd":        opts.Cwd,
			"mcpServers": mcp,
		})
		if err != nil {
			c.SetReplaying(false)
			return HandshakeResult{}, err
		}
		loadedModel := extractModelFromSessionResult(loadResult)
		if loadedModel == "" {
			loadedModel = meta.Model
		}
		loadedModels := extractAvailableModelsFromSessionResult(loadResult)

		cur := c.GetSessionState()
		cur.ID = opts.ResumeID
		cur.Workspace = firstNonEmpty(opts.Cwd, cur.Workspace)
		if cur.Model == "" {
			cur.Model = loadedModel
		}
		if len(loadedModels) > 0 {
			cur.AvailableModels = loadedModels
		} else if len(cur.AvailableModels) == 0 {
			cur.AvailableModels = meta.AvailableModels
		}
		if cur.AgentCapabilities == nil {
			cur.AgentCapabilities = agentCaps
		}
		if cur.Status != StatusWaitingPermission {
			cur.Status = StatusIdle
		}
		cur.ErrorMessage = ""
		c.ReplaceSessionState(cur)
		c.SetReplaying(false)
		return HandshakeResult{Init: init, SessionID: opts.ResumeID, Resumed: true}, nil
	}

	// session/new
	sessionRaw, err := c.Request("session/new", map[string]any{
		"cwd":        opts.Cwd,
		"mcpServers": mcp,
	})
	if err != nil {
		return HandshakeResult{}, err
	}
	session, _ := sessionRaw.(map[string]any)
	sessionID, _ := session["sessionId"].(string)
	if sessionID == "" {
		return HandshakeResult{}, fmt.Errorf("session/new did not return sessionId")
	}
	newModel := extractModelFromSessionResult(session)
	if newModel == "" {
		newModel = meta.Model
	}
	sessionModels := extractAvailableModelsFromSessionResult(session)
	if len(sessionModels) == 0 {
		sessionModels = meta.AvailableModels
	}

	interim := c.GetSessionState()
	st := EmptySession(sessionID, opts.Cwd, newModel, firstNonEmpty(interim.Mode, "build"))
	st.AvailableModels = sessionModels
	st.AvailableCommands = preferCommands(interim.AvailableCommands, meta.AvailableCommands)
	st.AgentCapabilities = agentCaps
	st.ConfigOptions = interim.ConfigOptions
	st.Title = interim.Title
	c.ReplaceSessionState(st)

	return HandshakeResult{Init: init, SessionID: sessionID, Resumed: false}, nil
}

type initMeta struct {
	Model             string
	AvailableModels   []AvailableModel
	AvailableCommands []any
}

func extractInitializeMetadata(init map[string]any) initMeta {
	meta, _ := init["_meta"].(map[string]any)
	modelState, _ := meta["modelState"].(map[string]any)
	rawModels := firstArray(init["availableModels"], modelState["availableModels"])
	models := normalizeAvailableModels(rawModels)

	model := ""
	if modelState != nil {
		if m, ok := modelState["model"].(string); ok {
			model = m
		} else if m, ok := modelState["currentModel"].(string); ok {
			model = m
		} else if m, ok := modelState["modelId"].(string); ok {
			model = m
		}
	}
	if model == "" && len(models) > 0 {
		model = models[0].ID
	}

	rawCmds := firstArray(init["availableCommands"], meta["availableCommands"])
	return initMeta{
		Model:             model,
		AvailableModels:   models,
		AvailableCommands: rawCmds,
	}
}

func authMethodSet(init map[string]any) map[string]bool {
	out := map[string]bool{}
	raw, _ := init["authMethods"].([]any)
	for _, m := range raw {
		if rec, ok := m.(map[string]any); ok {
			if id, ok := rec["id"].(string); ok && id != "" {
				out[id] = true
			}
		}
	}
	return out
}

func extractModelFromSessionResult(result any) string {
	rec, _ := result.(map[string]any)
	if rec == nil {
		return ""
	}
	if m, ok := rec["model"].(string); ok && m != "" {
		return m
	}
	meta, _ := rec["_meta"].(map[string]any)
	if meta != nil {
		if m, ok := meta["model"].(string); ok {
			return m
		}
		ms, _ := meta["modelState"].(map[string]any)
		if ms != nil {
			if m, ok := ms["model"].(string); ok {
				return m
			}
		}
	}
	return ""
}

func extractAvailableModelsFromSessionResult(result any) []AvailableModel {
	rec, _ := result.(map[string]any)
	if rec == nil {
		return nil
	}
	if arr, ok := rec["availableModels"].([]any); ok {
		return normalizeAvailableModels(arr)
	}
	meta, _ := rec["_meta"].(map[string]any)
	if meta != nil {
		ms, _ := meta["modelState"].(map[string]any)
		if ms != nil {
			if arr, ok := ms["availableModels"].([]any); ok {
				return normalizeAvailableModels(arr)
			}
		}
		if arr, ok := meta["availableModels"].([]any); ok {
			return normalizeAvailableModels(arr)
		}
	}
	return nil
}

func normalizeAvailableModels(raw any) []AvailableModel {
	arr, _ := raw.([]any)
	ids := map[string]bool{}
	var models []AvailableModel
	for _, item := range arr {
		if s, ok := item.(string); ok {
			id := strings.TrimSpace(s)
			if id == "" || ids[id] {
				continue
			}
			ids[id] = true
			models = append(models, AvailableModel{ID: id})
			continue
		}
		rec, _ := item.(map[string]any)
		if rec == nil {
			continue
		}
		id := strings.TrimSpace(fmt.Sprint(firstNonNil(rec["id"], rec["modelId"], rec["value"], rec["name"], "")))
		if id == "" || id == "<nil>" || ids[id] {
			continue
		}
		ids[id] = true
		m := AvailableModel{ID: id}
		if n, ok := rec["name"].(string); ok && strings.TrimSpace(n) != "" {
			m.Name = strings.TrimSpace(n)
		} else if n, ok := rec["label"].(string); ok && strings.TrimSpace(n) != "" {
			m.Name = strings.TrimSpace(n)
		}
		// Context window: model `_meta.totalContextTokens` (grok-build) or top-level.
		// Must survive JSON to the desktop or the composer ring stays at "No turns yet".
		if n := readPositiveInt(rec["totalContextTokens"]); n > 0 {
			m.TotalContextTokens = n
		} else if meta, ok := rec["_meta"].(map[string]any); ok {
			if n := readPositiveInt(meta["totalContextTokens"]); n > 0 {
				m.TotalContextTokens = n
			}
		}
		models = append(models, m)
	}
	return models
}

// readPositiveInt reads a finite integer ≥ 1 from JSON number or numeric string.
// Returns 0 when absent / invalid so callers can treat 0 as "unknown".
func readPositiveInt(v any) int {
	switch n := v.(type) {
	case float64:
		if n >= 1 {
			return int(n)
		}
	case int:
		if n >= 1 {
			return n
		}
	case int64:
		if n >= 1 {
			return int(n)
		}
	case json.Number:
		i, err := n.Int64()
		if err == nil && i >= 1 {
			return int(i)
		}
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return 0
		}
		i, err := strconv.ParseInt(s, 10, 64)
		if err == nil && i >= 1 {
			return int(i)
		}
	}
	return 0
}

func preferCommands(a, b []any) []any {
	if len(a) > 0 {
		return a
	}
	return b
}

func firstArray(vals ...any) []any {
	for _, v := range vals {
		if a, ok := v.([]any); ok {
			return a
		}
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}
