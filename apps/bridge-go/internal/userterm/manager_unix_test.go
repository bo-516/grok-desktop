//go:build !windows

package userterm

import (
	"encoding/base64"
	"strings"
	"sync"
	"testing"
	"time"
)

// recorder collects messages the manager routes to owners.
type recorder struct {
	mu   sync.Mutex
	msgs []map[string]any
	// autoAck, when set, acks every output frame like the desktop does.
	autoAck *Manager
}

// send is the Manager send hook; it records and optionally acks output.
func (r *recorder) send(owner any, msg map[string]any) {
	r.mu.Lock()
	r.msgs = append(r.msgs, msg)
	ack := r.autoAck
	r.mu.Unlock()
	if ack != nil && msg["type"] == "terminal_output" {
		raw, _ := base64.StdEncoding.DecodeString(msg["data"].(string))
		if t, err := ack.Get(owner, msg["terminalId"].(string)); err == nil {
			t.Ack(len(raw))
		}
	}
}

// output concatenates every terminal_output payload for id.
func (r *recorder) output(id string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var b strings.Builder
	for _, m := range r.msgs {
		if m["type"] == "terminal_output" && m["terminalId"] == id {
			raw, _ := base64.StdEncoding.DecodeString(m["data"].(string))
			b.Write(raw)
		}
	}
	return b.String()
}

// exit returns the terminal_exit message for id, or nil.
func (r *recorder) exit(id string) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.msgs {
		if m["type"] == "terminal_exit" && m["terminalId"] == id {
			return m
		}
	}
	return nil
}

// waitFor polls cond until true or the deadline, failing with what.
func waitFor(t *testing.T, what string, cond func() bool) {
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

// newTestManager returns a manager running plain /bin/sh (no login profile)
// with a minimal environment, plus its recorder.
func newTestManager(t *testing.T, autoAck bool) (*Manager, *recorder) {
	t.Helper()
	rec := &recorder{}
	m := NewManager(rec.send)
	m.shell = func() (string, []string) { return "/bin/sh", nil }
	m.environ = func() []string { return []string{"PATH=/usr/bin:/bin", "PS1=$ ", "BRIDGE_TOKEN=secret"} }
	if autoAck {
		rec.autoAck = m
	}
	t.Cleanup(m.CloseAll)
	return m, rec
}

// TestTerminalRoundTripAndExitCode: input reaches the shell, output streams
// back, the bridge token is not visible, and the exit code is reported.
func TestTerminalRoundTripAndExitCode(t *testing.T) {
	m, rec := newTestManager(t, true)
	owner := new(int)
	cwd := t.TempDir()
	info, err := m.Create(owner, CreateOptions{SessionID: "s1", Cwd: cwd, Cols: 100, Rows: 30})
	if err != nil {
		t.Fatal(err)
	}
	if info.Pid <= 0 || info.Cols != 100 || info.Rows != 30 || info.Cwd != cwd {
		t.Fatalf("unexpected info %+v", info)
	}
	term, err := m.Get(owner, info.TerminalID)
	if err != nil {
		t.Fatal(err)
	}
	term.Write(1, []byte("echo \"tok=[$BRIDGE_TOKEN] term=$TERM\"; stty size\n"))
	waitFor(t, "echo output", func() bool { return strings.Contains(rec.output(info.TerminalID), "term=xterm-256color") })
	out := rec.output(info.TerminalID)
	if !strings.Contains(out, "tok=[]") {
		t.Errorf("BRIDGE_TOKEN leaked: %q", out)
	}
	waitFor(t, "stty size", func() bool { return strings.Contains(rec.output(info.TerminalID), "30 100") })

	term.Resize(2, 120, 40)
	term.Write(3, []byte("stty size; exit 3\n"))
	waitFor(t, "terminal_exit", func() bool { return rec.exit(info.TerminalID) != nil })
	if !strings.Contains(rec.output(info.TerminalID), "40 120") {
		t.Errorf("resize not applied: %q", rec.output(info.TerminalID))
	}
	exit := rec.exit(info.TerminalID)
	if exit["exitCode"] != 3 || exit["killed"] != false {
		t.Errorf("exit = %v", exit)
	}
	waitFor(t, "registry removal", func() bool { return len(m.List(owner)) == 0 })
}

// TestTerminalInputOrderBySeq: frames delivered out of order are written in
// seq order (the WS layer dispatches each frame on its own goroutine).
func TestTerminalInputOrderBySeq(t *testing.T) {
	m, rec := newTestManager(t, true)
	owner := new(int)
	info, err := m.Create(owner, CreateOptions{Cwd: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	term, _ := m.Get(owner, info.TerminalID)
	term.Write(3, []byte("C\n"))
	term.Write(2, []byte("B"))
	term.Write(1, []byte("echo A"))
	waitFor(t, "ordered echo", func() bool { return strings.Contains(rec.output(info.TerminalID), "ABC") })
}

// TestTerminalOwnershipAndCleanup: other owners cannot see a terminal;
// CloseSession and CloseOwner kill exactly the matching terminals.
func TestTerminalOwnershipAndCleanup(t *testing.T) {
	m, rec := newTestManager(t, true)
	alice, bob := new(int), new(int)
	cwd := t.TempDir()
	a1, _ := m.Create(alice, CreateOptions{SessionID: "s1", Cwd: cwd})
	a2, _ := m.Create(alice, CreateOptions{SessionID: "s2", Cwd: cwd})
	b1, _ := m.Create(bob, CreateOptions{SessionID: "s1", Cwd: cwd})
	if _, err := m.Get(bob, a1.TerminalID); err == nil {
		t.Fatal("bob must not reach alice's terminal")
	}
	if n := len(m.List(alice)); n != 2 {
		t.Fatalf("alice has %d terminals, want 2", n)
	}
	if n := m.CloseSession("s1"); n != 2 {
		t.Fatalf("CloseSession(s1) killed %d, want 2", n)
	}
	waitFor(t, "s1 exits", func() bool { return rec.exit(a1.TerminalID) != nil && rec.exit(b1.TerminalID) != nil })
	if rec.exit(a1.TerminalID)["killed"] != true {
		t.Errorf("killed flag missing: %v", rec.exit(a1.TerminalID))
	}
	if m.CloseSession("") != 0 {
		t.Error("empty session id must match nothing")
	}
	if n := m.CloseOwner(alice); n != 1 {
		t.Fatalf("CloseOwner(alice) killed %d, want 1", n)
	}
	waitFor(t, "a2 exit", func() bool { return rec.exit(a2.TerminalID) != nil })
}

// TestTerminalKillReachesForegroundJob: Kill hangs up a foreground job that
// sits in its own process group (sleep under an interactive sh).
func TestTerminalKillReachesForegroundJob(t *testing.T) {
	m, rec := newTestManager(t, true)
	owner := new(int)
	info, _ := m.Create(owner, CreateOptions{Cwd: t.TempDir()})
	term, _ := m.Get(owner, info.TerminalID)
	term.Write(1, []byte("echo started; sleep 300\n"))
	waitFor(t, "sleep started", func() bool { return strings.Contains(rec.output(info.TerminalID), "started") })
	start := time.Now()
	term.Kill()
	waitFor(t, "exit after kill", func() bool { return rec.exit(info.TerminalID) != nil })
	if elapsed := time.Since(start); elapsed > killGrace+2*time.Second {
		t.Errorf("kill took %v", elapsed)
	}
}

// TestTerminalBackpressureWithoutAcks: with no acks, the bridge stops sending
// at the credit window and buffers at most maxPendingOutput (+ one read);
// acking resumes the stream.
func TestTerminalBackpressureWithoutAcks(t *testing.T) {
	m, rec := newTestManager(t, false)
	owner := new(int)
	info, _ := m.Create(owner, CreateOptions{Cwd: t.TempDir()})
	term, _ := m.Get(owner, info.TerminalID)
	// ~4 MiB of output: far beyond window + pending cap.
	term.Write(1, []byte("i=0; while [ $i -lt 65536 ]; do echo 0123456789012345678901234567890123456789012345678901234567890; i=$((i+1)); done; exit 0\n"))
	waitFor(t, "credit window to fill", func() bool { return len(rec.output(info.TerminalID)) >= ackWindow })
	time.Sleep(300 * time.Millisecond)
	sent := len(rec.output(info.TerminalID))
	if sent > ackWindow+maxFrameBytes {
		t.Fatalf("sent %d bytes without acks, window is %d", sent, ackWindow)
	}
	if p := term.out.pending(); p > maxPendingOutput+readChunk {
		t.Fatalf("pending %d exceeds cap", p)
	}
	if rec.exit(info.TerminalID) != nil {
		t.Fatal("shell finished although output was never consumed")
	}
	rec.mu.Lock()
	rec.autoAck = m
	rec.mu.Unlock()
	term.Ack(sent)
	waitFor(t, "stream to finish after acks", func() bool { return rec.exit(info.TerminalID) != nil })
	if got := strings.Count(rec.output(info.TerminalID), "0123456789012345678901234567890123456789012345678901234567890"); got < 65536 {
		t.Errorf("lost output: %d lines", got)
	}
}

// TestManagerCapAndShutdown: the per-owner cap holds and CloseAll refuses new terminals.
func TestManagerCapAndShutdown(t *testing.T) {
	m, _ := newTestManager(t, true)
	owner := new(int)
	cwd := t.TempDir()
	for i := range maxTerminalsPerOwner {
		if _, err := m.Create(owner, CreateOptions{Cwd: cwd}); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, err := m.Create(owner, CreateOptions{Cwd: cwd}); err == nil {
		t.Fatal("cap not enforced")
	}
	m.CloseAll()
	if _, err := m.Create(new(int), CreateOptions{Cwd: cwd}); err == nil || !strings.Contains(err.Error(), "shutting down") {
		t.Fatalf("create after CloseAll: %v", err)
	}
	if n := len(m.List(owner)); n != 0 {
		t.Fatalf("%d terminals survived CloseAll", n)
	}
}
