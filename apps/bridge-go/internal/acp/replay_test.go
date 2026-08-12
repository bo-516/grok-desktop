package acp_test

import (
	"fmt"
	"sync"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

// fakeTransport records writes and lets tests inject lines.
type fakeTransport struct {
	mu      sync.Mutex
	onLine  func(line string)
	onClose func(code *int)
	writes  []string
}

func (t *fakeTransport) Write(line string) {
	t.mu.Lock()
	t.writes = append(t.writes, line)
	t.mu.Unlock()
}
func (t *fakeTransport) OnLine(h func(line string))    { t.onLine = h }
func (t *fakeTransport) OnClose(h func(code *int))     { t.onClose = h }
func (t *fakeTransport) OnStderr(h func(chunk string)) {}
func (t *fakeTransport) Dispose()                      {}
func (t *fakeTransport) inject(line string) {
	if t.onLine != nil {
		t.onLine(line)
	}
}

func sessionUpdateLine(sessionID, eventID, text string) string {
	// Minimal NDJSON session/update notification.
	return fmt.Sprintf(
		`{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":%q,"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":%q}},"_meta":{"eventId":%q}}}`,
		sessionID, text, eventID,
	)
}

func TestReplayBufferedNotBroadcast(t *testing.T) {
	tr := &fakeTransport{}
	var liveUpdates int
	var begins int
	var ends int
	client := acp.NewClient(acp.ClientOptions{
		Transport: tr,
		OnSessionUpdate: func(update map[string]any, sessionID string, eventID string) {
			liveUpdates++
		},
		OnReplayBegin: func(sessionID string) { begins++ },
		OnReplayEnd: func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, count, bytes int, elapsedMs int64) {
			ends++
		},
	})
	client.ReplaceSessionState(acp.EmptySession("s1", "/w", "m", "build"))
	client.SetReplaying(true)
	if begins != 1 {
		t.Fatalf("expected 1 begin, got %d", begins)
	}
	for i := 0; i < 10; i++ {
		tr.inject(sessionUpdateLine("s1", fmt.Sprintf("e%d", i), fmt.Sprintf("w%d ", i)))
	}
	if liveUpdates != 0 {
		t.Fatalf("expected 0 live OnSessionUpdate during replay, got %d", liveUpdates)
	}
	client.SetReplaying(false)
	if ends != 1 {
		t.Fatalf("expected 1 end, got %d", ends)
	}
}

func TestReplayEndCarriesUpdates(t *testing.T) {
	tr := &fakeTransport{}
	var got []acp.ReplayBufferedUpdate
	client := acp.NewClient(acp.ClientOptions{
		Transport: tr,
		OnReplayEnd: func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, count, bytes int, elapsedMs int64) {
			got = append([]acp.ReplayBufferedUpdate{}, updates...)
		},
	})
	client.ReplaceSessionState(acp.EmptySession("s1", "/w", "m", "build"))
	client.SetReplaying(true)
	order := []string{"a", "b", "c"}
	for i, text := range order {
		tr.inject(sessionUpdateLine("s1", fmt.Sprintf("e%d", i), text))
	}
	client.SetReplaying(false)
	if len(got) != 3 {
		t.Fatalf("expected 3 updates, got %d", len(got))
	}
	for i, text := range order {
		content, _ := got[i].Update["content"].(map[string]any)
		if content == nil || content["text"] != text {
			t.Fatalf("update %d text want %q got %#v", i, text, got[i].Update)
		}
		if got[i].EventID != fmt.Sprintf("e%d", i) {
			t.Fatalf("eventId %d want e%d got %s", i, i, got[i].EventID)
		}
	}
}

func TestReplayEndOnLoadError(t *testing.T) {
	// Load failure path: SetReplaying(false) must still flush buffer + end.
	tr := &fakeTransport{}
	var ends int
	var count int
	client := acp.NewClient(acp.ClientOptions{
		Transport: tr,
		OnReplayEnd: func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, countIn, bytes int, elapsedMs int64) {
			ends++
			count = countIn
		},
	})
	client.ReplaceSessionState(acp.EmptySession("s-err", "/w", "m", "build"))
	client.SetReplaying(true)
	tr.inject(sessionUpdateLine("s-err", "e0", "partial"))
	// Simulate handshake load failure cleanup.
	client.SetReplaying(false)
	if ends != 1 {
		t.Fatalf("expected replay_end on load error, got %d", ends)
	}
	if count != 1 {
		t.Fatalf("expected buffered count 1, got %d", count)
	}
	if client.IsReplaying() {
		t.Fatal("window must be closed after SetReplaying(false)")
	}
}

func TestReplayBufferCap(t *testing.T) {
	tr := &fakeTransport{}
	var endCounts []int
	var begins int
	client := acp.NewClient(acp.ClientOptions{
		Transport:     tr,
		OnReplayBegin: func(sessionID string) { begins++ },
		OnReplayEnd: func(sessionID string, updates []acp.ReplayBufferedUpdate, status acp.SessionStatus, model, mode string, count, bytes int, elapsedMs int64) {
			endCounts = append(endCounts, count)
		},
	})
	client.ReplaceSessionState(acp.EmptySession("s-cap", "/w", "m", "build"))
	client.SetReplaying(true)
	// Inject more than ReplayMaxUpdates to force mid-window flushes.
	// Use a smaller loop if test time is a concern — still must multi-flush.
	n := acp.ReplayMaxUpdates + 50
	for i := 0; i < n; i++ {
		tr.inject(sessionUpdateLine("s-cap", fmt.Sprintf("e%d", i), "x"))
	}
	client.SetReplaying(false)
	if len(endCounts) < 2 {
		t.Fatalf("expected multi-end from cap, got ends=%v begins=%d", endCounts, begins)
	}
	// begins: initial + one per mid-cap re-open
	if begins < 2 {
		t.Fatalf("expected re-open begins after cap, got %d", begins)
	}
	total := 0
	for _, c := range endCounts {
		total += c
	}
	if total != n {
		t.Fatalf("expected total buffered %d, got %d from %v", n, total, endCounts)
	}
}

func TestReplayWindowIsPerSessionLive(t *testing.T) {
	// Two clients: one replaying must not affect the other's live fan-out.
	tr1 := &fakeTransport{}
	tr2 := &fakeTransport{}
	var live2 int
	c1 := acp.NewClient(acp.ClientOptions{
		Transport: tr1,
		OnSessionUpdate: func(update map[string]any, sessionID string, eventID string) {
			t.Fatal("s1 should not live-fan-out during replay")
		},
	})
	c2 := acp.NewClient(acp.ClientOptions{
		Transport: tr2,
		OnSessionUpdate: func(update map[string]any, sessionID string, eventID string) {
			live2++
		},
	})
	c1.ReplaceSessionState(acp.EmptySession("s1", "/w", "m", "build"))
	c2.ReplaceSessionState(acp.EmptySession("s2", "/w", "m", "build"))
	c1.SetReplaying(true)
	tr1.inject(sessionUpdateLine("s1", "e1", "hist"))
	tr2.inject(sessionUpdateLine("s2", "e2", "live"))
	if live2 != 1 {
		t.Fatalf("s2 live updates want 1 got %d", live2)
	}
	c1.SetReplaying(false)
}
