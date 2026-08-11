package session

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/reverse"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// CreateRuntimeOpts configures one session process + handshake.
type CreateRuntimeOpts struct {
	Cwd             string
	AlwaysApprove   bool
	ResumeID        string
	Seed            *acp.SessionState
	SpawnConfig     *pool.SessionSpawnConfig
	OnState         func(session acp.SessionState)
	OnSessionUpdate func(update map[string]any, sessionID string, eventID string)
	// OnReplayBegin/OnReplayEnd frame the session/load batch window for WS.
	OnReplayBegin func(sessionID string)
	OnReplayEnd   func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, count, bytes int, elapsedMs int64)
	OnStderr      func(text, sessionID string)
	OnInfo        func(message, sessionID string)
	OnProcessExit func(sessionID string, code *int)
}

// BuildSpawnExtraArgs maps SPAWN config to CLI args for `grok agent` (before stdio).
func BuildSpawnExtraArgs(cfg *pool.SessionSpawnConfig, alwaysApprove bool) []string {
	var args []string
	if alwaysApprove || (cfg != nil && cfg.AlwaysApprove) {
		args = append(args, "--always-approve")
	}
	if cfg == nil {
		return args
	}
	if cfg.Model != "" {
		args = append(args, "--model", cfg.Model)
	}
	if cfg.Sandbox != "" {
		args = append(args, "--sandbox", cfg.Sandbox)
	}
	switch w := cfg.Worktree.(type) {
	case bool:
		if w {
			args = append(args, "--worktree")
		}
	case string:
		if w != "" {
			args = append(args, "--worktree", w)
		}
	}
	if cfg.Ref != "" {
		args = append(args, "--ref", cfg.Ref)
	}
	if cfg.MaxTurns > 0 {
		args = append(args, "--max-turns", strconv.Itoa(cfg.MaxTurns))
	}
	if cfg.NoPlan {
		args = append(args, "--no-plan")
	}
	if cfg.NoSubagents {
		args = append(args, "--no-subagents")
	}
	if cfg.Rules != "" {
		args = append(args, "--rules", cfg.Rules)
	}
	if cfg.DisableWebSearch {
		args = append(args, "--disable-web-search")
	}
	if cfg.Trust {
		args = append(args, "--trust")
	}
	if cfg.Effort != "" {
		args = append(args, "--reasoning-effort", cfg.Effort)
	}
	if cfg.PermissionMode != "" {
		args = append(args, "--permission-mode", cfg.PermissionMode)
	}
	for _, rule := range cfg.AllowRules {
		if t := stringsTrim(rule); t != "" {
			args = append(args, "--allow", t)
		}
	}
	for _, rule := range cfg.DenyRules {
		if t := stringsTrim(rule); t != "" {
			args = append(args, "--deny", t)
		}
	}
	if len(cfg.ExtraArgs) > 0 {
		args = append(args, cfg.ExtraArgs...)
	}
	return args
}

// CreateSessionRuntime spawns grok, handshakes, and returns a poolable runtime.
// On failure the child is disposed and the error is returned.
func CreateSessionRuntime(opts CreateRuntimeOpts) (*pool.PooledRuntime, error) {
	cwd, err := filepath.Abs(opts.Cwd)
	if err != nil {
		return nil, err
	}
	extraArgs := BuildSpawnExtraArgs(opts.SpawnConfig, opts.AlwaysApprove)
	envBag := map[string]string{}
	if opts.SpawnConfig != nil {
		for k, v := range opts.SpawnConfig.Env {
			envBag[k] = v
		}
		if opts.SpawnConfig.WebFetch {
			envBag["GROK_WEB_FETCH"] = "1"
		}
	}
	var env map[string]string
	if len(envBag) > 0 {
		env = envBag
	}

	proc, err := spawn.SpawnGrokAgent(spawn.Options{
		Cwd:           cwd,
		AlwaysApprove: false, // already folded into extraArgs
		ExtraArgs:     extraArgs,
		Env:           env,
	})
	if err != nil {
		return nil, err
	}

	terminals := reverse.NewTerminalRegistry()
	sessionIDHint := opts.ResumeID

	autoPerm := ""
	if opts.AlwaysApprove {
		autoPerm = "allow_once"
	}

	var client *acp.Client
	client = acp.NewClient(acp.ClientOptions{
		Transport:            proc.Transport,
		SettleQuietMs:        300,
		AutoPermissionOption: autoPerm,
		OnStateChange: func(session acp.SessionState) {
			if session.ID != "" {
				sessionIDHint = session.ID
			}
			if opts.OnState != nil {
				opts.OnState(session)
			}
		},
		OnSessionUpdate: func(update map[string]any, sessionID string, eventID string) {
			id := sessionID
			if id == "" {
				id = sessionIDHint
			}
			if opts.OnSessionUpdate != nil {
				opts.OnSessionUpdate(update, id, eventID)
			}
		},
		OnReplayBegin: func(sessionID string) {
			id := sessionID
			if id == "" {
				id = sessionIDHint
			}
			if opts.OnReplayBegin != nil {
				opts.OnReplayBegin(id)
			}
		},
		OnReplayEnd: func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, count, bytes int, elapsedMs int64) {
			id := sessionID
			if id == "" {
				id = sessionIDHint
			}
			if opts.OnReplayEnd != nil {
				opts.OnReplayEnd(id, updates, status, model, mode, count, bytes, elapsedMs)
			}
		},
		OnStderr: func(text string) {
			_, _ = os.Stderr.WriteString(text)
			if opts.OnStderr != nil {
				opts.OnStderr(text, sessionIDHint)
			}
		},
		OnAgentRequest: func(method string, id any, params any) (any, error) {
			result, err := reverse.HandleReverseRequest(method, params, cwd, terminals)
			if err != nil {
				if mnf, ok := err.(*reverse.MethodNotFoundError); ok {
					return nil, &acp.MethodNotFoundError{Method: mnf.Method}
				}
				return nil, err
			}
			return result, nil
		},
	})

	// Process exit callback (transport close also fires).
	proc.Transport.OnClose(func(code *int) {
		if opts.OnProcessExit != nil {
			opts.OnProcessExit(sessionIDHint, code)
		}
	})

	dispose := func() {
		terminals.DisposeAll()
		client.Dispose()
		proc.Dispose()
	}

	if opts.Seed != nil && opts.ResumeID != "" && opts.Seed.ID == opts.ResumeID {
		seed := *opts.Seed
		seed.Workspace = cwd
		seed.Status = acp.StatusIdle
		seed.PendingPermission = nil
		client.ReplaceSessionState(seed)
		if opts.OnState != nil {
			opts.OnState(client.GetSessionState())
		}
	}

	hs, err := client.Handshake(acp.HandshakeOpts{
		Cwd:              cwd,
		ResumeID:         opts.ResumeID,
		Seed:             opts.Seed,
		EnvAPIKeyPresent: stringsTrim(os.Getenv("XAI_API_KEY")) != "",
		ClientCapabilities: map[string]any{
			"fs":       map[string]any{"readTextFile": true, "writeTextFile": true},
			"terminal": true,
		},
	})
	if err != nil {
		dispose()
		return nil, err
	}

	sessionIDHint = hs.SessionID
	if opts.OnInfo != nil {
		if hs.Resumed {
			opts.OnInfo(fmt.Sprintf("resumed session %s", hs.SessionID), hs.SessionID)
		} else {
			opts.OnInfo(fmt.Sprintf("session %s ready", hs.SessionID), hs.SessionID)
		}
	}
	if opts.OnState != nil {
		opts.OnState(client.GetSessionState())
	}

	runtime := &pool.PooledRuntime{
		SessionID:   hs.SessionID,
		Cwd:         cwd,
		LastUsed:    time.Now().UnixMilli(),
		SpawnConfig: opts.SpawnConfig,
		GetStatus: func() acp.SessionStatus {
			return client.GetSessionState().Status
		},
		GetSessionState: func() acp.SessionState {
			return client.GetSessionState()
		},
		Prompt: func(text string, blocks []acp.ContentBlock) error {
			if len(blocks) > 0 {
				_, err := client.Prompt(hs.SessionID, blocks)
				return err
			}
			_, err := client.Prompt(hs.SessionID, []acp.ContentBlock{
				{"type": "text", "text": text},
			})
			return err
		},
		Cancel: func() {
			client.Cancel(hs.SessionID)
		},
		RespondPermission: func(optionID string) error {
			return client.RespondPermission(optionID)
		},
		Dispose: dispose,
	}
	return runtime, nil
}

func stringsTrim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}
