package userterm

import (
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// maxTerminalsPerOwner caps live terminals per WebSocket client so a runaway
// UI loop cannot fork-bomb the host with shells.
const maxTerminalsPerOwner = 16

// shutdownWait bounds how long CloseAll waits for shells to be reaped before
// the bridge exits (closing the PTY masters on exit hangs up the rest).
const shutdownWait = 2 * time.Second

// CreateOptions describes a terminal the UI asked for.
type CreateOptions struct {
	// SessionID binds the terminal to an agent session; CloseSession kills it.
	// Empty = not bound (only owner disconnect / shutdown end it).
	SessionID string
	// Cwd is the validated absolute start directory (see ResolveCwd).
	Cwd string
	// Cols / Rows are the initial xterm size; <= 0 falls back to 80x24.
	Cols, Rows int
}

// Manager owns every live user terminal of the bridge process.
// Methods are safe for concurrent use.
type Manager struct {
	// mu guards terms / seq / closed.
	mu sync.Mutex
	// terms maps terminal id → live terminal (removed after terminal_exit).
	terms map[string]*Terminal
	// seq numbers terminal ids.
	seq uint64
	// closed is set by CloseAll; Create fails afterwards.
	closed bool
	// send routes one message to an owner (the wsapi layer's Send).
	send func(owner any, msg map[string]any)
	// shell resolves the program to launch (defaultShell; replaced in tests).
	shell func() (string, []string)
	// environ supplies the parent environment (os.Environ; replaced in tests).
	environ func() []string
}

// NewManager creates an empty registry.
//
// @param send Delivers a message to the client identified by owner; must be
// safe for concurrent use and tolerate a closed connection.
// @returns A manager that launches the user's default shell.
func NewManager(send func(owner any, msg map[string]any)) *Manager {
	return &Manager{
		terms:   make(map[string]*Terminal),
		send:    send,
		shell:   defaultShell,
		environ: os.Environ,
	}
}

// Create starts a shell on a new PTY for owner.
//
// @param owner Client key (the *websocket.Conn); output only goes there and
// only it may drive the terminal.
// @param opts Session binding, validated cwd and initial size.
// @returns The new terminal's Info, or an error when the bridge is shutting
// down, the per-owner cap is reached, or the PTY/shell failed to start.
func (m *Manager) Create(owner any, opts CreateOptions) (Info, error) {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return Info{}, fmt.Errorf("bridge is shutting down")
	}
	if m.countLocked(owner) >= maxTerminalsPerOwner {
		m.mu.Unlock()
		return Info{}, fmt.Errorf("too many terminals (max %d)", maxTerminalsPerOwner)
	}
	m.seq++
	id := "pty-" + strconv.FormatUint(m.seq, 10)
	m.mu.Unlock()

	shell, args := m.shell()
	t, err := newTerminal(startSpec{
		ID:        id,
		SessionID: opts.SessionID,
		Owner:     owner,
		Cwd:       opts.Cwd,
		Shell:     shell,
		Args:      args,
		Env:       BuildEnv(m.environ(), runtime.GOOS, opts.Cwd),
		Cols:      opts.Cols,
		Rows:      opts.Rows,
		Emit:      func(msg map[string]any) { m.send(owner, msg) },
		OnDone:    m.forget,
	})
	if err != nil {
		return Info{}, err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		t.run()
		t.Kill()
		return Info{}, fmt.Errorf("bridge is shutting down")
	}
	m.terms[id] = t
	m.mu.Unlock()
	t.run()
	return t.Info(), nil
}

// Get returns owner's terminal by id.
//
// @param owner Client key; a terminal owned by another client is not visible.
// @param id Terminal id from terminal_created.
// @returns The terminal, or an error for unknown / foreign / finished ids.
func (m *Manager) Get(owner any, id string) (*Terminal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := m.terms[id]
	if t == nil || t.spec.Owner != owner {
		return nil, fmt.Errorf("unknown terminal: %s", id)
	}
	return t, nil
}

// List returns owner's live terminals ordered by id number.
//
// @param owner Client key.
// @returns Info snapshots (empty, never nil).
func (m *Manager) List(owner any) []Info {
	out := make([]Info, 0)
	for _, t := range m.matching(func(t *Terminal) bool { return t.spec.Owner == owner }) {
		out = append(out, t.Info())
	}
	return out
}

// CloseOwner kills every terminal of owner (WebSocket disconnect).
//
// @param owner Client key.
// @returns How many terminals were signalled.
func (m *Manager) CloseOwner(owner any) int {
	return killAll(m.matching(func(t *Terminal) bool { return t.spec.Owner == owner }))
}

// CloseSession kills every terminal bound to sessionID (close_session).
//
// @param sessionID Agent session id; "" matches nothing (unbound terminals
// are not tied to any session).
// @returns How many terminals were signalled.
func (m *Manager) CloseSession(sessionID string) int {
	if sessionID == "" {
		return 0
	}
	return killAll(m.matching(func(t *Terminal) bool { return t.spec.SessionID == sessionID }))
}

// CloseAll kills every terminal and refuses new ones (bridge shutdown). It
// waits up to shutdownWait for the shells to be reaped so app quit does not
// leave orphans behind. Idempotent.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	terms := m.matching(func(*Terminal) bool { return true })
	killAll(terms)
	deadline := time.After(shutdownWait)
	for _, t := range terms {
		select {
		case <-t.Done():
		case <-deadline:
			return
		}
	}
}

// forget drops a finished terminal from the registry (Terminal OnDone hook).
//
// @param t The terminal whose terminal_exit was just emitted.
func (m *Manager) forget(t *Terminal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.terms[t.spec.ID] == t {
		delete(m.terms, t.spec.ID)
	}
}

// matching snapshots the terminals accepted by keep, ordered by id number.
//
// @param keep Filter run under the registry lock; must not call back into m.
// @returns A new slice, safe to use after the lock is released.
func (m *Manager) matching(keep func(*Terminal) bool) []*Terminal {
	m.mu.Lock()
	out := make([]*Terminal, 0, len(m.terms))
	for _, t := range m.terms {
		if keep(t) {
			out = append(out, t)
		}
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return idNumber(out[i].spec.ID) < idNumber(out[j].spec.ID) })
	return out
}

// countLocked counts owner's live terminals; m.mu must be held.
//
// @param owner Client key.
// @returns Number of registered terminals for owner.
func (m *Manager) countLocked(owner any) int {
	n := 0
	for _, t := range m.terms {
		if t.spec.Owner == owner {
			n++
		}
	}
	return n
}

// killAll calls Kill on every terminal.
//
// @param terms Terminals to stop.
// @returns len(terms).
func killAll(terms []*Terminal) int {
	for _, t := range terms {
		t.Kill()
	}
	return len(terms)
}

// idNumber parses the numeric suffix of a "pty-<n>" id for stable ordering.
//
// @param id Terminal id.
// @returns The number, or 0 when the id has another shape.
func idNumber(id string) uint64 {
	n, err := strconv.ParseUint(strings.TrimPrefix(id, "pty-"), 10, 64)
	if err != nil {
		return 0
	}
	return n
}
