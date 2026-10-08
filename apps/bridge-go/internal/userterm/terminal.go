// Package userterm implements the interactive, PTY-backed terminals the user
// opens in the desktop's terminal panel (not the agent's reverse terminal/*
// requests, which live in internal/reverse and run without a PTY).
//
// One Terminal = one login shell on a pseudo-terminal (creack/pty on unix,
// ConPTY on Windows, both via github.com/aymanbagabas/go-pty). Output is
// streamed to the owning WebSocket as base64 frames under a credit window
// (see outputQueue); input / resize ops are re-ordered by client seq (see
// opSequencer). Manager owns the registry and the cleanup hooks (WS
// disconnect, session close, bridge shutdown).
package userterm

import (
	"encoding/base64"
	"fmt"
	"os"
	"sync"
	"time"

	pty "github.com/aymanbagabas/go-pty"
)

// Flow-control and lifecycle tuning for one terminal.
const (
	// readChunk is the PTY read buffer size.
	readChunk = 32 * 1024
	// maxPendingOutput caps output buffered for the UI before the reader stops
	// draining the PTY (backpressure into the child).
	maxPendingOutput = 1 << 20
	// ackWindow is how many sent-but-unacknowledged bytes may be in flight.
	ackWindow = 256 * 1024
	// maxFrameBytes caps one terminal_output frame (before base64).
	maxFrameBytes = 64 * 1024
	// exitDrainGrace is how long, after the shell exits, the reader may keep
	// draining before the PTY is closed (background jobs can hold the slave).
	exitDrainGrace = 300 * time.Millisecond
	// readerGiveUp bounds the wait for the reader after the PTY was closed;
	// past it the exit is reported even if a blocked read never returns.
	readerGiveUp = time.Second
	// killGrace is how long a hung-up terminal gets before SIGKILL.
	killGrace = 3 * time.Second
)

// Emitter delivers one JSON message to the terminal's owning client.
type Emitter func(msg map[string]any)

// Info is the UI-facing description of one terminal (terminal_created /
// terminal_list_result). Field names are the wire protocol.
type Info struct {
	// TerminalID is the bridge-assigned id ("pty-<n>").
	TerminalID string `json:"terminalId"`
	// SessionID is the agent session the terminal belongs to ("" = unbound).
	SessionID string `json:"sessionId,omitempty"`
	// Cwd is the absolute directory the shell started in.
	Cwd string `json:"cwd"`
	// Shell is the program path that was launched.
	Shell string `json:"shell"`
	// Pid is the shell's process id.
	Pid int `json:"pid"`
	// Cols / Rows are the current PTY size.
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// startSpec is everything newTerminal needs to launch a shell.
type startSpec struct {
	// ID is the manager-assigned terminal id.
	ID string
	// SessionID binds the terminal to an agent session ("" = unbound).
	SessionID string
	// Owner is the client key output is routed to (the *websocket.Conn).
	Owner any
	// Cwd is the validated absolute start directory.
	Cwd string
	// Shell / Args are the program to run on the PTY.
	Shell string
	Args  []string
	// Env is the full KEY=value environment for the shell.
	Env []string
	// Cols / Rows are the initial size (clamped by ClampSize).
	Cols, Rows int
	// Emit sends a message to Owner.
	Emit Emitter
	// OnDone runs once after terminal_exit was emitted (registry removal).
	OnDone func(*Terminal)
}

// Terminal is one live PTY shell. Methods are safe for concurrent use.
type Terminal struct {
	// spec is the immutable launch description (id, owner, cwd, shell, …).
	spec startSpec
	// pty is the pseudo-terminal; closed once via closePty.
	pty pty.Pty
	// cmd is the started shell.
	cmd *pty.Cmd
	// tree signals the shell's process tree (platform-specific).
	tree *procTree
	// out buffers PTY output for the sender with backpressure.
	out *outputQueue
	// ops orders input / resize by client seq and serializes PTY writes.
	ops *opSequencer
	// mu guards cols / rows / exitCode / killed.
	mu       sync.Mutex
	cols     int
	rows     int
	exitCode *int
	killed   bool
	// readDone closes when the reader goroutine stops.
	readDone chan struct{}
	// waitDone closes when the shell has been reaped (exitCode is set).
	waitDone chan struct{}
	// done closes after terminal_exit was emitted.
	done chan struct{}
	// closeOnce / killOnce make closePty and Kill idempotent.
	closeOnce sync.Once
	killOnce  sync.Once
}

// newTerminal opens a PTY and starts the shell on it, but does not start the
// I/O goroutines; call run once the terminal is registered (so an instant
// exit cannot race the registry insert).
//
// @param spec Launch description; Shell must be resolvable, Cwd must exist.
// @returns The started terminal, or an error with nothing left running.
func newTerminal(spec startSpec) (*Terminal, error) {
	p, err := pty.New()
	if err != nil {
		return nil, fmt.Errorf("open pty: %w", err)
	}
	cols, rows := ClampSize(spec.Cols, spec.Rows)
	if err := p.Resize(cols, rows); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("size pty: %w", err)
	}
	cmd := p.Command(spec.Shell, spec.Args...)
	cmd.Dir = spec.Cwd
	cmd.Env = spec.Env
	tree := prepareTree(cmd, p)
	if err := cmd.Start(); err != nil {
		tree.release()
		_ = p.Close()
		return nil, fmt.Errorf("start shell %s: %w", spec.Shell, err)
	}
	if err := tree.attach(cmd.Process); err != nil {
		_ = cmd.Process.Kill()
		tree.release()
		_ = p.Close()
		go func() { _ = cmd.Wait() }()
		return nil, err
	}
	closeParentSlave(p)
	return &Terminal{
		spec:     spec,
		pty:      p,
		cmd:      cmd,
		tree:     tree,
		out:      newOutputQueue(maxPendingOutput, ackWindow, maxFrameBytes),
		ops:      newOpSequencer(),
		cols:     cols,
		rows:     rows,
		readDone: make(chan struct{}),
		waitDone: make(chan struct{}),
		done:     make(chan struct{}),
	}, nil
}

// closeParentSlave closes the bridge's copy of the unix PTY slave once the
// shell holds its own, so the master reads EOF/EIO when the shell side goes
// away. No-op for ConPTY, which has no slave file.
//
// @param p The PTY the shell was started on.
func closeParentSlave(p pty.Pty) {
	if s, ok := p.(interface{ Slave() *os.File }); ok {
		_ = s.Slave().Close()
	}
}

// run starts the reader, waiter and sender goroutines. Call exactly once.
func (t *Terminal) run() {
	go t.readLoop()
	go t.waitLoop()
	go t.sendLoop()
}

// readLoop drains the PTY into the output queue until the PTY reports EOF or
// is closed. After abort it keeps draining (discarding) so ConPTY never
// blocks on a full output pipe.
func (t *Terminal) readLoop() {
	defer close(t.readDone)
	defer t.out.closeInput()
	buf := make([]byte, readChunk)
	for {
		n, err := t.pty.Read(buf)
		if n > 0 {
			t.out.push(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

// waitLoop reaps the shell, records its exit code, gives the reader a short
// grace to drain trailing output, then closes the PTY and releases the tree.
func (t *Terminal) waitLoop() {
	_ = t.cmd.Wait()
	code := -1
	if ps := t.cmd.ProcessState; ps != nil {
		code = ps.ExitCode()
	}
	t.mu.Lock()
	t.exitCode = &code
	t.mu.Unlock()
	close(t.waitDone)
	select {
	case <-t.readDone:
	case <-time.After(exitDrainGrace):
	}
	t.closePty()
	t.tree.release()
	select {
	case <-t.readDone:
	case <-time.After(readerGiveUp):
		// A read blocked on a fd whose close is deferred (darwin, background
		// job holding the slave): report the exit anyway.
		t.out.closeInput()
	}
}

// sendLoop forwards output frames to the owner, then emits terminal_exit once
// the shell has been reaped, runs OnDone and finally closes done.
func (t *Terminal) sendLoop() {
	for {
		frame, ok := t.out.next()
		if !ok {
			break
		}
		t.spec.Emit(map[string]any{
			"type":       "terminal_output",
			"terminalId": t.spec.ID,
			"data":       base64.StdEncoding.EncodeToString(frame),
		})
	}
	<-t.waitDone
	t.mu.Lock()
	code, killed := *t.exitCode, t.killed
	t.mu.Unlock()
	t.spec.Emit(map[string]any{
		"type":       "terminal_exit",
		"terminalId": t.spec.ID,
		"exitCode":   code,
		"killed":     killed,
	})
	// Deregister before signalling Done so a waiter (CloseAll) never sees a
	// finished terminal still listed.
	if t.spec.OnDone != nil {
		t.spec.OnDone(t)
	}
	close(t.done)
}

// closePty closes the pseudo-terminal exactly once.
func (t *Terminal) closePty() {
	t.closeOnce.Do(func() { _ = t.pty.Close() })
}

// Write sends user input to the shell in client seq order.
//
// @param seq Per-terminal client sequence number (0 = unordered).
// @param data Raw bytes (UTF-8 keystrokes, pasted text, binary mouse reports).
func (t *Terminal) Write(seq uint64, data []byte) {
	t.ops.submit(seq, func() {
		if t.Exited() || len(data) == 0 {
			return
		}
		_, _ = t.pty.Write(data)
	})
}

// Resize changes the PTY window size in client seq order.
//
// @param seq Per-terminal client sequence number (shares the input counter).
// @param cols / rows New size; clamped by ClampSize.
func (t *Terminal) Resize(seq uint64, cols, rows int) {
	cols, rows = ClampSize(cols, rows)
	t.ops.submit(seq, func() {
		if t.Exited() {
			return
		}
		if err := t.pty.Resize(cols, rows); err != nil {
			return
		}
		t.mu.Lock()
		t.cols, t.rows = cols, rows
		t.mu.Unlock()
	})
}

// Ack returns output credit after the UI rendered n bytes.
//
// @param n Bytes the UI finished writing into xterm.js.
func (t *Terminal) Ack(n int) { t.out.ack(n) }

// Kill stops the terminal: drops undelivered output, hangs up the shell's
// process tree, closes the PTY and escalates to a hard kill after killGrace.
// terminal_exit (killed=true) still follows once the shell is reaped.
// Idempotent and non-blocking.
func (t *Terminal) Kill() {
	t.killOnce.Do(func() {
		t.mu.Lock()
		t.killed = true
		t.mu.Unlock()
		t.out.abort()
		t.tree.stop()
		// ClosePseudoConsole can block while conhost flushes; never block the caller.
		go t.closePty()
		go func() {
			select {
			case <-t.waitDone:
			case <-time.After(killGrace):
				t.tree.kill()
			}
		}()
	})
}

// Exited reports whether the shell has been reaped.
func (t *Terminal) Exited() bool {
	select {
	case <-t.waitDone:
		return true
	default:
		return false
	}
}

// Done is closed after terminal_exit was emitted.
func (t *Terminal) Done() <-chan struct{} { return t.done }

// ID returns the terminal id.
func (t *Terminal) ID() string { return t.spec.ID }

// Info snapshots the terminal for the UI.
//
// @returns Current id / session / cwd / shell / pid / size.
func (t *Terminal) Info() Info {
	t.mu.Lock()
	defer t.mu.Unlock()
	pid := 0
	if t.cmd.Process != nil {
		pid = t.cmd.Process.Pid
	}
	return Info{
		TerminalID: t.spec.ID,
		SessionID:  t.spec.SessionID,
		Cwd:        t.spec.Cwd,
		Shell:      t.spec.Shell,
		Pid:        pid,
		Cols:       t.cols,
		Rows:       t.rows,
	}
}

// ClampSize normalizes a requested PTY size.
//
// @param cols / rows Requested size; <= 0 means "unknown" and becomes 80x24.
// @returns cols in [2, 1000] and rows in [1, 500] (ConPTY rejects 0 and huge sizes).
func ClampSize(cols, rows int) (int, int) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	return min(max(cols, 2), 1000), min(max(rows, 1), 500)
}
