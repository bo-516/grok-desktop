package main

import (
	"fmt"
	"io"
	"log"
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
// Includes null / file:// for file-origin webviews and wails://localhost (macOS).
func DefaultAllowedOrigins() string {
	parts := []string{
		"null",
		"file://",
		"wails://localhost",
		"wails://wails",
		"http://wails.localhost",
		"https://wails.localhost",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:4173",
		"http://127.0.0.1:4173",
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
		bin := FindGoBridgeBinary(p.RepoRoot)
		if bin == "" {
			return nil, fmt.Errorf(
				"go bridge selected but binary not found (looked under apps/bridge-go/bin/bridge, apps/bridge-go/bridge, bin/bridge-go); build it or set GROK_DESKTOP_BRIDGE=node",
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
	return &BridgeProcess{cmd: cmd, impl: p.Impl}, nil
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
