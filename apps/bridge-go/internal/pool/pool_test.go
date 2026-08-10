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
