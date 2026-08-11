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
	RepoRoot string
	// Stdout/Stderr optional sinks (default os.Stdout/os.Stderr).
	Stdout io.Writer
	Stderr io.Writer
}

// BridgeProcess is a running bridge child (separate OS process, never in-process).
type BridgeProcess struct {
	cmd  *exec.Cmd
	impl BridgeImpl
	mu   sync.Mutex
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

// StartBridge spawns the selected bridge as a child process with its own process group
// (Unix Setpgid) so Stop can kill the whole tree.
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
	if p.RepoRoot == "" {
		return nil, fmt.Errorf("StartBridge: RepoRoot is required")
	}
	if p.Port <= 0 {
		return nil, fmt.Errorf("StartBridge: Port must be positive")
	}
	if strings.TrimSpace(p.Token) == "" {
		return nil, fmt.Errorf("StartBridge: Token is required")
	}

	var cmd *exec.Cmd
	switch p.Impl {
	case BridgeImplNode, "":
		script := NodeBridgeScript(p.RepoRoot)
		if st, err := os.Stat(script); err != nil || st.IsDir() {
			return nil, fmt.Errorf("node bridge script missing: %s", script)
		}
		tsx, prefix, err := ResolveTsx(p.RepoRoot)
		if err != nil {
			return nil, err
		}
		args := append(append([]string{}, prefix...), script)
		cmd = exec.Command(tsx, args...)
	case BridgeImplGo:
		// Prefer monorepo build output (bin/bridge-go); fall back to legacy names.
		bin := FindGoBridgeBinary(p.RepoRoot)
		if bin == "" {
			return nil, fmt.Errorf(
				"go bridge selected but binary not found (looked under %v); build with: (cd apps/bridge-go && go build -o bin/bridge-go ./cmd/bridge) — or set GROK_DESKTOP_BRIDGE=node",
				GoBridgeBinaryCandidates(p.RepoRoot),
			)
		}
		cmd = exec.Command(bin)
	default:
		return nil, fmt.Errorf("unknown bridge impl %q", p.Impl)
	}

	cmd.Dir = p.RepoRoot
	cmd.Stdout = p.Stdout
	cmd.Stderr = p.Stderr
	cmd.Env = bridgeEnv(os.Environ(), p)
	// Own process group (Unix Setpgid) so we can kill the tree (tsx → node → grok).
	configureBridgeProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start bridge (%s): %w", p.Impl, err)
	}
	log.Printf("[shell] bridge %s started pid=%d port=%d", p.Impl, cmd.Process.Pid, p.Port)
	bp := &BridgeProcess{cmd: cmd, impl: p.Impl}
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
// or timeout elapses. timeout should be generous for cold Node/tsx startup.
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

// Stop signals the bridge process tree (SIGTERM then SIGKILL on Unix process group).
// Safe to call multiple times.
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
	stopBridgeProcess(b.cmd, 3*time.Second)
	b.cmd = nil
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
