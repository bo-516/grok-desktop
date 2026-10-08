// Package gitops runs the git and gh CLIs for the desktop's git panel:
// status, diff, commit, push and pull-request creation against the work tree
// that contains one session's workspace.
//
// Every exec carries a timeout, never prompts for credentials (no terminal,
// no askpass, GIT_TERMINAL_PROMPT=0, gh prompts disabled) and reads stdin only
// from what the caller passes. The git CLI is the source of truth — there is
// no go-git fallback, so results match what the user sees in a terminal.
package gitops

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// Per-operation deadlines. Each stays under the desktop's 120s cli-channel
// timeout (liveBridge.ts) so the bridge always answers before the client
// gives up and the reply is never dropped as an unknown requestId.
const (
	// probeTimeout bounds cheap metadata reads (rev-parse, for-each-ref, …).
	probeTimeout = 10 * time.Second
	// statusTimeout bounds `git status` — large untracked trees can be slow.
	statusTimeout = 20 * time.Second
	// diffTimeout bounds each diff invocation (meta and patch stream).
	diffTimeout = 40 * time.Second
	// commitTimeout covers pre-commit / commit-msg hooks (lint-staged etc.).
	commitTimeout = 90 * time.Second
	// pushTimeout covers network latency plus pre-push hooks.
	pushTimeout = 90 * time.Second
	// ghTimeout bounds `gh pr create` (one GitHub API round trip or two).
	ghTimeout = 90 * time.Second
	// ghAuthTimeout bounds `gh auth status`, which validates tokens online.
	ghAuthTimeout = 20 * time.Second
)

// maxErrorDetailBytes caps the stderr text copied into an error, so a hook
// that dumps megabytes cannot bloat the WebSocket frame.
const maxErrorDetailBytes = 4096

// defaultMaxStdoutBytes caps buffered stdout for non-streaming commands.
const defaultMaxStdoutBytes = 16 * 1024 * 1024

// waitDelay bounds how long Wait lingers on pipes held open by grandchildren
// (ssh, credential helpers, hooks) after the direct child exits or is killed.
const waitDelay = 2 * time.Second

// ErrGitNotFound is returned when no git executable can be located.
var ErrGitNotFound = errors.New("git is not installed or not on PATH")

// execSpec describes one CLI invocation.
type execSpec struct {
	// bin is the resolved executable (from resolveGitBin / resolveGhBin).
	bin string
	// dir is the working directory; required (never the bridge's own cwd).
	dir string
	// args are passed verbatim after bin.
	args []string
	// stdin feeds the child; nil means the null device (never a terminal).
	stdin io.Reader
	// timeout is the hard deadline; the whole process group is killed on expiry.
	timeout time.Duration
	// extraEnv is appended after the non-interactive base environment.
	extraEnv []string
	// maxStdout caps buffered stdout; 0 uses defaultMaxStdoutBytes.
	maxStdout int
}

// execResult is the captured outcome of a finished invocation.
type execResult struct {
	// Stdout holds at most maxStdout bytes of standard output.
	Stdout []byte
	// StdoutTruncated is true when stdout exceeded maxStdout.
	StdoutTruncated bool
	// Stderr is the full (capped) standard error text.
	Stderr string
	// Code is the exit status; 0 on success.
	Code int
}

// cappedBuffer is an io.Writer that keeps at most max bytes and silently
// discards the rest, so a runaway child cannot exhaust bridge memory while
// still being drained (a blocked pipe would otherwise stall the child).
type cappedBuffer struct {
	buf       bytes.Buffer
	max       int
	truncated bool
}

// Write stores what fits under the cap and reports the full length written,
// which keeps the producer unblocked. Never returns an error.
func (c *cappedBuffer) Write(p []byte) (int, error) {
	room := c.max - c.buf.Len()
	if room <= 0 {
		if len(p) > 0 {
			c.truncated = true
		}
		return len(p), nil
	}
	if len(p) > room {
		c.buf.Write(p[:room])
		c.truncated = true
		return len(p), nil
	}
	c.buf.Write(p)
	return len(p), nil
}

// droppedEnvKeys are inherited variables that would redirect git at another
// repository / index, or re-enable interactive credential prompts.
var droppedEnvKeys = map[string]bool{
	"GIT_DIR":               true,
	"GIT_WORK_TREE":         true,
	"GIT_INDEX_FILE":        true,
	"GIT_COMMON_DIR":        true,
	"GIT_PREFIX":            true,
	"GIT_NAMESPACE":         true,
	"GIT_ASKPASS":           true,
	"SSH_ASKPASS":           true,
	"GIT_EDITOR":            true,
	"GIT_TRACE":             true,
	"GIT_CONFIG_PARAMETERS": true,
}

// nonInteractiveEnv is appended to every child: no terminal / GUI prompts,
// no optional index locks (status must not race the agent's own git), literal
// pathspecs (client paths are never globs), and quiet gh.
var nonInteractiveEnv = []string{
	"GIT_TERMINAL_PROMPT=0",
	"GCM_INTERACTIVE=never",
	"SSH_ASKPASS_REQUIRE=never",
	"GIT_OPTIONAL_LOCKS=0",
	"GIT_LITERAL_PATHSPECS=1",
	"GIT_EDITOR=true",
	"GH_PROMPT_DISABLED=1",
	"GH_NO_UPDATE_NOTIFIER=1",
	"GH_SPINNER_DISABLED=1",
	"NO_COLOR=1",
}

// childEnv builds the environment for one git / gh child: the bridge's own
// environment minus droppedEnvKeys, plus nonInteractiveEnv, plus extra.
// Keys compare case-insensitively because Windows environment names do.
// @param extra Additional KEY=VALUE pairs (e.g. GIT_INDEX_FILE for a temp index).
// @returns A fresh slice safe to assign to exec.Cmd.Env.
func childEnv(extra []string) []string {
	base := os.Environ()
	out := make([]string, 0, len(base)+len(nonInteractiveEnv)+len(extra))
	for _, kv := range base {
		key := kv
		if i := strings.IndexByte(kv, '='); i > 0 {
			key = kv[:i]
		}
		if droppedEnvKeys[strings.ToUpper(key)] {
			continue
		}
		out = append(out, kv)
	}
	out = append(out, nonInteractiveEnv...)
	return append(out, extra...)
}

// newCommand wires an exec.Cmd for spec under ctx: directory, environment,
// stdin, hidden console (Windows), detached session (unix, so ssh cannot open
// /dev/tty), group kill on cancel, and a bounded WaitDelay.
// @param ctx Deadline-carrying context; cancellation kills the child tree.
// @param spec Invocation description; spec.dir must be set by the caller.
// @returns A command that has not been started yet.
func newCommand(ctx context.Context, spec execSpec) *exec.Cmd {
	cmd := exec.CommandContext(ctx, spec.bin, spec.args...)
	cmd.Dir = spec.dir
	cmd.Env = childEnv(spec.extraEnv)
	cmd.Stdin = spec.stdin
	spawn.HideConsoleWindow(cmd)
	detachFromTerminal(cmd)
	cmd.WaitDelay = waitDelay
	return cmd
}

// runExec runs spec to completion and captures stdout / stderr.
// A non-zero exit is NOT an error: callers inspect Code and Stderr so they can
// distinguish "not a repository" from real failures. Errors are reserved for
// timeouts and spawn failures (binary missing, permission denied).
// @param spec Invocation; zero timeout means probeTimeout.
// @returns Captured result, or an error naming the command on timeout/spawn failure.
func runExec(spec execSpec) (execResult, error) {
	timeout := spec.timeout
	if timeout <= 0 {
		timeout = probeTimeout
	}
	maxOut := spec.maxStdout
	if maxOut <= 0 {
		maxOut = defaultMaxStdoutBytes
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := newCommand(ctx, spec)
	stdout := &cappedBuffer{max: maxOut}
	stderr := &cappedBuffer{max: 256 * 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	runErr := cmd.Run()
	result := execResult{
		Stdout:          stdout.buf.Bytes(),
		StdoutTruncated: stdout.truncated,
		Stderr:          stderr.buf.String(),
	}
	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("%s timed out after %s", describeCommand(spec), timeout)
	}
	if runErr == nil {
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(runErr, &exitErr) {
		result.Code = exitErr.ExitCode()
		return result, nil
	}
	return result, fmt.Errorf("%s: %w", describeCommand(spec), runErr)
}

// describeCommand renders "<tool> <subcommand>" for error messages — the
// first non-flag argument only, so commit messages or titles never leak into
// logs. `-c key=value` pairs are skipped.
// @param spec Invocation being described.
// @returns Short human label such as "git push" or "gh pr".
func describeCommand(spec execSpec) string {
	name := strings.TrimSuffix(filepath.Base(spec.bin), filepath.Ext(spec.bin))
	for i := 0; i < len(spec.args); i++ {
		a := spec.args[i]
		if a == "-c" {
			i++
			continue
		}
		if !strings.HasPrefix(a, "-") {
			return name + " " + a
		}
	}
	return name
}

// failureDetail picks the most useful text from a failed invocation: stderr,
// else stdout (git commit prints "nothing to commit" on stdout), trimmed and
// capped at maxErrorDetailBytes. Text is returned verbatim so auth / hook
// errors read exactly as they would in a terminal.
// @param r Finished result with a non-zero Code.
// @returns Non-empty detail ("exit status N" when both streams are empty).
func failureDetail(r execResult) string {
	detail := strings.TrimSpace(r.Stderr)
	if detail == "" {
		detail = strings.TrimSpace(string(r.Stdout))
	}
	if detail == "" {
		return fmt.Sprintf("exit status %d", r.Code)
	}
	if len(detail) > maxErrorDetailBytes {
		detail = detail[:maxErrorDetailBytes] + "…"
	}
	return detail
}
