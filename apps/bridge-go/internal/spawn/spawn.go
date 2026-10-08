package spawn

import (
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/envfilter"
	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/jsonrpc"
)

// DisposeKillGrace is how long Dispose lets the agent tree stop gracefully
// before it is hard-killed (unix SIGTERM→SIGKILL; Windows stdin EOF→
// TerminateJobObject).
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
	// Cmd is the started root grok process. Reaped only by Transport (single Wait).
	Cmd *exec.Cmd
	// Transport is the NDJSON line transport over the child's stdio.
	Transport *StdioTransport
	// UseGroup reports whether Dispose reaches the whole tree (grok + MCP /
	// tool grandchildren): unix process group, Windows Job Object. false means
	// only the root grok process is signalled (Windows job fallback).
	UseGroup bool
	// tree is the platform handle used to stop the tree; nil only for a
	// Process not built by SpawnGrokAgent, which Dispose then ignores.
	tree *agentTree
	// disposeOnce makes Dispose idempotent (transport and runtime both call it).
	disposeOnce sync.Once
}

// ResolveGrokBin finds the grok executable via grokbin.Locate: GROK_BIN, the
// custom path saved from Settings, ~/.grok/bin/grok (grok.exe on Windows),
// then PATH. The settings file is re-read on every call, so a new custom path
// applies to the next spawn without restarting the bridge.
//
// @returns The executable path, or a *grokbin.LocateError when grok is not
// installed or an explicit path (GROK_BIN / setting) is unusable.
func ResolveGrokBin() (string, error) {
	loc, err := grokbin.Locate()
	if err != nil {
		return "", err
	}
	return loc.Path, nil
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
// The child is started through startAgentTree so Dispose reaps MCP / tool
// grandchildren too:
//   - unix: own process group (setpgid); Dispose signals kill(-pid).
//   - Windows: kill-on-close Job Object, entered while the child is still
//     suspended so no grandchild can escape it; Dispose terminates the job,
//     and the job also dies with the bridge process. If the job cannot be
//     set up the spawn still succeeds with root-only kill (UseGroup=false).
//
// @param opts Workspace cwd, approval mode, extra SPAWN flags, env overrides.
// @returns The running Process; an error when grok cannot be resolved, the
// pipes cannot be created, or the child cannot be started (nothing is left
// running in that case).
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

	tree, err := startAgentTree(cmd)
	if err != nil {
		return nil, fmt.Errorf("spawn grok failed: %w", err)
	}

	tr := NewStdioTransport(stdin, stdout, stderr, cmd)
	p := &Process{Cmd: cmd, Transport: tr, UseGroup: tree.grouped(), tree: tree}
	tr.onDispose = func() { p.Dispose() }
	return p, nil
}

// Dispose stops the agent tree: a soft stop now, a hard kill of the whole tree
// after DisposeKillGrace if it is still alive, then release of the tree's OS
// resources. Non-blocking, idempotent (only the first call acts), safe from
// any goroutine.
//   - unix: SIGTERM to the process group now; SIGKILL to the group after the
//     grace if the root pid still exists.
//   - Windows: no SIGTERM exists, so the soft stop is the stdin EOF that
//     StdioTransport.Dispose sends right after this call. After the grace the
//     job is terminated if any process in it still runs (an orphaned MCP
//     server counts), and the job handle is closed.
//
// If the bridge exits before the grace fires, unix trees keep only the
// SIGTERM; Windows trees are killed by the kernel when the job handle closes.
// Process reaping is owned solely by StdioTransport.waitClose (single Wait).
func (p *Process) Dispose() {
	p.disposeOnce.Do(func() {
		if p.Cmd == nil || p.Cmd.Process == nil || p.tree == nil {
			return
		}
		p.tree.signal(false)
		time.AfterFunc(DisposeKillGrace, func() {
			// Escalate if still alive.
			if p.tree.alive() {
				p.tree.signal(true)
			}
			p.tree.release()
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
