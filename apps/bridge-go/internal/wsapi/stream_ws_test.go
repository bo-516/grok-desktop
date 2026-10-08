// End-to-end session stream checks over real WebSockets: two clients, one
// session, stamped (epoch, seq) frames, resync, get_state anchoring and the
// epoch change after crash recovery.
//
// Uses GROK_BIN=scripts/fixtures/fake-grok (harness-only agent fixture, same
// as permission_concurrent_test.go). The product path still spawns real grok.

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
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/wsapi"
)

// streamClient is one test WebSocket client.
type streamClient struct {
	t    *testing.T
	conn *websocket.Conn
}

// stampedFrame is one received frame that carried a stream position.
type stampedFrame struct {
	typ   string
	epoch string
	seq   int64
	raw   []byte
}

// startStreamBridge launches a bridge on an ephemeral port with fake-grok in
// the given mode and returns its port and token.
func startStreamBridge(t *testing.T, mode string) (int, string) {
	t.Helper()
	root := repoRoot(t)
	fakeGrok := filepath.Join(root, "scripts", "fixtures", "fake-grok")
	if _, err := os.Stat(fakeGrok); err != nil {
		t.Fatalf("fake-grok missing: %v", err)
	}
	t.Setenv("GROK_BIN", fakeGrok)
	t.Setenv("GROK_FAKE_MODE", mode)
	cfg := wsapi.Config{
		Host: "127.0.0.1", Port: 0, Cwd: filepath.Join(root, "demo"),
		PoolCapacity: 2, Token: "stream-ws-test-token",
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	srv := wsapi.NewServer(cfg)
	go func() { _ = srv.ListenAndServe() }()
	t.Cleanup(func() { _ = srv.Close() })
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if port := srv.BoundPort(); port > 0 {
			if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 100*time.Millisecond); err == nil {
				_ = c.Close()
				return port, cfg.Token
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server did not bind a port")
	return 0, ""
}

// dialStreamClient connects one client and drains until hello.
func dialStreamClient(t *testing.T, port int, token string) *streamClient {
	t.Helper()
	u := url.URL{
		Scheme: "ws", Host: fmt.Sprintf("127.0.0.1:%d", port), Path: "/",
		RawQuery: "token=" + url.QueryEscape(token),
	}
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.Dial(u.String(), http.Header{"Origin": []string{"http://localhost:5173"}})
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	c := &streamClient{t: t, conn: conn}
	c.until(func(m map[string]any, _ []byte) bool { return m["type"] == "hello" })
	return c
}

// send writes one JSON message.
func (c *streamClient) send(m map[string]any) {
	b, _ := json.Marshal(m)
	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

// until reads frames until stop returns true (fails after 20s).
func (c *streamClient) until(stop func(m map[string]any, raw []byte) bool) {
	c.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		_ = c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			c.t.Fatalf("read: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			c.t.Fatalf("decode: %v", err)
		}
		if stop(m, raw) {
			return
		}
	}
	c.t.Fatal("timeout waiting for frame")
}

// frameSessionID reads the session id of a per-session frame.
func frameSessionID(m map[string]any) string {
	if id, ok := m["sessionId"].(string); ok && id != "" {
		return id
	}
	if s, ok := m["session"].(map[string]any); ok {
		id, _ := s["id"].(string)
		return id
	}
	return ""
}

// recordStamped appends m to out when it is a stamped frame of sessionID.
func recordStamped(out *[]stampedFrame, sessionID string, m map[string]any, raw []byte) {
	seq, ok := m["seq"].(float64)
	if !ok || frameSessionID(m) != sessionID {
		return
	}
	epoch, _ := m["epoch"].(string)
	typ, _ := m["type"].(string)
	*out = append(*out, stampedFrame{typ: typ, epoch: epoch, seq: int64(seq), raw: raw})
}

// isParityDone reports the fixture's final answer chunk.
func isParityDone(m map[string]any) bool {
	if m["type"] != "session_update" {
		return false
	}
	upd, _ := m["update"].(map[string]any)
	content, _ := upd["content"].(map[string]any)
	text, _ := content["text"].(string)
	return strings.Contains(text, "PARITY_OK")
}

func TestStreamFramesAreStampedIdenticallyForEveryClient(t *testing.T) {
	port, token := startStreamBridge(t, "parity")
	a := dialStreamClient(t, port, token)
	b := dialStreamClient(t, port, token)
	const sessionID = "fixture-session-0001"

	a.send(map[string]any{"type": "start", "forceNew": true, "startId": "start-A"})
	var seen [2][]stampedFrame
	var startProv map[string]any
	for i, c := range []*streamClient{a, b} {
		c.until(func(m map[string]any, raw []byte) bool {
			recordStamped(&seen[i], sessionID, m, raw)
			if m["type"] == "state" && frameSessionID(m) == sessionID {
				startProv, _ = m["provenance"].(map[string]any)
				return true
			}
			return false
		})
		if startProv["kind"] != "started" || startProv["startId"] != "start-A" {
			t.Fatalf("client %d start provenance = %v", i, startProv)
		}
	}

	a.send(map[string]any{"type": "prompt", "sessionId": sessionID, "text": "hi"})
	for i, c := range []*streamClient{a, b} {
		c.until(func(m map[string]any, raw []byte) bool {
			recordStamped(&seen[i], sessionID, m, raw)
			return isParityDone(m)
		})
	}

	if len(seen[0]) < 3 {
		t.Fatalf("expected several stamped frames, got %d", len(seen[0]))
	}
	epoch := seen[0][0].epoch
	for i, f := range seen[0] {
		if f.seq != int64(i+1) || f.epoch != epoch {
			t.Fatalf("client A frame %d: %s epoch=%q seq=%d", i, f.typ, f.epoch, f.seq)
		}
	}
	if len(seen[1]) != len(seen[0]) {
		t.Fatalf("client B saw %d stamped frames, A saw %d", len(seen[1]), len(seen[0]))
	}
	for i := range seen[0] {
		if string(seen[0][i].raw) != string(seen[1][i].raw) {
			t.Fatalf("frame %d differs between clients", i)
		}
	}

	// B pretends it missed everything: resync from 0 replays it verbatim.
	b.send(map[string]any{"type": "resync", "sessionId": sessionID, "epoch": epoch, "fromSeq": 0})
	var res struct {
		Status  string            `json:"status"`
		HeadSeq int64             `json:"headSeq"`
		Frames  []json.RawMessage `json:"frames"`
	}
	b.until(func(m map[string]any, raw []byte) bool {
		if m["type"] != "resync_result" {
			return false
		}
		if err := json.Unmarshal(raw, &res); err != nil {
			t.Fatalf("resync_result: %v", err)
		}
		return true
	})
	if res.Status != "ok" || len(res.Frames) < len(seen[1]) {
		t.Fatalf("resync status=%s frames=%d (live %d)", res.Status, len(res.Frames), len(seen[1]))
	}
	for i := range seen[1] {
		if string(res.Frames[i]) != string(seen[1][i].raw) {
			t.Fatalf("resync frame %d is not the live bytes", i)
		}
	}

	// get_state anchors the stream position.
	b.send(map[string]any{"type": "get_state", "sessionId": sessionID})
	b.until(func(m map[string]any, _ []byte) bool {
		if m["type"] != "state" || m["headSeq"] == nil {
			return false
		}
		if m["epoch"] != epoch || int64(m["headSeq"].(float64)) != res.HeadSeq {
			t.Fatalf("get_state anchor = %v/%v, want %s/%d", m["epoch"], m["headSeq"], epoch, res.HeadSeq)
		}
		if prov, _ := m["provenance"].(map[string]any); prov["kind"] != "started" {
			t.Fatalf("get_state provenance = %v", m["provenance"])
		}
		return true
	})

	// Unknown epoch → epoch_mismatch pointing at the live stream.
	b.send(map[string]any{"type": "resync", "sessionId": sessionID, "epoch": "stale.1", "fromSeq": 3})
	b.until(func(m map[string]any, _ []byte) bool {
		if m["type"] != "resync_result" {
			return false
		}
		if m["status"] != "epoch_mismatch" || m["latestEpoch"] != epoch {
			t.Fatalf("mismatch reply = %v", m)
		}
		return true
	})
}

func TestCrashRecoveryStartsANewEpoch(t *testing.T) {
	port, token := startStreamBridge(t, "crash")
	a := dialStreamClient(t, port, token)
	const sessionID = "fixture-session-0001"

	a.send(map[string]any{"type": "start", "forceNew": true, "startId": "start-crash"})
	var frames []stampedFrame
	a.until(func(m map[string]any, raw []byte) bool {
		recordStamped(&frames, sessionID, m, raw)
		return m["type"] == "state" && frameSessionID(m) == sessionID
	})
	firstEpoch := frames[0].epoch

	a.send(map[string]any{"type": "prompt", "sessionId": sessionID, "text": "boom"})
	// Recovery reloads the session in a new process: replay_end of a new epoch.
	var resumedProv map[string]any
	a.until(func(m map[string]any, raw []byte) bool {
		recordStamped(&frames, sessionID, m, raw)
		if m["type"] == "replay_end" && m["epoch"] != firstEpoch {
			resumedProv, _ = m["provenance"].(map[string]any)
			return true
		}
		return false
	})
	var second []stampedFrame
	for _, f := range frames {
		if f.epoch != firstEpoch {
			second = append(second, f)
		}
	}
	for i, f := range second {
		if f.seq != int64(i+1) {
			t.Fatalf("new epoch must restart at 1: frame %d (%s) seq=%d", i, f.typ, f.seq)
		}
	}
	if resumedProv["kind"] != "resumed" || resumedProv["startId"] != nil {
		t.Fatalf("recovered session provenance = %v", resumedProv)
	}

	a.send(map[string]any{"type": "resync", "sessionId": sessionID, "epoch": firstEpoch, "fromSeq": 1})
	a.until(func(m map[string]any, _ []byte) bool {
		if m["type"] != "resync_result" {
			return false
		}
		if m["status"] != "epoch_mismatch" || m["latestEpoch"] != second[0].epoch {
			t.Fatalf("old-epoch resync = %v", m)
		}
		return true
	})
}
