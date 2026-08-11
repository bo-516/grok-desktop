package reverse

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// TerminalHandle tracks one agent-spawned shell process.
type TerminalHandle struct {
	TerminalID string
	Cmd        *exec.Cmd
	mu         sync.Mutex
	Output     string
	ExitCode   *int
	Cwd        string
	done       chan struct{}
}

// TerminalCreateParams is the agent terminal/create payload.
type TerminalCreateParams struct {
	Command         string
	Args            []string
	Cwd             string
	Env             map[string]string
	OutputByteLimit int
}

// TerminalRegistry is a mutable map of live terminals for one session runtime.
type TerminalRegistry struct {
	mu        sync.Mutex
	terminals map[string]*TerminalHandle
	seq       int
}

// NewTerminalRegistry creates an empty registry.
func NewTerminalRegistry() *TerminalRegistry {
	return &TerminalRegistry{terminals: make(map[string]*TerminalHandle)}
}

// Create spawns a shell command under workspace and tracks output/exit.
// Full command line with no argv uses the platform shell so spaces/metacharacters work.
// Explicit argv stays shell:false so a single binary path is not re-tokenized.
func (r *TerminalRegistry) Create(workspaceAbs string, params TerminalCreateParams) (map[string]any, error) {
	command := stringsTrim(params.Command)
	if command == "" {
		return nil, fmt.Errorf("terminal/create requires command")
	}
	workCwd := filepath.Clean(workspaceAbs)
	if params.Cwd != "" {
		abs, err := ResolveWorkspacePath(workspaceAbs, params.Cwd)
		if err != nil {
			return nil, err
		}
		workCwd = abs
	}
	r.mu.Lock()
	r.seq++
	terminalID := fmt.Sprintf("term-%d", r.seq)
	r.mu.Unlock()

	args := params.Args
	useShell := len(args) == 0 && regexp.MustCompile(`\s`).MatchString(command)

	var cmd *exec.Cmd
	if useShell {
		// Platform shell: bash -lc on unix, cmd /C on windows (Node shell:true).
		cmd = shellCommand(command, workCwd)
	} else {
		cmd = exec.Command(command, args...)
		cmd.Dir = workCwd
	}
	// Whitelist parent env (F-CFG-05) then merge agent overrides through the same filter.
	cmd.Env = filterTerminalEnv(os.Environ(), params.Env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	handle := &TerminalHandle{
		TerminalID: terminalID,
		Cmd:        cmd,
		Cwd:        workCwd,
		done:       make(chan struct{}),
	}
	limit := params.OutputByteLimit
	if limit <= 0 {
		limit = 256_000
	}
	if limit > 1_000_000 {
		limit = 1_000_000
	}

	appendOut := func(chunk []byte) {
		handle.mu.Lock()
		defer handle.mu.Unlock()
		handle.Output += string(chunk)
		if len(handle.Output) > limit {
			handle.Output = handle.Output[len(handle.Output)-limit:]
		}
	}

	if err := cmd.Start(); err != nil {
		msg := fmt.Sprintf("\n[bridge terminal] spawn failed: %s\n", err.Error())
		handle.mu.Lock()
		handle.Output += msg
		c := 1
		handle.ExitCode = &c
		handle.mu.Unlock()
		close(handle.done)
		r.mu.Lock()
		r.terminals[terminalID] = handle
		r.mu.Unlock()
		return map[string]any{"terminalId": terminalID}, nil
	}

	go func() {
		buf := make([]byte, 4096)
		for {
			n, e := stdout.Read(buf)
			if n > 0 {
				appendOut(buf[:n])
			}
			if e != nil {
				break
			}
		}
	}()
	go func() {
		buf := make([]byte, 4096)
		for {
			n, e := stderr.Read(buf)
			if n > 0 {
				appendOut(buf[:n])
			}
			if e != nil {
				break
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		handle.mu.Lock()
		if handle.ExitCode == nil {
			code := 0
			if err != nil {
				if ee, ok := err.(*exec.ExitError); ok {
					code = ee.ExitCode()
				} else {
					code = 1
				}
			}
			handle.ExitCode = &code
		}
		handle.mu.Unlock()
		close(handle.done)
	}()

	r.mu.Lock()
	r.terminals[terminalID] = handle
	r.mu.Unlock()
	return map[string]any{"terminalId": terminalID}, nil
}

// Wait waits until process exits or timeoutMs elapses (0 = poll once).
func (r *TerminalRegistry) Wait(terminalID string, timeoutMs int) (map[string]any, error) {
	r.mu.Lock()
	handle := r.terminals[terminalID]
	r.mu.Unlock()
	if handle == nil {
		return nil, fmt.Errorf("unknown terminal: %s", terminalID)
	}
	handle.mu.Lock()
	if handle.ExitCode != nil {
		out := handle.Output
		code := handle.ExitCode
		handle.mu.Unlock()
		return map[string]any{"output": out, "exitCode": *code, "truncated": false}, nil
	}
	handle.mu.Unlock()

	if timeoutMs <= 0 {
		handle.mu.Lock()
		out := handle.Output
		var exit any
		if handle.ExitCode != nil {
			exit = *handle.ExitCode
		} else {
			exit = nil
		}
		handle.mu.Unlock()
		return map[string]any{"output": out, "exitCode": exit, "truncated": false}, nil
	}

	timer := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-handle.done:
	case <-timer.C:
	}
	handle.mu.Lock()
	out := handle.Output
	var exit any
	if handle.ExitCode != nil {
		exit = *handle.ExitCode
	}
	handle.mu.Unlock()
	return map[string]any{"output": out, "exitCode": exit, "truncated": false}, nil
}

// Kill terminates a terminal process and drops the registry entry.
func (r *TerminalRegistry) Kill(terminalID string) map[string]any {
	r.mu.Lock()
	handle := r.terminals[terminalID]
	if handle == nil {
		r.mu.Unlock()
		return map[string]any{"ok": false}
	}
	delete(r.terminals, terminalID)
	r.mu.Unlock()
	if handle.Cmd != nil && handle.Cmd.Process != nil {
		_ = handle.Cmd.Process.Kill()
	}
	return map[string]any{"ok": true}
}

// DisposeAll releases all children (session dispose).
func (r *TerminalRegistry) DisposeAll() {
	r.mu.Lock()
	ids := make([]string, 0, len(r.terminals))
	for id := range r.terminals {
		ids = append(ids, id)
	}
	r.mu.Unlock()
	for _, id := range ids {
		r.Kill(id)
	}
}

func stringsTrim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}

// alwaysPassEnv keys match Node envWhitelist.ts ALWAYS_PASS_ENV (F-CFG-05).
var alwaysPassEnv = map[string]bool{
	"PATH": true, "HOME": true, "USER": true, "LOGNAME": true,
	"TMPDIR": true, "TMP": true, "TEMP": true,
	"LANG": true, "LC_ALL": true, "LC_CTYPE": true,
	"TERM": true, "COLORTERM": true, "SHELL": true,
	"XAI_API_KEY": true, "GROK_BIN": true, "GROK_HOME": true,
	"GROK_SANDBOX": true, "GROK_WEB_FETCH": true, "GROK_MEMORY": true,
	"GROK_SUBAGENTS": true, "GROK_LSP_TOOLS": true, "GROK_TOOL_SEARCH": true,
	"GROK_LOG_FILE": true, "RUST_LOG": true,
	"HTTPS_PROXY": true, "HTTP_PROXY": true, "NO_PROXY": true,
	"https_proxy": true, "http_proxy": true, "no_proxy": true,
	"SSL_CERT_FILE": true, "NODE_EXTRA_CA_CERTS": true,
}

// isAllowedEnvKey reports whether a key may be passed to reverse terminals.
func isAllowedEnvKey(key string) bool {
	if alwaysPassEnv[key] {
		return true
	}
	return strings.HasPrefix(key, "GROK_") || strings.HasPrefix(key, "XAI_")
}

// filterTerminalEnv builds a whitelisted env for reverse terminal/create.
// parent is os.Environ() KEY=value pairs; agent may override only allowlisted keys.
func filterTerminalEnv(parent []string, agent map[string]string) []string {
	merged := map[string]string{}
	for _, e := range parent {
		i := strings.IndexByte(e, '=')
		if i <= 0 {
			continue
		}
		k, v := e[:i], e[i+1:]
		if isAllowedEnvKey(k) {
			merged[k] = v
		}
	}
	for k, v := range agent {
		if isAllowedEnvKey(k) {
			merged[k] = v
		}
	}
	out := make([]string, 0, len(merged))
	for k, v := range merged {
		out = append(out, k+"="+v)
	}
	return out
}
