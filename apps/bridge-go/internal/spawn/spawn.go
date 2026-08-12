package spawn

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/envfilter"
	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/jsonrpc"
)

// DisposeKillGrace is the SIGTERM→SIGKILL grace period for the agent tree.
const DisposeKillGrace = 2 * time.Second

// Options configures a grok agent stdio spawn.
type Options struct {
	Cwd           string
	AlwaysApprove bool
	// ExtraArgs are mixed SPAWN flags placed before stdio (see BuildGrokAgentArgs).
	ExtraArgs []string
	// Env overrides merged into the whitelisted child env.
	Env map[string]string
}

// Process is a live grok agent stdio child with line transport.
type Process struct {
	Cmd         *exec.Cmd
	Transport   *StdioTransport
	UseGroup    bool
	disposeOnce sync.Once
}

// ResolveGrokBin finds the grok executable: GROK_BIN, ~/.grok/bin/grok, or PATH "grok".
// Returns an error when none of the candidates exist (except bare "grok" which is deferred to exec).
func ResolveGrokBin() (string, error) {
	home, _ := os.UserHomeDir()
	candidates := []string{}
	if v := os.Getenv("GROK_BIN"); v != "" {
		candidates = append(candidates, v)
	}
	if home != "" {
		candidates = append(candidates, filepath.Join(home, ".grok", "bin", "grok"))
	}
	candidates = append(candidates, "grok")
	for _, c := range candidates {
		if c == "grok" {
			return c, nil
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("grok binary not found (set GROK_BIN or install CLI)")
}

// BuildGrokAgentArgs builds argv for `grok [global…] agent [agent…] stdio`.
// Global SPAWN flags precede `agent`; agent-scoped flags sit between `agent` and `stdio`.
func BuildGrokAgentArgs(opts Options) []string {
	globalFlags := []string{"--no-auto-update"}
	agentFlags := []string{}
	if opts.AlwaysApprove {
		agentFlags = append(agentFlags, "--always-approve")
	}
	extras := opts.ExtraArgs
	globalKeys := map[string]bool{
		"--sandbox": true, "--worktree": true, "-w": true,
		"--worktree-ref": true, "--ref": true, "--no-plan": true,
		"--no-subagents": true, "--no-memory": true, "--max-turns": true,
		"--rules": true, "--disable-web-search": true, "--tools": true,
		"--disallowed-tools": true, "--allow": true, "--deny": true,
		"--permission-mode": true, "--system-prompt-override": true, "--cwd": true,
	}
	agentKeys := map[string]bool{
		"--model": true, "-m": true, "--always-approve": true,
		"--reasoning-effort": true, "--effort": true, "--agent-profile": true,
		"--plugin-dir": true, "--debug": true, "--debug-file": true,
		"--no-leader": true, "--leader": true,
	}
	bareGlobals := map[string]bool{
		"--no-plan": true, "--no-subagents": true, "--no-memory": true,
		"--disable-web-search": true, "--worktree": true, "-w": true,
	}
	bareAgents := map[string]bool{
		"--always-approve": true, "--debug": true, "--no-leader": true, "--leader": true,
	}

	i := 0
	for i < len(extras) {
		a := extras[i]
		var next string
		nextIsValue := false
		if i+1 < len(extras) {
			next = extras[i+1]
			nextIsValue = next != "" && next[0] != '-'
		}
		if a == "--no-auto-update" {
			i++
			continue
		}
		if globalKeys[a] {
			globalFlags = append(globalFlags, a)
			if !bareGlobals[a] && nextIsValue {
				globalFlags = append(globalFlags, next)
				i += 2
				continue
			}
			// bare --worktree may still take a value
			if (a == "--worktree" || a == "-w") && nextIsValue {
				globalFlags = append(globalFlags, next)
				i += 2
				continue
			}
			i++
			continue
		}
		if agentKeys[a] {
			agentFlags = append(agentFlags, a)
			if !bareAgents[a] && nextIsValue {
				agentFlags = append(agentFlags, next)
				i += 2
				continue
			}
			i++
			continue
		}
		// Unknown flags: agent for forward-compat.
		agentFlags = append(agentFlags, a)
		i++
	}
	out := append([]string{}, globalFlags...)
	out = append(out, "agent")
	out = append(out, agentFlags...)
	out = append(out, "stdio")
	return out
}

// SpawnGrokAgent starts grok agent stdio with cwd locked to the workspace.
// Unix: new process group so dispose reaps MCP grandchildren via kill(-pid).
// Windows: Job Object stub (see dispose_windows.go) — falls back to direct kill.
func SpawnGrokAgent(opts Options) (*Process, error) {
	bin, err := ResolveGrokBin()
	if err != nil {
		return nil, err
	}
	args := BuildGrokAgentArgs(opts)

	envSrc := envfilter.EnvironMap()
	for k, v := range opts.Env {
		envSrc[k] = v
	}
	childEnv := envfilter.FilterEnvForGrokChild(envSrc, nil)

	cmd := exec.Command(bin, args...)
	cmd.Dir = opts.Cwd
	cmd.Env = envfilter.MapToEnviron(childEnv)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	useGroup := configureProcessGroup(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("spawn grok failed: %w", err)
	}

	tr := NewStdioTransport(stdin, stdout, stderr, cmd)
	p := &Process{Cmd: cmd, Transport: tr, UseGroup: useGroup}
	tr.onDispose = func() { p.Dispose() }
	return p, nil
}

// Dispose SIGTERMs the agent tree, then SIGKILLs after grace if still alive.
// Process reaping is owned solely by StdioTransport.waitClose (single Wait).
func (p *Process) Dispose() {
	p.disposeOnce.Do(func() {
		if p.Cmd == nil || p.Cmd.Process == nil {
			return
		}
		pid := p.Cmd.Process.Pid
		signalAgentTree(pid, false, p.UseGroup) // SIGTERM
		time.AfterFunc(DisposeKillGrace, func() {
			// Escalate if still alive.
			if stillAlive(pid) {
				signalAgentTree(pid, true, p.UseGroup) // SIGKILL
			}
		})
	})
}

// StdioTransport implements acp.Transport over process pipes.
type StdioTransport struct {
	stdin         io.WriteCloser
	mu            sync.Mutex
	lineHandlers  []func(string)
	closeHandlers []func(*int)
	errHandlers   []func(string)
	onDispose     func()
	closed        bool
	splitter      *jsonrpc.LineSplitter
}

// NewStdioTransport wires stdout line framing and stderr/close fan-out.
func NewStdioTransport(stdin io.WriteCloser, stdout, stderr io.Reader, cmd *exec.Cmd) *StdioTransport {
	t := &StdioTransport{stdin: stdin}
	t.splitter = jsonrpc.NewLineSplitter(func(line string) {
		t.mu.Lock()
		handlers := append([]func(string){}, t.lineHandlers...)
		t.mu.Unlock()
		for _, h := range handlers {
			h(line)
		}
	})
	go t.readStdout(stdout)
	go t.readStderr(stderr)
	go t.waitClose(cmd)
	return t
}

func (t *StdioTransport) readStdout(r io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			t.splitter.Feed(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func (t *StdioTransport) readStderr(r io.Reader) {
	buf := make([]byte, 8*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			t.mu.Lock()
			handlers := append([]func(string){}, t.errHandlers...)
			t.mu.Unlock()
			for _, h := range handlers {
				h(chunk)
			}
		}
		if err != nil {
			return
		}
	}
}

func (t *StdioTransport) waitClose(cmd *exec.Cmd) {
	err := cmd.Wait()
	var code *int
	if err == nil {
		z := 0
		code = &z
	} else if ee, ok := err.(*exec.ExitError); ok {
		c := ee.ExitCode()
		code = &c
	} else {
		c := 1
		code = &c
	}
	t.mu.Lock()
	t.closed = true
	handlers := append([]func(*int){}, t.closeHandlers...)
	t.mu.Unlock()
	for _, h := range handlers {
		h(code)
	}
}

// Write implements acp.Transport.
func (t *StdioTransport) Write(line string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.stdin == nil {
		return
	}
	_, _ = io.WriteString(t.stdin, line)
}

// OnLine implements acp.Transport.
func (t *StdioTransport) OnLine(handler func(line string)) {
	t.mu.Lock()
	t.lineHandlers = append(t.lineHandlers, handler)
	t.mu.Unlock()
}

// OnClose implements acp.Transport.
func (t *StdioTransport) OnClose(handler func(code *int)) {
	t.mu.Lock()
	t.closeHandlers = append(t.closeHandlers, handler)
	t.mu.Unlock()
}

// OnStderr implements acp.Transport.
func (t *StdioTransport) OnStderr(handler func(chunk string)) {
	t.mu.Lock()
	t.errHandlers = append(t.errHandlers, handler)
	t.mu.Unlock()
}

// Dispose implements acp.Transport.
func (t *StdioTransport) Dispose() {
	if t.onDispose != nil {
		t.onDispose()
	}
	t.mu.Lock()
	if t.stdin != nil {
		_ = t.stdin.Close()
	}
	t.mu.Unlock()
}

// Ensure StdioTransport satisfies acp.Transport at compile time.
var _ acp.Transport = (*StdioTransport)(nil)
