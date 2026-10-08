package sessionstream_test

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

// wireFrame is the subset of a relayed frame the tests inspect.
type wireFrame struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Epoch     string `json:"epoch"`
	Seq       int64  `json:"seq"`
	N         int    `json:"n"`
}

// clientLog records every frame one fake client received, in write order.
type clientLog struct {
	mu     sync.Mutex
	frames [][]byte
}

func (c *clientLog) add(raw []byte) {
	c.mu.Lock()
	c.frames = append(c.frames, append([]byte(nil), raw...))
	c.mu.Unlock()
}

// decoded returns the received frames decoded, optionally for one session.
func (c *clientLog) decoded(t *testing.T, sessionID string) []wireFrame {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []wireFrame{}
	for _, raw := range c.frames {
		var f wireFrame
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatalf("bad frame %s: %v", raw, err)
		}
		if sessionID == "" || f.SessionID == sessionID {
			out = append(out, f)
		}
	}
	return out
}

// newHubWithClients builds a hub whose write fans out to n fake clients the
// way Server.broadcastRaw does (one write mutex per client).
func newHubWithClients(cfg sessionstream.Config, n int) (*sessionstream.Hub, []*clientLog) {
	clients := make([]*clientLog, n)
	for i := range clients {
		clients[i] = &clientLog{}
	}
	hub := sessionstream.NewHub(cfg, func(raw []byte) {
		for _, c := range clients {
			c.add(raw)
		}
	})
	return hub, clients
}

// update builds a fresh session_update message (Publish mutates its map).
func update(sessionID string, n int) map[string]any {
	return map[string]any{"type": "session_update", "sessionId": sessionID, "n": n}
}

// assertContiguous fails unless frames carry epoch and seqs 1..len in order.
func assertContiguous(t *testing.T, frames []wireFrame, epoch sessionstream.Epoch) {
	t.Helper()
	for i, f := range frames {
		if f.Seq != int64(i+1) || f.Epoch != string(epoch) {
			t.Fatalf("frame %d: epoch=%q seq=%d, want %q/%d", i, f.Epoch, f.Seq, epoch, i+1)
		}
	}
}

func TestPublishStampsMonotonicSeqUnderConcurrentPublishers(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				hub.Publish("s1", epoch, update("s1", g*1000+i))
			}
		}(g)
	}
	wg.Wait()
	frames := clients[0].decoded(t, "s1")
	if len(frames) != 800 {
		t.Fatalf("got %d frames, want 800", len(frames))
	}
	// Write order must equal seq order even with racing publishers.
	assertContiguous(t, frames, epoch)
}

func TestConcurrentSessionsHaveIndependentSequences(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	var wg sync.WaitGroup
	for s := 0; s < 4; s++ {
		wg.Add(1)
		go func(s int) {
			defer wg.Done()
			id := fmt.Sprintf("s%d", s)
			for i := 0; i < 50+s*10; i++ {
				hub.Publish(id, epoch, update(id, i))
			}
		}(s)
	}
	wg.Wait()
	for s := 0; s < 4; s++ {
		frames := clients[0].decoded(t, fmt.Sprintf("s%d", s))
		if len(frames) != 50+s*10 {
			t.Fatalf("s%d: %d frames", s, len(frames))
		}
		assertContiguous(t, frames, epoch)
	}
}

func TestEveryClientSeesTheSameOrderPerSession(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 3)
	epoch := hub.NewEpoch()
	var wg sync.WaitGroup
	for g := 0; g < 6; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			id := fmt.Sprintf("s%d", g%2)
			for i := 0; i < 100; i++ {
				hub.Publish(id, epoch, update(id, g*1000+i))
			}
		}(g)
	}
	wg.Wait()
	for _, id := range []string{"s0", "s1"} {
		want := clients[0].decoded(t, id)
		assertContiguous(t, want, epoch)
		for c := 1; c < len(clients); c++ {
			got := clients[c].decoded(t, id)
			if len(got) != len(want) {
				t.Fatalf("client %d %s: %d frames, want %d", c, id, len(got), len(want))
			}
			for i := range want {
				if got[i] != want[i] {
					t.Fatalf("client %d %s frame %d differs: %+v vs %+v", c, id, i, got[i], want[i])
				}
			}
		}
	}
}

func TestNewEpochRestartsSeqAndDroppedEpochGoesUnstamped(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 1)
	e1 := hub.NewEpoch()
	for i := 0; i < 3; i++ {
		hub.Publish("s1", e1, update("s1", i))
	}
	e2 := hub.NewEpoch()
	if e1 == e2 {
		t.Fatal("epochs must be unique")
	}
	if seq := hub.Publish("s1", e2, update("s1", 10)); seq != 1 {
		t.Fatalf("new epoch must restart at seq 1, got %d", seq)
	}
	hub.DropEpoch(e1)
	if seq := hub.Publish("s1", e1, update("s1", 99)); seq != 0 {
		t.Fatalf("dropped epoch must publish unstamped, got seq %d", seq)
	}
	frames := clients[0].decoded(t, "s1")
	last := frames[len(frames)-1]
	if last.N != 99 || last.Epoch != "" || last.Seq != 0 {
		t.Fatalf("late frame from a dropped runtime must still relay unstamped: %+v", last)
	}
	if seq := hub.Publish("s1", e2, update("s1", 11)); seq != 2 {
		t.Fatalf("live epoch continues at 2, got %d", seq)
	}
}

func TestUnstampedWhenSessionOrEpochMissing(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	if seq := hub.Publish("", epoch, update("", 1)); seq != 0 {
		t.Fatalf("empty session id must not be stamped, got %d", seq)
	}
	if seq := hub.Publish("s1", "", update("s1", 2)); seq != 0 {
		t.Fatalf("empty epoch must not be stamped, got %d", seq)
	}
	if seq := hub.Publish("s1", "never-issued", update("s1", 3)); seq != 0 {
		t.Fatalf("unknown epoch must not be stamped, got %d", seq)
	}
	for _, f := range clients[0].decoded(t, "") {
		if f.Seq != 0 || f.Epoch != "" {
			t.Fatalf("frame must be unstamped: %+v", f)
		}
	}
	if n := len(clients[0].decoded(t, "")); n != 3 {
		t.Fatalf("unstamped frames must still be written, got %d", n)
	}
}

func TestWithHeadPrefersPrimaryEpochAndClearsOnDrop(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{}, 1)
	host := hub.NewEpoch() // parent process streaming the child
	own := hub.NewEpoch()  // the child opened on its own
	hub.BindPrimary("child", own)
	hub.Publish("child", own, update("child", 1))
	for i := 0; i < 4; i++ {
		hub.Publish("child", host, update("child", i))
	}
	check := func(wantEpoch sessionstream.Epoch, wantSeq int64) {
		t.Helper()
		hub.WithHead("child", func(epoch sessionstream.Epoch, head int64) {
			if epoch != wantEpoch || head != wantSeq {
				t.Fatalf("head = %q/%d, want %q/%d", epoch, head, wantEpoch, wantSeq)
			}
		})
	}
	check(own, 1)
	if hub.PrimaryEpoch("child") != own {
		t.Fatal("primary epoch must be the bound one")
	}
	hub.DropEpoch(own)
	if hub.PrimaryEpoch("child") != "" {
		t.Fatal("dropping the primary runtime clears the binding")
	}
	check(host, 4) // falls back to the remaining stream
	hub.DropEpoch(host)
	check("", 0)
}

func TestBindPrimaryBeforeFirstFrameIsClearedByDrop(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	hub.BindPrimary("s1", epoch)
	hub.DropEpoch(epoch)
	if hub.PrimaryEpoch("s1") != "" {
		t.Fatal("binding without frames must still be cleared on drop")
	}
}
