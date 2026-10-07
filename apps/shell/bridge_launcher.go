package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// BridgeLaunchParams carries everything needed to spawn a bridge child process.
type BridgeLaunchParams struct {
	// Impl is node or go (cold-switch selection).
	Impl BridgeImpl
	// Port is the free TCP port the bridge must bind (BRIDGE_PORT).
	Port int
	// Token is the per-start auth secret (BRIDGE_TOKEN).
	Token string
	// Host is the bind address (default 127.0.0.1).
	Host string
	// AllowedOrigins is comma-separated BRIDGE_ALLOWED_ORIGINS.
	AllowedOrigins string
	// Cwd is BRIDGE_CWD (workspace root for agent sessions).
	Cwd string
	// RepoRoot is the monorepo root used to resolve scripts/binaries.
	// Empty is packaged mode: locate the Go binary next to the executable.
	RepoRoot string
	// Stdout/Stderr optional sinks (default os.Stdout/os.Stderr).
	Stdout io.Writer
	Stderr io.Writer
}

// BridgeProcess is a running bridge child (separate OS process, never in-process).
type BridgeProcess struct {
	// cmd is the started bridge; nil after Stop.
	cmd *exec.Cmd
	// impl is the bridge implementation that was launched.
	impl BridgeImpl
	// tree kills the bridge's whole process tree on Stop (Unix: placeholder,
	// the process group needs no handle; Windows: kill-on-close Job Object).
	tree *bridgeTree
	// mu serializes Stop.
	mu sync.Mutex
}

// DefaultAllowedOrigins for packaged Wails shell + common dev origins.
// Darwin page origin is wails://localhost; Windows uses https://wails.localhost;
// Linux may use wails://wails. Also include extra host variants seen in the wild.
func DefaultAllowedOrigins() string {
	parts := []string{
		"null",
		"file://",
		"wails://localhost",
		"wails://wails",
		"wails://wails.localhost",
		"http://wails.localhost",
		"https://wails.localhost",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:4173",
		"http://127.0.0.1:4173",
		"http://localhost:8172",
		"http://127.0.0.1:8172",
	}
	return strings.Join(parts, ",")
}

// StartBridge spawns bridge-go as a child process with its own process group
// (Unix Setpgid) or kill-on-close Job Object (Windows) so Stop can kill the
// whole tree; on Windows the job also takes the tree down if the shell dies.
// Empty RepoRoot is packaged mode: locate the Go binary next to the executable
// and use Cwd (or ResolveBridgeLaunchCwd) as cmd.Dir.
// Impl "node" returns nodeBridgeRemoved and does not exec. Empty Impl is Go.
// Returns a running BridgeProcess or an error (e.g. go binary missing).
func StartBridge(p BridgeLaunchParams) (*BridgeProcess, error) {
	if p.Host == "" {
		p.Host = "127.0.0.1"
	}
	if p.AllowedOrigins == "" {
		p.AllowedOrigins = DefaultAllowedOrigins()
	}
	if p.Stdout == nil {
		p.Stdout = os.Stdout
	}
	if p.Stderr == nil {
		p.Stderr = os.Stderr
	}
	if p.Port <= 0 {
		return nil, fmt.Errorf("StartBridge: Port must be positive")
	}
	if strings.TrimSpace(p.Token) == "" {
		return nil, fmt.Errorf("StartBridge: Token is required")
	}
	if strings.TrimSpace(p.Cwd) == "" {
		p.Cwd = ResolveBridgeLaunchCwd(p.RepoRoot)
	}

	var cmd *exec.Cmd
	switch p.Impl {
	case BridgeImplGo, "":
		// Empty impl is Go — the only bridge. Checkout: monorepo bin/.
		// Packaged (empty repoRoot): exe-adjacent.
		bin := FindGoBridgeBinary(p.RepoRoot)
		if bin == "" {
			return nil, fmt.Errorf(
				"go bridge selected but binary not found (looked under %v); build with: (cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge)",
				GoBridgeBinaryCandidates(p.RepoRoot),
			)
		}
		cmd = exec.Command(bin)
	case "node":
		return nil, fmt.Errorf("%s", nodeBridgeRemoved)
	default:
		return nil, fmt.Errorf("unknown bridge impl %q", p.Impl)
	}

	// Workspace cwd is where the agent should run; repoRoot only locates scripts.
	cmd.Dir = p.Cwd
	cmd.Stdout = p.Stdout
	cmd.Stderr = p.Stderr
	cmd.Env = bridgeEnv(os.Environ(), p)
	// Own process group (Unix Setpgid) / kill-on-close Job Object (Windows) so
	// Stop kills the whole tree (bridge-go → grok → MCP servers, terminals).
	tree := configureBridgeProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		tree.release()
		return nil, fmt.Errorf("start bridge (%s): %w", p.Impl, err)
	}
	// Must run before WaitUntilListening / before the UI gets the token, so
	// the bridge cannot have spawned anything outside the job yet.
	tree.attach(cmd.Process)
	log.Printf("[shell] bridge %s started pid=%d port=%d", p.Impl, cmd.Process.Pid, p.Port)
	bp := &BridgeProcess{cmd: cmd, impl: p.Impl, tree: tree}
	// Block until the child accepts TCP (or dies). UI auto-connects on first
	// paint; without this race, WebSocket hits a closed port → Offline banner.
	if err := bp.WaitUntilListening(p.Host, p.Port, 15*time.Second); err != nil {
		bp.Stop()
		return nil, err
	}
	log.Printf("[shell] bridge %s listening on %s:%d", p.Impl, p.Host, p.Port)
	return bp, nil
}

// WaitUntilListening polls host:port until TCP connect succeeds, the child dies,
// or timeout elapses. timeout should be generous for a cold bridge-go start.
// Returns an error when the process exits early or the deadline is hit.
func (b *BridgeProcess) WaitUntilListening(host string, port int, timeout time.Duration) error {
	if b == nil || b.cmd == nil || b.cmd.Process == nil {
		return fmt.Errorf("WaitUntilListening: no bridge process")
	}
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		return fmt.Errorf("WaitUntilListening: invalid port %d", port)
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	deadline := time.Now().Add(timeout)
	pid := b.cmd.Process.Pid
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 150*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		// Fail fast if the child already died (no silent hang until timeout).
		if !processAlive(pid) {
			return fmt.Errorf("bridge exited before listening on %s (pid=%d)", addr, pid)
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("bridge did not listen on %s within %s (pid=%d)", addr, timeout, pid)
}

// bridgeEnv merges parent env with bridge-required variables (overrides win).
func bridgeEnv(parent []string, p BridgeLaunchParams) []string {
	overrides := map[string]string{
		"BRIDGE_PORT":            strconv.Itoa(p.Port),
		"BRIDGE_TOKEN":           p.Token,
		"BRIDGE_HOST":            p.Host,
		"BRIDGE_ALLOWED_ORIGINS": p.AllowedOrigins,
	}
	if p.Cwd != "" {
		overrides["BRIDGE_CWD"] = p.Cwd
	}
	out := make([]string, 0, len(parent)+len(overrides))
	seen := make(map[string]bool, len(overrides))
	for _, e := range parent {
		eq := strings.IndexByte(e, '=')
		if eq <= 0 {
			out = append(out, e)
			continue
		}
		k := e[:eq]
		if v, ok := overrides[k]; ok {
			out = append(out, k+"="+v)
			seen[k] = true
			continue
		}
		out = append(out, e)
	}
	for k, v := range overrides {
		if !seen[k] {
			out = append(out, k+"="+v)
		}
	}
	return out
}

// Stop kills the bridge process tree: SIGTERM then SIGKILL on the Unix
// process group; TerminateJobObject on Windows (bridge pid only if the job
// could not be set up). Safe to call multiple times.
func (b *BridgeProcess) Stop() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cmd == nil || b.cmd.Process == nil {
		return
	}
	pid := b.cmd.Process.Pid
	log.Printf("[shell] stopping bridge pid=%d", pid)
	stopBridgeProcess(b.cmd, b.tree, 3*time.Second)
	b.cmd = nil
	b.tree = nil
}

// Wait blocks until the bridge process exits.
func (b *BridgeProcess) Wait() error {
	if b == nil || b.cmd == nil {
		return nil
	}
	return b.cmd.Wait()
}

// Pid returns the child PID or 0.
func (b *BridgeProcess) Pid() int {
	if b == nil || b.cmd == nil || b.cmd.Process == nil {
		return 0
	}
	return b.cmd.Process.Pid
}

// Dir is the child process working directory (workspace cwd, not repo root).
func (b *BridgeProcess) Dir() string {
	if b == nil || b.cmd == nil {
		return ""
	}
	return b.cmd.Dir
}
