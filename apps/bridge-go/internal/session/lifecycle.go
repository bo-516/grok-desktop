package session

import (
	"fmt"
	"path/filepath"
	"sync"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
)

// HandlerState is focused session + default list cwd for the bridge.
type HandlerState struct {
	FocusedSessionID string
	DefaultListCwd   string
}

// LifecycleDeps are closures the lifecycle layer needs from the WS server.
type LifecycleDeps struct {
	Pool          *pool.RuntimePool
	AlwaysApprove bool
	State         *HandlerState
	SessionSeeds  *sync.Map // sessionId -> acp.SessionState
	Broadcast     func(msg map[string]any)
	BroadcastPool func()
}

type lifecycleFingerprint struct {
	status  acp.SessionStatus
	permKey string
	model   string
	mode    string
	id      string
}

func lifecycleFP(session acp.SessionState) lifecycleFingerprint {
	permKey := ""
	if session.PendingPermission != nil {
		tcID := ""
		if session.PendingPermission.ToolCall != nil {
			if v, ok := session.PendingPermission.ToolCall["toolCallId"].(string); ok {
				tcID = v
			}
		}
		permKey = fmt.Sprintf("%v:%s", session.PendingPermission.RequestID, tcID)
	}
	return lifecycleFingerprint{
		status: session.Status, permKey: permKey,
		model: session.Model, mode: session.Mode, id: session.ID,
	}
}

func lifecycleChanged(prev *lifecycleFingerprint, next lifecycleFingerprint) bool {
	if prev == nil {
		return true
	}
	return prev.status != next.status ||
		prev.permKey != next.permKey ||
		prev.model != next.model ||
		prev.mode != next.mode ||
		prev.id != next.id
}

// StartOrResume acquires a pool slot or reuses a live session (relay freeze).
// Unexpected agent exit triggers seed-based session/load recovery.
func StartOrResume(deps LifecycleDeps, opts struct {
	Cwd           string
	AlwaysApprove bool
	ResumeID      string
	Seed          *acp.SessionState
	ForceNew      bool
	SpawnConfig   *pool.SessionSpawnConfig
}) error {
	cwd, err := filepath.Abs(opts.Cwd)
	if err != nil {
		return err
	}
	deps.State.DefaultListCwd = cwd

	// Resume already in pool: zero spawn.
	if opts.ResumeID != "" && !opts.ForceNew && deps.Pool.Has(opts.ResumeID) {
		rt := deps.Pool.Get(opts.ResumeID)
		if rt != nil {
			deps.Pool.Touch(opts.ResumeID)
			deps.State.FocusedSessionID = opts.ResumeID
			deps.Broadcast(map[string]any{"type": "state", "session": rt.GetSessionState()})
			deps.Broadcast(map[string]any{
				"type": "info", "message": "already live on " + opts.ResumeID,
				"sessionId": opts.ResumeID,
			})
			deps.BroadcastPool()
			return nil
		}
	}

	// Reuse focused live when no forceNew/resumeId.
	if !opts.ForceNew && opts.ResumeID == "" && deps.State.FocusedSessionID != "" &&
		deps.Pool.Has(deps.State.FocusedSessionID) {
		focused := deps.State.FocusedSessionID
		rt := deps.Pool.Get(focused)
		if rt != nil {
			deps.Pool.Touch(focused)
			deps.Broadcast(map[string]any{"type": "state", "session": rt.GetSessionState()})
			deps.Broadcast(map[string]any{
				"type": "info", "message": "reuse live " + focused, "sessionId": focused,
			})
			deps.BroadcastPool()
			return nil
		}
	}

	lastLifecycle := map[string]lifecycleFingerprint{}
	var lastLifecycleMu sync.Mutex

	resumeID := opts.ResumeID
	if opts.ForceNew {
		resumeID = ""
	}
	var seed *acp.SessionState
	if !opts.ForceNew {
		seed = opts.Seed
	}

	runtime, err := CreateSessionRuntime(CreateRuntimeOpts{
		Cwd:           cwd,
		AlwaysApprove: opts.AlwaysApprove,
		ResumeID:      resumeID,
		Seed:          seed,
		SpawnConfig:   opts.SpawnConfig,
		OnSessionUpdate: func(update map[string]any, sessionID string, eventID string) {
			msg := map[string]any{
				"type": "session_update", "sessionId": sessionID, "update": update,
			}
			if eventID != "" {
				msg["eventId"] = eventID
			}
			deps.Broadcast(msg)
		},
		OnState: func(session acp.SessionState) {
			if session.ID != "" {
				deps.SessionSeeds.Store(session.ID, session)
			}
			fp := lifecycleFP(session)
			lastLifecycleMu.Lock()
			var prev *lifecycleFingerprint
			if session.ID != "" {
				if p, ok := lastLifecycle[session.ID]; ok {
					pp := p
					prev = &pp
				}
				lastLifecycle[session.ID] = fp
			}
			lastLifecycleMu.Unlock()
			if !lifecycleChanged(prev, fp) {
				return
			}
			needsFullState := prev == nil ||
				prev.id != fp.id ||
				session.PendingPermission != nil ||
				(prev.permKey != "" && fp.permKey == "")
			if needsFullState {
				deps.Broadcast(map[string]any{"type": "state", "session": session})
			} else {
				msg := map[string]any{
					"type": "session_lifecycle", "sessionId": session.ID,
					"status": session.Status, "model": session.Model, "mode": session.Mode,
				}
				if session.PendingPermission != nil {
					msg["pendingPermission"] = session.PendingPermission
				} else {
					msg["pendingPermission"] = nil
				}
				deps.Broadcast(msg)
			}
			deps.BroadcastPool()
		},
		OnStderr: func(text, sessionID string) {
			deps.Broadcast(map[string]any{"type": "stderr", "text": text, "sessionId": sessionID})
		},
		OnInfo: func(message, sessionID string) {
			deps.Broadcast(map[string]any{"type": "info", "message": message, "sessionId": sessionID})
		},
		OnProcessExit: func(sessionID string, code *int) {
			if sessionID == "" {
				return
			}
			if !deps.Pool.Has(sessionID) {
				return
			}
			var seedPtr *acp.SessionState
			if v, ok := deps.SessionSeeds.Load(sessionID); ok {
				if s, ok := v.(acp.SessionState); ok {
					seedPtr = &s
				}
			}
			var spawnConfig *pool.SessionSpawnConfig
			exitCwd := deps.State.DefaultListCwd
			if rt := deps.Pool.Get(sessionID); rt != nil {
				spawnConfig = rt.SpawnConfig
				exitCwd = rt.Cwd
			}
			if seedPtr != nil && seedPtr.Workspace != "" {
				exitCwd = seedPtr.Workspace
			}
			deps.Pool.Close(sessionID)
			lastLifecycleMu.Lock()
			delete(lastLifecycle, sessionID)
			lastLifecycleMu.Unlock()
			codeStr := "null"
			if code != nil {
				codeStr = fmt.Sprintf("%d", *code)
			}
			deps.Broadcast(map[string]any{
				"type": "info",
				"message": fmt.Sprintf(
					"agent process exited (code %s); recovering via session/load…", codeStr),
				"sessionId": sessionID,
			})
			deps.BroadcastPool()
			go func() {
				err := StartOrResume(deps, struct {
					Cwd           string
					AlwaysApprove bool
					ResumeID      string
					Seed          *acp.SessionState
					ForceNew      bool
					SpawnConfig   *pool.SessionSpawnConfig
				}{
					Cwd: exitCwd, AlwaysApprove: deps.AlwaysApprove,
					ResumeID: sessionID, Seed: seedPtr, ForceNew: false,
					SpawnConfig: spawnConfig,
				})
				if err != nil {
					deps.Broadcast(map[string]any{
						"type": "error",
						"message": "crash recovery failed: " + err.Error(),
						"sessionId": sessionID,
					})
					deps.BroadcastPool()
				}
			}()
		},
	})
	if err != nil {
		return err
	}

	if err := deps.Pool.Insert(runtime); err != nil {
		runtime.Dispose()
		return err
	}
	deps.State.FocusedSessionID = runtime.SessionID
	initial := runtime.GetSessionState()
	deps.SessionSeeds.Store(runtime.SessionID, initial)
	lastLifecycleMu.Lock()
	lastLifecycle[runtime.SessionID] = lifecycleFP(initial)
	lastLifecycleMu.Unlock()
	deps.Broadcast(map[string]any{"type": "state", "session": initial})
	deps.BroadcastPool()
	return nil
}

// RestartSession restarts a session process with new SPAWN config then session/load.
func RestartSession(deps LifecycleDeps, sessionID string, spawnConfig *pool.SessionSpawnConfig, approve bool) error {
	existing := deps.Pool.Get(sessionID)
	var seed *acp.SessionState
	if existing != nil {
		s := existing.GetSessionState()
		seed = &s
	} else if v, ok := deps.SessionSeeds.Load(sessionID); ok {
		if s, ok := v.(acp.SessionState); ok {
			seed = &s
		}
	}
	cwd := deps.State.DefaultListCwd
	var prevSpawn *pool.SessionSpawnConfig
	if existing != nil {
		cwd = existing.Cwd
		prevSpawn = existing.SpawnConfig
		deps.Pool.Close(sessionID)
	} else if seed != nil && seed.Workspace != "" {
		cwd = seed.Workspace
	}
	cfg := spawnConfig
	if cfg == nil {
		cfg = prevSpawn
	}
	if err := StartOrResume(deps, struct {
		Cwd           string
		AlwaysApprove bool
		ResumeID      string
		Seed          *acp.SessionState
		ForceNew      bool
		SpawnConfig   *pool.SessionSpawnConfig
	}{
		Cwd: cwd, AlwaysApprove: approve, ResumeID: sessionID, Seed: seed,
		ForceNew: false, SpawnConfig: cfg,
	}); err != nil {
		return err
	}
	deps.Broadcast(map[string]any{
		"type": "info",
		"message": fmt.Sprintf("restarted session %s with updated SPAWN settings", sessionID),
		"sessionId": sessionID,
	})
	return nil
}

// RequireSessionRuntime resolves prompt/cancel/permission target.
func RequireSessionRuntime(p *pool.RuntimePool, focusedSessionID, sessionID string) (*pool.PooledRuntime, error) {
	id := sessionID
	if id == "" {
		id = focusedSessionID
	}
	if id == "" {
		return nil, fmt.Errorf("session not started")
	}
	rt := p.Get(id)
	if rt == nil {
		return nil, fmt.Errorf("session not in pool: %s", id)
	}
	return rt, nil
}
