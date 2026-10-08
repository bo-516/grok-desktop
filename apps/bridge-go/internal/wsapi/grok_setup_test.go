package wsapi

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
)

// frameRecorder is a Handlers whose Send appends every frame to a list.
type frameRecorder struct {
	mu     sync.Mutex
	frames []map[string]any
}

// handlers returns Handlers wired to this recorder (Send and Broadcast).
func (r *frameRecorder) handlers() *Handlers {
	record := func(msg map[string]any) {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.frames = append(r.frames, msg)
	}
	return &Handlers{
		Send:      func(_ *websocket.Conn, msg map[string]any) { record(msg) },
		Broadcast: record,
	}
}

// ofType returns the recorded frames whose "type" equals typ.
func (r *frameRecorder) ofType(typ string) []map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []map[string]any{}
	for _, f := range r.frames {
		if f["type"] == typ {
			out = append(out, f)
		}
	}
	return out
}

// fakeSetupCommand swaps resolveSetupCommand so "install" runs script under
// /bin/sh instead of the real installer, for one test.
func fakeSetupCommand(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake setup commands use /bin/sh")
	}
	prev := resolveSetupCommand
	resolveSetupCommand = func(action string) (grokbin.Command, error) {
		if action != "install" {
			return grokbin.Command{}, errors.New("unknown setup action: " + action)
		}
		return grokbin.Command{Action: grokbin.ActionInstall, Display: "fake", Argv: []string{"/bin/sh", "-c", script}}, nil
	}
	t.Cleanup(func() { resolveSetupCommand = prev })
}

func TestGrokSetupRunStreamsStartedOutputExit(t *testing.T) {
	fakeSetupCommand(t, "echo fetching; echo installed")
	rec := &frameRecorder{}
	_ = rec.handlers().handleGrokSetupRun(nil, map[string]any{"runId": "r1", "action": "install"})
	started := rec.ofType("grok_setup_started")
	if len(started) != 1 || started[0]["runId"] != "r1" {
		t.Fatalf("started frames %v", started)
	}
	if cmd, ok := started[0]["command"].(grokbin.Command); !ok || cmd.Argv[0] != "/bin/sh" {
		t.Fatalf("started must carry the exact command: %#v", started[0]["command"])
	}
	text := ""
	for _, f := range rec.ofType("grok_setup_output") {
		text += f["text"].(string)
	}
	if !strings.Contains(text, "fetching") || !strings.Contains(text, "installed") {
		t.Fatalf("output %q", text)
	}
	exits := rec.ofType("grok_setup_exit")
	if len(exits) != 1 || exits[0]["ok"] != true || *(exits[0]["code"].(*int)) != 0 {
		t.Fatalf("exit %v", exits)
	}
}

func TestGrokSetupRunReportsFailureExitCode(t *testing.T) {
	fakeSetupCommand(t, "echo 'curl: (22) 404' >&2; exit 22")
	rec := &frameRecorder{}
	_ = rec.handlers().handleGrokSetupRun(nil, map[string]any{"runId": "r2", "action": "install"})
	exits := rec.ofType("grok_setup_exit")
	if len(exits) != 1 || exits[0]["ok"] != false || *(exits[0]["code"].(*int)) != 22 {
		t.Fatalf("exit %v", exits)
	}
}

// Bad requests never start anything and still settle the client's run.
func TestGrokSetupRunRejectsBadRequests(t *testing.T) {
	fakeSetupCommand(t, "exit 0")
	rec := &frameRecorder{}
	h := rec.handlers()
	_ = h.handleGrokSetupRun(nil, map[string]any{"action": "install"})
	_ = h.handleGrokSetupRun(nil, map[string]any{"runId": "r3", "action": "curl evil | sh"})
	if len(rec.ofType("grok_setup_started")) != 0 {
		t.Fatal("nothing may start")
	}
	exits := rec.ofType("grok_setup_exit")
	if len(exits) != 2 || exits[0]["ok"] != false || exits[1]["ok"] != false {
		t.Fatalf("exits %v", exits)
	}
	if !strings.Contains(exits[1]["error"].(string), "unknown setup action") {
		t.Fatalf("error %v", exits[1]["error"])
	}
}

// A second run while one is active is refused; cancel stops the first.
func TestGrokSetupRunSingleFlightAndCancel(t *testing.T) {
	fakeSetupCommand(t, "echo started; sleep 60 & wait")
	rec := &frameRecorder{}
	h := rec.handlers()
	done := make(chan struct{})
	go func() {
		_ = h.handleGrokSetupRun(nil, map[string]any{"runId": "long", "action": "install"})
		close(done)
	}()
	deadline := time.Now().Add(10 * time.Second)
	for len(rec.ofType("grok_setup_output")) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	_ = h.handleGrokSetupRun(nil, map[string]any{"runId": "second", "action": "install"})
	busy := rec.ofType("grok_setup_exit")
	if len(busy) != 1 || busy[0]["runId"] != "second" || !strings.Contains(busy[0]["error"].(string), "already running") {
		t.Fatalf("second run must be refused: %v", busy)
	}
	_ = h.handleGrokSetupCancel(map[string]any{"runId": "long"})
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("cancel did not stop the run")
	}
	exits := rec.ofType("grok_setup_exit")
	last := exits[len(exits)-1]
	if last["runId"] != "long" || last["canceled"] != true || last["ok"] != false {
		t.Fatalf("canceled exit %v", last)
	}
}

// grok_bin_set validates before saving and replies with the new resolution.
func TestGrokBinSetValidatesAndPersists(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a unix executable bit")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("GROK_BIN", "")
	bin := filepath.Join(t.TempDir(), "grok")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	rec := &frameRecorder{}
	h := rec.handlers()
	_ = h.handleGrokBinSet(nil, map[string]any{"requestId": "a", "path": filepath.Join(home, "nope")})
	_ = h.handleGrokBinSet(nil, map[string]any{"requestId": "b", "path": bin})
	_ = h.handleGrokBinGet(nil, map[string]any{"requestId": "c"})
	replies := rec.ofType("grok_bin")
	if len(replies) != 3 {
		t.Fatalf("replies %v", replies)
	}
	if replies[0]["ok"] != false || !strings.Contains(replies[0]["error"].(string), "no such file") {
		t.Fatalf("invalid path must be rejected: %v", replies[0])
	}
	for _, r := range replies[1:] {
		snap := r["setting"].(grokBinSnapshot)
		if r["ok"] != true || snap.CustomPath != bin || snap.ResolvedPath != bin || snap.Source != "setting" {
			t.Fatalf("saved setting must resolve: %v", r)
		}
	}
	_ = h.handleGrokBinSet(nil, map[string]any{"requestId": "d", "path": ""})
	cleared := rec.ofType("grok_bin")[3]["setting"].(grokBinSnapshot)
	if cleared.CustomPath != "" || cleared.Source == "setting" {
		t.Fatalf("clear must drop the setting: %+v", cleared)
	}
}
