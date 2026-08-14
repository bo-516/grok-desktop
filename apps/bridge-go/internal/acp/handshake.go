package acp

import (
	"fmt"
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
			// Catalog seed never persists slash commands; initialize `_meta`
			// (and any in-flight available_commands_update) must refill them
			// or `/` stays empty after every resume.
			seed.AvailableCommands = preferCommands(seed.AvailableCommands, meta.AvailableCommands)
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
		cur.AvailableModels = preferAvailableModels(
			loadedModels,
			cur.AvailableModels,
			meta.AvailableModels,
		)
		if cur.AgentCapabilities == nil {
			cur.AgentCapabilities = agentCaps
		}
		// session/load replay may have already stored a catalog via
		// available_commands_update; prefer that, then initialize `_meta`.
		cur.AvailableCommands = preferCommands(cur.AvailableCommands, meta.AvailableCommands)
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
	interim := c.GetSessionState()
	st := EmptySession(sessionID, opts.Cwd, newModel, firstNonEmpty(interim.Mode, "build"))
	st.AvailableModels = preferAvailableModels(
		sessionModels,
		interim.AvailableModels,
		meta.AvailableModels,
	)
	st.AvailableCommands = preferCommands(interim.AvailableCommands, meta.AvailableCommands)
	st.AgentCapabilities = agentCaps
	st.ConfigOptions = interim.ConfigOptions
	st.Title = interim.Title
	c.ReplaceSessionState(st)

	return HandshakeResult{Init: init, SessionID: sessionID, Resumed: false}, nil
}
