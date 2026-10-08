//go:build !windows

package wsapi

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/userterm"
)

// terminalHarness drives Handlers.OnClientMessage with a recording Send, the
// same path a WebSocket frame takes after Server.handleWS reads it.
type terminalHarness struct {
	h  *Handlers
	mu sync.Mutex
	// sent holds every message Send / Broadcast produced.
	sent []map[string]any
	// broadcasts counts broadcast `error` frames (terminal errors must not broadcast).
	broadcasts int
}

// newTerminalHarness builds handlers whose default workspace is a temp dir
// and whose shell is plain /bin/sh.
func newTerminalHarness(t *testing.T) *terminalHarness {
	t.Helper()
	t.Setenv("SHELL", "/bin/sh")
	th := &terminalHarness{}
	th.h = NewHandlers(pool.NewRuntimePool(1), false, t.TempDir(), 1,
		func(_ *websocket.Conn, msg map[string]any) {
			th.mu.Lock()
			defer th.mu.Unlock()
			th.sent = append(th.sent, msg)
			if msg["type"] == "terminal_output" {
				raw, _ := base64.StdEncoding.DecodeString(msg["data"].(string))
				// Ack like the desktop so output keeps flowing.
				go th.frame(map[string]any{"type": "terminal_ack", "terminalId": msg["terminalId"], "bytes": len(raw)})
			}
		},
		func(msg map[string]any) {
			th.mu.Lock()
			defer th.mu.Unlock()
			if msg["type"] == "error" {
				th.broadcasts++
			}
		})
	t.Cleanup(th.h.Terminals.CloseAll)
	return th
}

// frame sends one client frame through the JSON dispatcher (nil socket = test owner).
func (th *terminalHarness) frame(msg map[string]any) {
	raw, _ := json.Marshal(msg)
	th.h.OnClientMessage(nil, string(raw))
}

// find returns the first sent message matching typ and pred.
func (th *terminalHarness) find(typ string, pred func(map[string]any) bool) map[string]any {
	th.mu.Lock()
	defer th.mu.Unlock()
	for _, m := range th.sent {
		if m["type"] == typ && (pred == nil || pred(m)) {
			return m
		}
	}
	return nil
}

// output concatenates decoded terminal_output for id.
func (th *terminalHarness) output(id string) string {
	th.mu.Lock()
	defer th.mu.Unlock()
	var b strings.Builder
	for _, m := range th.sent {
		if m["type"] == "terminal_output" && m["terminalId"] == id {
			raw, _ := base64.StdEncoding.DecodeString(m["data"].(string))
			b.Write(raw)
		}
	}
	return b.String()
}

// await polls until cond holds (10s budget).
func await(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// TestTerminalProtocolEndToEnd: create in the default workspace, type, list,
// close_session kills the bound terminal, and errors stay per-socket.
func TestTerminalProtocolEndToEnd(t *testing.T) {
	th := newTerminalHarness(t)
	th.frame(map[string]any{"type": "terminal_create", "requestId": "r1", "sessionId": "sess-1", "cols": 90, "rows": 20})
	await(t, "terminal_created", func() bool { return th.find("terminal_created", nil) != nil })
	created := th.find("terminal_created", nil)
	if created["ok"] != true {
		t.Fatalf("create failed: %v", created)
	}
	raw, _ := json.Marshal(created["terminal"])
	var info struct {
		TerminalID string `json:"terminalId"`
		SessionID  string `json:"sessionId"`
		Cwd        string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &info)
	if info.SessionID != "sess-1" || info.Cwd == "" {
		t.Fatalf("info = %+v", info)
	}

	th.frame(map[string]any{"type": "terminal_input", "terminalId": info.TerminalID, "seq": 1, "data": "echo hi-$((40+2)); pwd\n"})
	await(t, "echo", func() bool { return strings.Contains(th.output(info.TerminalID), "hi-42") })

	th.frame(map[string]any{"type": "terminal_list", "requestId": "l1"})
	list := th.find("terminal_list_result", nil)
	if list == nil || len(list["terminals"].([]userterm.Info)) != 1 {
		t.Fatalf("list = %v", list)
	}

	th.frame(map[string]any{"type": "terminal_input", "terminalId": "pty-999", "seq": 1, "data": "x"})
	if e := th.find("terminal_error", nil); e == nil || e["terminalId"] != "pty-999" {
		t.Fatalf("unknown terminal error = %v", e)
	}

	th.frame(map[string]any{"type": "close_session", "sessionId": "sess-1"})
	await(t, "terminal_exit", func() bool {
		return th.find("terminal_exit", func(m map[string]any) bool { return m["terminalId"] == info.TerminalID }) != nil
	})
	th.mu.Lock()
	broadcasts := th.broadcasts
	th.mu.Unlock()
	if broadcasts != 0 {
		t.Errorf("terminal failures must not broadcast bridge errors (%d)", broadcasts)
	}
}

// TestTerminalCreateRejectsBadCwd: escapes and missing dirs answer ok:false.
func TestTerminalCreateRejectsBadCwd(t *testing.T) {
	th := newTerminalHarness(t)
	th.frame(map[string]any{"type": "terminal_create", "requestId": "bad", "subdir": "../../.."})
	th.frame(map[string]any{"type": "terminal_create", "requestId": "rel", "cwd": "relative/dir"})
	for _, id := range []string{"bad", "rel"} {
		m := th.find("terminal_created", func(m map[string]any) bool { return m["requestId"] == id })
		if m == nil || m["ok"] != false || m["error"] == "" {
			t.Errorf("%s: %v", id, m)
		}
	}
}

// TestTerminalInputBytes covers both payload encodings and the size cap.
func TestTerminalInputBytes(t *testing.T) {
	if b, err := terminalInputBytes(map[string]any{"data": "héllo"}); err != nil || string(b) != "héllo" {
		t.Errorf("utf8: %q %v", b, err)
	}
	if b, err := terminalInputBytes(map[string]any{"dataBase64": base64.StdEncoding.EncodeToString([]byte{0x1b, 0xff})}); err != nil || len(b) != 2 || b[1] != 0xff {
		t.Errorf("binary: %v %v", b, err)
	}
	if _, err := terminalInputBytes(map[string]any{"dataBase64": "!!"}); err == nil {
		t.Error("bad base64 accepted")
	}
	if _, err := terminalInputBytes(map[string]any{"data": strings.Repeat("x", maxTerminalInputBytes+1)}); err == nil {
		t.Error("oversized input accepted")
	}
	if uintField(map[string]any{"seq": -1.0}, "seq") != 0 || uintField(map[string]any{"seq": 7.0}, "seq") != 7 {
		t.Error("uintField")
	}
	if intField(map[string]any{"cols": "80"}, "cols") != 0 || intField(map[string]any{"cols": 80.0}, "cols") != 80 {
		t.Error("intField")
	}
}
