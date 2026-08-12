// Package pool implements the multi-session RuntimePool with idle LRU reclaim.
package pool

import (
	"fmt"
	"sync"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

// SessionStatus alias for pool status checks.
type SessionStatus = acp.SessionStatus

// ContentBlock is a prompt block forwarded to the runtime.
type ContentBlock = acp.ContentBlock

// SessionSpawnConfig holds SPAWN flags used at process start (for restart).
type SessionSpawnConfig struct {
	Model            string            `json:"model,omitempty"`
	Sandbox          string            `json:"sandbox,omitempty"`
	AlwaysApprove    bool              `json:"alwaysApprove,omitempty"`
	Worktree         any               `json:"worktree,omitempty"` // bool | string
	Ref              string            `json:"ref,omitempty"`
	MaxTurns         int               `json:"maxTurns,omitempty"`
	NoPlan           bool              `json:"noPlan,omitempty"`
	NoSubagents      bool              `json:"noSubagents,omitempty"`
	Rules            string            `json:"rules,omitempty"`
	DisableWebSearch bool              `json:"disableWebSearch,omitempty"`
	WebFetch         bool              `json:"webFetch,omitempty"`
	Trust            bool              `json:"trust,omitempty"`
	Effort           string            `json:"effort,omitempty"`
	PermissionMode   string            `json:"permissionMode,omitempty"`
	AllowRules       []string          `json:"allowRules,omitempty"`
	DenyRules        []string          `json:"denyRules,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
	ExtraArgs        []string          `json:"extraArgs,omitempty"`
}

// PooledRuntime is one resident ACP session process.
type PooledRuntime struct {
	SessionID   string
	Cwd         string
	LastUsed    int64
	SpawnConfig *SessionSpawnConfig

	GetStatus         func() SessionStatus
	GetSessionState   func() acp.SessionState
	Prompt            func(text string, blocks []ContentBlock) error
	Cancel            func()
	RespondPermission func(optionID string) error
	// Mid-session ACP ops (nil when the agent/runtime does not expose them).
	SetModel     func(modelID string) error
	SetMode      func(modeID string) error
	Compact      func(instruction string) error
	TokenUsage   func() (any, error)
	ForkSession  func(sourceCwd, newCwd string) (any, error)
	Dispose      func()
}

// PoolEntry is the UI rail summary for one resident process.
type PoolEntry struct {
	SessionID string        `json:"sessionId"`
	Cwd       string        `json:"cwd"`
	Status    SessionStatus `json:"status"`
	LastUsed  int64         `json:"lastUsed"`
	Live      bool          `json:"live"`
}

// RuntimePool is a capacity-bounded map of live session runtimes.
// Idle (idle/disconnected) entries are reclaimed LRU; busy never evicted.
// In-flight spawns (BeginSpawn … Insert/CancelSpawn) count against capacity so
// concurrent start/recovery cannot overshoot (mirrors Node RuntimePool).
type RuntimePool struct {
	Capacity int
	mu       sync.Mutex
	// map insertion order is not LRU; we track LastUsed and sort on reclaim.
	m map[string]*PooledRuntime
	// pendingSpawns is the number of BeginSpawn reservations not yet Insert/CancelSpawn.
	pendingSpawns int
}

// NewRuntimePool creates a pool with at least capacity 1.
func NewRuntimePool(capacity int) *RuntimePool {
	if capacity < 1 {
		capacity = 1
	}
	return &RuntimePool{
		Capacity: capacity,
		m:        make(map[string]*PooledRuntime),
	}
}

// Size returns the resident count.
func (p *RuntimePool) Size() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.m)
}

// Get returns a runtime by session id.
func (p *RuntimePool) Get(sessionID string) *PooledRuntime {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.m[sessionID]
}

// Has reports whether the pool holds a process for sessionID.
func (p *RuntimePool) Has(sessionID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, ok := p.m[sessionID]
	return ok
}

// Touch updates lastUsed for LRU bookkeeping.
func (p *RuntimePool) Touch(sessionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if rt, ok := p.m[sessionID]; ok {
		rt.LastUsed = time.Now().UnixMilli()
	}
}

// BeginSpawn reserves a pool slot before spawning a child process.
// Reclaims idle LRU when needed; returns error when all resident sessions are busy.
// Pair with Insert (consumes the reservation) or CancelSpawn on failure.
func (p *RuntimePool) BeginSpawn() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureRoomIncludingPendingLocked(); err != nil {
		return err
	}
	p.pendingSpawns++
	return nil
}

// CancelSpawn drops a reservation after spawn/handshake failure (no Insert).
func (p *RuntimePool) CancelSpawn() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pendingSpawns > 0 {
		p.pendingSpawns--
	}
}

// Insert adds or replaces a runtime; reclaims idle LRU when over capacity.
// Consumes one pending spawn reservation when present.
// Returns error when full and no idle victim exists.
func (p *RuntimePool) Insert(runtime *PooledRuntime) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if old, ok := p.m[runtime.SessionID]; ok && old != runtime {
		delete(p.m, runtime.SessionID)
		// Dispose outside? keep lock short — dispose after unlock would race;
		// dispose under lock is OK if Dispose does not re-enter pool.
		go old.Dispose()
	}
	// Consume reservation first so ensureCapacity does not count this spawn twice.
	if p.pendingSpawns > 0 {
		p.pendingSpawns--
	}
	if err := p.ensureCapacityForInsertLocked(); err != nil {
		return err
	}
	runtime.LastUsed = time.Now().UnixMilli()
	p.m[runtime.SessionID] = runtime
	return nil
}

// Close disposes and removes a session; returns whether it existed.
func (p *RuntimePool) Close(sessionID string) bool {
	p.mu.Lock()
	rt, ok := p.m[sessionID]
	if ok {
		delete(p.m, sessionID)
	}
	p.mu.Unlock()
	if ok {
		rt.Dispose()
	}
	return ok
}

// DisposeAll closes every child process.
func (p *RuntimePool) DisposeAll() {
	p.mu.Lock()
	rts := make([]*PooledRuntime, 0, len(p.m))
	for _, rt := range p.m {
		rts = append(rts, rt)
	}
	p.m = make(map[string]*PooledRuntime)
	p.mu.Unlock()
	for _, rt := range rts {
		rt.Dispose()
	}
}

// List returns pool summary sorted by lastUsed ascending (LRU first).
func (p *RuntimePool) List() []PoolEntry {
	p.mu.Lock()
	defer p.mu.Unlock()
	entries := make([]PoolEntry, 0, len(p.m))
	for _, rt := range p.m {
		status := acp.StatusIdle
		if rt.GetStatus != nil {
			status = rt.GetStatus()
		}
		entries = append(entries, PoolEntry{
			SessionID: rt.SessionID,
			Cwd:       rt.Cwd,
			Status:    status,
			LastUsed:  rt.LastUsed,
			Live:      true,
		})
	}
	// Simple insertion sort by lastUsed.
	for i := 1; i < len(entries); i++ {
		j := i
		for j > 0 && entries[j-1].LastUsed > entries[j].LastUsed {
			entries[j-1], entries[j] = entries[j], entries[j-1]
			j--
		}
	}
	return entries
}

// IsIdleStatus reports whether a session may be reclaimed by LRU.
func IsIdleStatus(status SessionStatus) bool {
	return status == acp.StatusIdle || status == acp.StatusDisconnected
}

// PickLruIdleVictim returns the oldest idle sessionId, or empty when none.
func PickLruIdleVictim(entries []struct {
	SessionID string
	LastUsed  int64
	Status    SessionStatus
}) string {
	var bestID string
	var bestUsed int64
	found := false
	for _, e := range entries {
		if !IsIdleStatus(e.Status) {
			continue
		}
		if !found || e.LastUsed < bestUsed {
			found = true
			bestID = e.SessionID
			bestUsed = e.LastUsed
		}
	}
	return bestID
}

// ensureCapacityForInsertLocked frees a resident slot for insert (not pending).
// Caller must hold p.mu.
func (p *RuntimePool) ensureCapacityForInsertLocked() error {
	for len(p.m) >= p.Capacity {
		if err := p.reclaimOneIdleOrThrowLocked(); err != nil {
			return err
		}
	}
	return nil
}

// ensureRoomIncludingPendingLocked frees room counting in-flight BeginSpawn.
// Caller must hold p.mu.
func (p *RuntimePool) ensureRoomIncludingPendingLocked() error {
	for len(p.m)+p.pendingSpawns >= p.Capacity {
		if err := p.reclaimOneIdleOrThrowLocked(); err != nil {
			return err
		}
	}
	return nil
}

// reclaimOneIdleOrThrowLocked evicts one idle LRU victim or errors when all-busy.
// Caller must hold p.mu.
func (p *RuntimePool) reclaimOneIdleOrThrowLocked() error {
	type snap struct {
		SessionID string
		LastUsed  int64
		Status    SessionStatus
	}
	entries := make([]snap, 0, len(p.m))
	for _, rt := range p.m {
		st := acp.StatusIdle
		if rt.GetStatus != nil {
			st = rt.GetStatus()
		}
		entries = append(entries, snap{rt.SessionID, rt.LastUsed, st})
	}
	converted := make([]struct {
		SessionID string
		LastUsed  int64
		Status    SessionStatus
	}, len(entries))
	for i, e := range entries {
		converted[i].SessionID = e.SessionID
		converted[i].LastUsed = e.LastUsed
		converted[i].Status = e.Status
	}
	victim := PickLruIdleVictim(converted)
	if victim == "" {
		return fmt.Errorf("RuntimePool full (%d): all sessions busy; close one or wait for idle", p.Capacity)
	}
	if rt, ok := p.m[victim]; ok {
		delete(p.m, victim)
		go rt.Dispose()
	}
	return nil
}
