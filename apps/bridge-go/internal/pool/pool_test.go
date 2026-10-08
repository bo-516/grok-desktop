package pool

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

// mockStatus is a race-safe status cell shared by a mock runtime's GetStatus
// (read under the pool lock) and the test goroutine that flips it.
type mockStatus struct{ v atomic.Value }

// set stores the status the next GetStatus call returns.
// @param s New status.
func (m *mockStatus) set(s acp.SessionStatus) { m.v.Store(s) }

// get returns the current status.
// @returns The last value passed to set (the initial status until then).
func (m *mockStatus) get() acp.SessionStatus { return m.v.Load().(acp.SessionStatus) }

// mockRuntime builds a pool entry whose status can mutate via the returned cell.
// @param id Session id.
// @param status Initial status.
// @param lastUsed LRU timestamp ms (Insert overwrites it with a fresh stamp).
// @returns Runtime and a status cell tests may flip to idle for wait-on-full cases.
func mockRuntime(id string, status acp.SessionStatus, lastUsed int64) (*PooledRuntime, *mockStatus) {
	st := &mockStatus{}
	st.set(status)
	return &PooledRuntime{
		SessionID: id,
		Cwd:       "/tmp",
		LastUsed:  lastUsed,
		GetStatus: func() SessionStatus { return st.get() },
		GetSessionState: func() acp.SessionState {
			return acp.EmptySession(id, "/tmp", "", "build")
		},
		Prompt:            func(string, []ContentBlock) error { return nil },
		Cancel:            func() {},
		RespondPermission: func(string) error { return nil },
		Dispose:           func() {},
	}, st
}

// TestPoolUseStampsStrictlyIncrease: inserts and touches in the same
// millisecond still get distinct, ordered LastUsed stamps, so LRU reclaim
// never depends on map iteration order.
func TestPoolUseStampsStrictlyIncrease(t *testing.T) {
	p := NewRuntimePool(64)
	ids := []string{"s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"}
	for _, id := range ids {
		rt, _ := mockRuntime(id, acp.StatusIdle, 0)
		if err := p.Insert(rt); err != nil {
			t.Fatal(err)
		}
	}
	p.Touch("s0")
	order := append(ids[1:], "s0")
	var prev int64
	for i, id := range order {
		got := p.Get(id).LastUsed
		if i > 0 && got <= prev {
			t.Fatalf("%s stamp %d not after previous %d", id, got, prev)
		}
		prev = got
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
	a, _ := mockRuntime("a", acp.StatusIdle, time.Now().UnixMilli()-1000)
	b, _ := mockRuntime("b", acp.StatusIdle, time.Now().UnixMilli()-500)
	_ = p.Insert(a)
	_ = p.Insert(b)
	if p.Size() != 2 {
		t.Fatalf("size=%d", p.Size())
	}
	// Third insert should reclaim oldest idle (a).
	c, _ := mockRuntime("c", acp.StatusIdle, time.Now().UnixMilli())
	if err := p.Insert(c); err != nil {
		t.Fatal(err)
	}
	if p.Has("a") {
		t.Fatal("a should have been reclaimed")
	}
	if !p.Has("c") || !p.Has("b") {
		t.Fatal("b and c should remain")
	}
}

func TestPoolWaitsWhenFullAllBusyUntilIdle(t *testing.T) {
	p := NewRuntimePool(1)
	busy, st := mockRuntime("busy", acp.StatusStreaming, time.Now().UnixMilli())
	_ = p.Insert(busy)

	done := make(chan error, 1)
	go func() {
		other, _ := mockRuntime("other", acp.StatusIdle, time.Now().UnixMilli())
		done <- p.Insert(other)
	}()

	// Still busy: insert must not finish immediately.
	select {
	case err := <-done:
		t.Fatalf("insert should wait while busy, got err=%v", err)
	case <-time.After(150 * time.Millisecond):
	}

	// Flip to idle so reclaim frees the slot.
	st.set(acp.StatusIdle)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("insert did not complete after idle reclaim")
	}
	if !p.Has("other") {
		t.Fatal("other should be resident")
	}
	if p.Has("busy") {
		t.Fatal("busy should have been reclaimed")
	}
}

func TestPoolWaitsWhenFullUntilClose(t *testing.T) {
	p := NewRuntimePool(1)
	busy, _ := mockRuntime("busy", acp.StatusStreaming, time.Now().UnixMilli())
	_ = p.Insert(busy)

	done := make(chan error, 1)
	go func() {
		done <- p.BeginSpawn()
	}()

	select {
	case err := <-done:
		t.Fatalf("BeginSpawn should wait while full, got err=%v", err)
	case <-time.After(150 * time.Millisecond):
	}

	p.Close("busy")
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BeginSpawn did not complete after Close")
	}
	p.CancelSpawn()
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
	// disposed receives ids from Dispose, which the pool runs on its own goroutine.
	disposed := make(chan string, 4)
	p := NewRuntimePool(1)
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	// Concurrent second begin blocks until first reservation is inserted + reclaimable.
	secondDone := make(chan error, 1)
	go func() {
		secondDone <- p.BeginSpawn()
	}()
	select {
	case err := <-secondDone:
		t.Fatalf("second BeginSpawn should wait, got err=%v", err)
	case <-time.After(50 * time.Millisecond):
	}

	rt, _ := mockRuntime("a", acp.StatusIdle, 10)
	rt.Dispose = func() { disposed <- "a" }
	if err := p.Insert(rt); err != nil {
		t.Fatal(err)
	}
	if p.Size() != 1 {
		t.Fatalf("size=%d", p.Size())
	}

	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("second BeginSpawn did not complete after idle insert")
	}

	b, _ := mockRuntime("b", acp.StatusIdle, 20)
	if err := p.Insert(b); err != nil {
		t.Fatal(err)
	}
	if p.Size() != 1 {
		t.Fatalf("size=%d after reclaim", p.Size())
	}
	if !p.Has("b") {
		t.Fatal("b should remain")
	}
	// Reclaim disposes a on its own goroutine (go rt.Dispose()).
	select {
	case id := <-disposed:
		if id != "a" {
			t.Fatalf("expected a disposed, got %s", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected a disposed")
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

func TestBeginSpawnErrorsAfterDisposeAll(t *testing.T) {
	p := NewRuntimePool(1)
	busy, _ := mockRuntime("busy", acp.StatusStreaming, time.Now().UnixMilli())
	_ = p.Insert(busy)

	done := make(chan error, 1)
	go func() {
		done <- p.BeginSpawn()
	}()
	time.Sleep(50 * time.Millisecond)
	p.DisposeAll()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected disposed error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BeginSpawn did not exit after DisposeAll")
	}
}
