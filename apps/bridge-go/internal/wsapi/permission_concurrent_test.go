// Concurrent permission mid-prompt: proves the WS read loop is not blocked by
// handlePrompt, so {type:permission} can be delivered while session/prompt waits.
//
// Uses GROK_BIN=scripts/fixtures/fake-grok with GROK_FAKE_MODE=permission.
// Product path still uses real grok; this is a harness-only agent fixture.

package wsapi_test

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/wsapi"
)

// repoRoot walks up from this test file to the monorepo root (contains apps/).
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	dir := filepath.Dir(file)
	for i := 0; i < 8; i++ {
		if st, err := os.Stat(filepath.Join(dir, "apps", "bridge-go")); err == nil && st.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatal("could not find monorepo root from test file")
	return ""
}

func TestPermissionWhilePromptInFlight(t *testing.T) {
	root := repoRoot(t)
	fakeGrok := filepath.Join(root, "scripts", "fixtures", "fake-grok")
	if _, err := os.Stat(fakeGrok); err != nil {
		t.Fatalf("fake-grok missing: %v", err)
	}
	demo := filepath.Join(root, "demo")

	// Point spawn at the fixture agent (must be GROK_* to pass env whitelist).
	t.Setenv("GROK_BIN", fakeGrok)
	t.Setenv("GROK_FAKE_MODE", "permission")

	cfg := wsapi.Config{
		Host:           "127.0.0.1",
		Port:           0, // ephemeral
		Cwd:            demo,
		AlwaysApprove:  false, // must surface pendingPermission to the UI
		PoolCapacity:   2,
		Token:          "perm-concurrent-test-token",
		AllowedOrigins: []string{"null", "http://localhost:5173"},
	}
	srv := wsapi.NewServer(cfg)
	go func() {
		_ = srv.ListenAndServe()
	}()
	t.Cleanup(func() {
		_ = srv.Close()
	})

	// Wait until TCP accepts.
	var port int
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		port = srv.BoundPort()
		if port > 0 {
			c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 100*time.Millisecond)
			if err == nil {
				_ = c.Close()
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		port = 0
	}
	if port == 0 {
		t.Fatal("server did not bind a port")
	}

	u := url.URL{
		Scheme:   "ws",
		Host:     fmt.Sprintf("127.0.0.1:%d", port),
		Path:     "/",
		RawQuery: "token=" + url.QueryEscape(cfg.Token),
	}
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, resp, err := dialer.Dial(u.String(), http.Header{"Origin": []string{"http://localhost:5173"}})
	if err != nil {
		if resp != nil {
			t.Fatalf("ws dial: %v status=%d", err, resp.StatusCode)
		}
		t.Fatalf("ws dial: %v", err)
	}
	defer conn.Close()

	type envelope map[string]any
	readMsg := func(timeout time.Duration) (envelope, error) {
		_ = conn.SetReadDeadline(time.Now().Add(timeout))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return nil, err
		}
		var m envelope
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		return m, nil
	}
	send := func(m map[string]any) {
		b, _ := json.Marshal(m)
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	// Drain until hello
	var sawHello bool
	for i := 0; i < 8; i++ {
		m, err := readMsg(5 * time.Second)
		if err != nil {
			t.Fatalf("hello scan: %v", err)
		}
		if m["type"] == "hello" {
			sawHello = true
			break
		}
	}
	if !sawHello {
		t.Fatal("expected hello")
	}

	send(map[string]any{
		"type": "start", "cwd": demo, "alwaysApprove": false, "forceNew": true,
	})

	var sessionID string
	deadline = time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) && sessionID == "" {
		m, err := readMsg(5 * time.Second)
		if err != nil {
			t.Fatalf("start wait: %v", err)
		}
		if m["type"] == "state" {
			if sess, ok := m["session"].(map[string]any); ok {
				if id, _ := sess["id"].(string); id != "" {
					sessionID = id
				}
			}
		}
	}
	if sessionID == "" {
		t.Fatal("no session id after start")
	}

	// Kick off prompt — agent will reverse-request permission and block.
	send(map[string]any{
		"type": "prompt", "sessionId": sessionID, "text": "need permission",
	})

	// Wait for pendingPermission, then respond WHILE prompt is still in flight.
	var sawPerm bool
	deadline = time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) && !sawPerm {
		m, err := readMsg(5 * time.Second)
		if err != nil {
			t.Fatalf("waiting permission: %v", err)
		}
		hasPerm := false
		if m["type"] == "state" {
			if sess, ok := m["session"].(map[string]any); ok && sess["pendingPermission"] != nil {
				hasPerm = true
			}
		}
		if m["type"] == "session_lifecycle" && m["pendingPermission"] != nil {
			hasPerm = true
		}
		if hasPerm {
			sawPerm = true
			send(map[string]any{
				"type": "permission", "sessionId": sessionID, "optionId": "allow_once",
			})
		}
	}
	if !sawPerm {
		t.Fatal("never saw pendingPermission — cannot exercise concurrent permission")
	}

	// Expect PERM_OK after permission unblocks the agent (proves no deadlock).
	deadline = time.Now().Add(15 * time.Second)
	var gotPermOK bool
	for time.Now().Before(deadline) && !gotPermOK {
		m, err := readMsg(5 * time.Second)
		if err != nil {
			t.Fatalf("waiting PERM_OK: %v", err)
		}
		if m["type"] != "session_update" {
			continue
		}
		upd, _ := m["update"].(map[string]any)
		if upd == nil {
			continue
		}
		if su, _ := upd["sessionUpdate"].(string); su != "agent_message_chunk" {
			continue
		}
		content, _ := upd["content"].(map[string]any)
		text, _ := content["text"].(string)
		if strings.Contains(text, "PERM") {
			gotPermOK = true
		}
	}
	if !gotPermOK {
		t.Fatal("timeout: never received session_update with PERM_OK — permission likely deadlocked (read loop blocked on prompt)")
	}
}
