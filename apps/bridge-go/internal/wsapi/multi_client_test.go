// Multi-client bridge contract for side-by-side session windows.
//
// Each desktop window is its own WebSocket. These tests pin three facts:
//   - a permission answered on one socket clears on the other (state broadcast)
//   - a second answer does not emit a second agent response, and its error
//     stays on the answering socket
//   - closing one socket does not remove a session another socket can still read
//
// Uses GROK_BIN=scripts/fixtures/fake-grok. Not a product path.
package wsapi_test

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/wsapi"
)

// wsClient is one browser socket plus every text frame received so far.
// The log is append-only so a later assertion can see a frame that arrived
// before the assertion started (agent reply and permission-clear can reorder).
type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
	// log is the decoded frames in arrival order.
	log []map[string]any
	// notify wakes waitLog after a frame is appended. Capacity 1; extra wakes drop.
	notify chan struct{}
}

// startMultiClientServer binds an ephemeral bridge with the fake grok binary.
// mode is GROK_FAKE_MODE (parity or permission). The server is closed on cleanup.
func startMultiClientServer(t *testing.T, mode string) (*wsapi.Server, string) {
	t.Helper()
	root := repoRoot(t)
	fakeGrok := filepath.Join(root, "scripts", "fixtures", "fake-grok")
	if _, err := os.Stat(fakeGrok); err != nil {
		t.Fatalf("fake-grok missing: %v", err)
	}
	demo := filepath.Join(root, "demo")
	t.Setenv("GROK_BIN", fakeGrok)
	t.Setenv("GROK_FAKE_MODE", mode)

	cfg := wsapi.Config{
		Host:           "127.0.0.1",
		Port:           0,
		Cwd:            demo,
		AlwaysApprove:  false,
		PoolCapacity:   2,
		Token:          "multi-client-" + mode,
		AllowedOrigins: []string{"null", "http://localhost:5173"},
	}
	srv := wsapi.NewServer(cfg)
	go func() {
		_ = srv.ListenAndServe()
	}()
	t.Cleanup(func() {
		_ = srv.Close()
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		port := srv.BoundPort()
		if port > 0 {
			c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 100*time.Millisecond)
			if err == nil {
				_ = c.Close()
				return srv, fmt.Sprintf("127.0.0.1:%d", port)
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server did not bind a port")
	return nil, ""
}

// dialClient opens one authorized socket and copies frames onto a channel.
// The caller must close conn; the reader exits on the resulting read error.
func dialClient(t *testing.T, host, token string) *wsClient {
	t.Helper()
	u := url.URL{
		Scheme:   "ws",
		Host:     host,
		Path:     "/",
		RawQuery: "token=" + url.QueryEscape(token),
	}
	conn, resp, err := websocket.DefaultDialer.Dial(u.String(), http.Header{
		"Origin": []string{"http://localhost:5173"},
	})
	if err != nil {
		if resp != nil {
			t.Fatalf("ws dial: %v status=%d", err, resp.StatusCode)
		}
		t.Fatalf("ws dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	client := &wsClient{conn: conn, notify: make(chan struct{}, 1)}
	go func() {
		for {
			_, data, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			var msg map[string]any
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			client.mu.Lock()
			client.log = append(client.log, msg)
			client.mu.Unlock()
			select {
			case client.notify <- struct{}{}:
			default:
			}
		}
	}()
	return client
}

// snapshot copies the frames received so far. The caller must not mutate it.
func (c *wsClient) snapshot() []map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]map[string]any, len(c.log))
	copy(out, c.log)
	return out
}

// sendJSON writes one client message. A write failure fails the test.
func sendJSON(t *testing.T, conn *websocket.Conn, msg map[string]any) {
	t.Helper()
	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, raw); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// waitLog blocks until match is true for the full frame log, or fails the test.
// match may inspect every frame, including ones that arrived before the call.
func waitLog(
	t *testing.T,
	client *wsClient,
	timeout time.Duration,
	match func([]map[string]any) bool,
) []map[string]any {
	t.Helper()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		snap := client.snapshot()
		if match(snap) {
			return snap
		}
		select {
		case <-client.notify:
		case <-deadline.C:
			snap := client.snapshot()
			if match(snap) {
				return snap
			}
			t.Fatalf("timeout after %d frames", len(snap))
		}
	}
}

// countMatching returns how many frames satisfy pred.
func countMatching(frames []map[string]any, pred func(map[string]any) bool) int {
	n := 0
	for _, msg := range frames {
		if pred(msg) {
			n++
		}
	}
	return n
}

// hasPendingPermission reports a state or lifecycle frame that still asks.
func hasPendingPermission(msg map[string]any) bool {
	if msg["type"] == "state" {
		sess, _ := msg["session"].(map[string]any)
		return sess != nil && sess["pendingPermission"] != nil
	}
	return msg["type"] == "session_lifecycle" && msg["pendingPermission"] != nil
}

// sawClearAfterPending is true once a clear frame follows a pending frame.
// The session's first idle snapshot also has no pending permission; it must
// not count, or the test would pass before anyone answered.
func sawClearAfterPending(frames []map[string]any) bool {
	seenPending := false
	for _, msg := range frames {
		if hasPendingPermission(msg) {
			seenPending = true
			continue
		}
		if seenPending && permissionCleared(msg) {
			return true
		}
	}
	return false
}

// permissionCleared reports a snapshot that dropped the pending prompt.
// A full state omits pendingPermission (Go omitempty) once it is nil; a
// lifecycle frame sends an explicit null. Either one is the clear signal.
func permissionCleared(msg map[string]any) bool {
	if msg["type"] == "state" {
		sess, _ := msg["session"].(map[string]any)
		if sess == nil || sess["pendingPermission"] != nil {
			return false
		}
		status, _ := sess["status"].(string)
		return status != "" && status != "waiting_permission"
	}
	if msg["type"] != "session_lifecycle" {
		return false
	}
	perm, present := msg["pendingPermission"]
	if !present || perm != nil {
		return false
	}
	status, _ := msg["status"].(string)
	return status != "waiting_permission"
}

// isPermOK reports the fake agent's completion text after one permission reply.
func isPermOK(msg map[string]any) bool {
	if msg["type"] != "session_update" {
		return false
	}
	upd, _ := msg["update"].(map[string]any)
	if upd == nil {
		return false
	}
	kind, _ := upd["sessionUpdate"].(string)
	if kind != "agent_message_chunk" {
		return false
	}
	content, _ := upd["content"].(map[string]any)
	text, _ := content["text"].(string)
	return strings.Contains(text, "PERM_OK")
}

// isPendingPermissionError reports the unicast duplicate-answer error.
func isPendingPermissionError(msg map[string]any) bool {
	if msg["type"] != "error" {
		return false
	}
	text, _ := msg["message"].(string)
	return strings.Contains(strings.ToLower(text), "pending permission")
}

// sessionIDFromState reads session.id from a state frame.
func sessionIDFromState(msg map[string]any) string {
	if msg["type"] != "state" {
		return ""
	}
	sess, _ := msg["session"].(map[string]any)
	if sess == nil {
		return ""
	}
	id, _ := sess["id"].(string)
	return id
}

// TestMultiClientPermissionOneAnswer clears the other window and rejects a second answer.
func TestMultiClientPermissionOneAnswer(t *testing.T) {
	srv, host := startMultiClientServer(t, "permission")
	_ = srv
	token := "multi-client-permission"
	first := dialClient(t, host, token)
	second := dialClient(t, host, token)
	_ = waitLog(t, first, 5*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool { return m["type"] == "hello" }) > 0
	})
	_ = waitLog(t, second, 5*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool { return m["type"] == "hello" }) > 0
	})

	demo := filepath.Join(repoRoot(t), "demo")
	sendJSON(t, first.conn, map[string]any{
		"type": "start", "cwd": demo, "alwaysApprove": false, "forceNew": true,
	})
	started := waitLog(t, first, 20*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool {
			return sessionIDFromState(m) != ""
		}) > 0
	})
	sessionID := ""
	for _, msg := range started {
		if id := sessionIDFromState(msg); id != "" {
			sessionID = id
			break
		}
	}
	// The second window must observe the same session without sending start.
	_ = waitLog(t, second, 10*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool {
			return sessionIDFromState(m) == sessionID
		}) > 0
	})

	sendJSON(t, first.conn, map[string]any{
		"type": "prompt", "sessionId": sessionID, "text": "need permission",
	})
	_ = waitLog(t, first, 15*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, hasPendingPermission) > 0
	})
	_ = waitLog(t, second, 15*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, hasPendingPermission) > 0
	})

	sendJSON(t, first.conn, map[string]any{
		"type": "permission", "sessionId": sessionID, "optionId": "allow_once",
	})
	cleared := waitLog(t, second, 15*time.Second, func(frames []map[string]any) bool {
		return sawClearAfterPending(frames) && countMatching(frames, isPermOK) > 0
	})
	if countMatching(cleared, isPermOK) != 1 {
		t.Fatalf("second window saw %d PERM_OK frames, want 1", countMatching(cleared, isPermOK))
	}
	firstDone := waitLog(t, first, 15*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, isPermOK) > 0
	})
	if countMatching(firstDone, isPermOK) != 1 {
		t.Fatalf("answering window saw %d PERM_OK frames, want 1", countMatching(firstDone, isPermOK))
	}

	sendJSON(t, second.conn, map[string]any{
		"type": "permission", "sessionId": sessionID, "optionId": "allow_once",
	})
	_ = waitLog(t, second, 5*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, isPendingPermissionError) > 0
	})

	// Give a broadcast error time to show up on the window that answered.
	time.Sleep(400 * time.Millisecond)
	if countMatching(first.snapshot(), isPendingPermissionError) != 0 {
		t.Fatal("duplicate permission error was broadcast to the answering client")
	}
	if countMatching(first.snapshot(), isPermOK) != 1 {
		t.Fatal("second permission produced another PERM_OK")
	}
}

// TestMultiClientDisconnectKeepsSession leaves the pool resident for the other socket.
func TestMultiClientDisconnectKeepsSession(t *testing.T) {
	srv, host := startMultiClientServer(t, "parity")
	token := "multi-client-parity"
	owner := dialClient(t, host, token)
	_ = waitLog(t, owner, 5*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool { return m["type"] == "hello" }) > 0
	})

	demo := filepath.Join(repoRoot(t), "demo")
	sendJSON(t, owner.conn, map[string]any{
		"type": "start", "cwd": demo, "alwaysApprove": false, "forceNew": true,
	})
	started := waitLog(t, owner, 20*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool {
			return sessionIDFromState(m) != ""
		}) > 0
	})
	sessionID := ""
	for _, msg := range started {
		if id := sessionIDFromState(msg); id != "" {
			sessionID = id
			break
		}
	}

	viewer := dialClient(t, host, token)
	_ = waitLog(t, viewer, 10*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool {
			if sessionIDFromState(m) == sessionID {
				return true
			}
			if m["type"] != "pool" {
				return false
			}
			entries, _ := m["entries"].([]any)
			for _, raw := range entries {
				entry, _ := raw.(map[string]any)
				id, _ := entry["sessionId"].(string)
				if id == sessionID {
					return true
				}
			}
			return false
		}) > 0
	})

	if err := owner.conn.Close(); err != nil {
		t.Fatalf("close owner: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if srv.Pool().Has(sessionID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !srv.Pool().Has(sessionID) {
		t.Fatal("owner disconnect removed the session the other client is viewing")
	}

	sendJSON(t, viewer.conn, map[string]any{
		"type": "get_state", "sessionId": sessionID,
	})
	// Count state frames before the request so a hello snapshot does not pass the wait.
	before := countMatching(viewer.snapshot(), func(m map[string]any) bool {
		return sessionIDFromState(m) == sessionID
	})
	got := waitLog(t, viewer, 5*time.Second, func(frames []map[string]any) bool {
		return countMatching(frames, func(m map[string]any) bool {
			return sessionIDFromState(m) == sessionID
		}) > before
	})
	if countMatching(got, func(m map[string]any) bool { return sessionIDFromState(m) == sessionID }) <= before {
		t.Fatal("get_state after disconnect did not return the session")
	}
}
