package pool

import (
	"testing"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

func mockRuntime(id string, status acp.SessionStatus, lastUsed int64) *PooledRuntime {
	st := status
	return &PooledRuntime{
		SessionID: id,
		Cwd:       "/tmp",
		LastUsed:  lastUsed,
		GetStatus: func() SessionStatus { return st },
		GetSessionState: func() acp.SessionState {
			return acp.EmptySession(id, "/tmp", "", "build")
		},
		Prompt:            func(string, []ContentBlock) error { return nil },
		Cancel:            func() {},
		RespondPermission: func(string) error { return nil },
		Dispose:           func() {},
	}
}

func TestPickLruIdleVictim(t *testing.T) {
	entries := []struct {
		SessionID string
		LastUsed  int64
		Status    SessionStatus
	}{
		{"busy", 1, acp.StatusStreaming},
		{"old-idle", 10, acp.StatusIdle},
		{"new-idle", 100, acp.StatusIdle},
	}
	got := PickLruIdleVictim(entries)
	if got != "old-idle" {
		t.Fatalf("want old-idle got %s", got)
	}
}

func TestPoolInsertReclaimIdle(t *testing.T) {
	p := NewRuntimePool(2)
	_ = p.Insert(mockRuntime("a", acp.StatusIdle, time.Now().UnixMilli()-1000))
	_ = p.Insert(mockRuntime("b", acp.StatusIdle, time.Now().UnixMilli()-500))
	if p.Size() != 2 {
		t.Fatalf("size=%d", p.Size())
	}
	// Third insert should reclaim oldest idle (a).
	if err := p.Insert(mockRuntime("c", acp.StatusIdle, time.Now().UnixMilli())); err != nil {
		t.Fatal(err)
	}
	if p.Has("a") {
		t.Fatal("a should have been reclaimed")
	}
	if !p.Has("c") || !p.Has("b") {
		t.Fatal("b and c should remain")
	}
}

func TestPoolFullAllBusy(t *testing.T) {
	p := NewRuntimePool(1)
	_ = p.Insert(mockRuntime("busy", acp.StatusStreaming, time.Now().UnixMilli()))
	err := p.Insert(mockRuntime("other", acp.StatusIdle, time.Now().UnixMilli()))
	if err == nil {
		t.Fatal("expected full pool error")
	}
}

func TestIsIdleStatus(t *testing.T) {
	if !IsIdleStatus(acp.StatusIdle) || !IsIdleStatus(acp.StatusDisconnected) {
		t.Fatal("idle/disconnected should be idle")
	}
	if IsIdleStatus(acp.StatusStreaming) || IsIdleStatus(acp.StatusWaitingPermission) {
		t.Fatal("streaming/permission should be busy")
	}
}

func TestBeginSpawnReservesCapacity(t *testing.T) {
	disposed := []string{}
	p := NewRuntimePool(1)
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	// Concurrent second begin must fail while first reservation is held.
	if err := p.BeginSpawn(); err == nil {
		t.Fatal("expected full pool on second BeginSpawn")
	}
	rt := mockRuntime("a", acp.StatusIdle, 10)
	rt.Dispose = func() { disposed = append(disposed, "a") }
	if err := p.Insert(rt); err != nil {
		t.Fatal(err)
	}
	if p.Size() != 1 {
		t.Fatalf("size=%d", p.Size())
	}
	// After insert, a new spawn can reclaim the idle resident.
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	if err := p.Insert(mockRuntime("b", acp.StatusIdle, 20)); err != nil {
		t.Fatal(err)
	}
	if p.Size() != 1 {
		t.Fatalf("size=%d after reclaim", p.Size())
	}
	if !p.Has("b") {
		t.Fatal("b should remain")
	}
	// Give async dispose a moment (go old.Dispose).
	time.Sleep(20 * time.Millisecond)
	found := false
	for _, id := range disposed {
		if id == "a" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a disposed, got %v", disposed)
	}
}

func TestCancelSpawnReleasesReservation(t *testing.T) {
	p := NewRuntimePool(1)
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	p.CancelSpawn()
	// Second begin must succeed once the first reservation is cancelled.
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	p.CancelSpawn()
}
