package spawn

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// CliRunResult is the outcome of one one-shot `grok <args…>` invocation.
// Mirrors the Node bridge's cliRunner.CliRunResult so Environment / CLI
// channel consumers see the same shape whether the host is Node or Go.
type CliRunResult struct {
	// Code is the process exit code. nil when the process was killed before
	// reporting a code (timeout path returns an error instead of a result).
	Code *int
	// Stdout is the full utf-8 stdout capture.
	Stdout string
	// Stderr is the full utf-8 stderr capture.
	Stderr string
	// JSON is the parsed stdout when it is valid JSON (or the last NDJSON
	// object). nil when stdout is empty or not parseable.
	JSON any
}

// RunGrokCli spawns the resolved grok binary with args, captures stdout/stderr,
// and returns when the child exits or timeoutMs elapses.
//
// cwd is the workspace directory (empty keeps the bridge process cwd). env is
// the full process environment — one-shot CLI commands mirror Node's
// cliRunner (no whitelist filter); agent stdio still uses FilterEnvForGrokChild.
//
// On timeout the child is SIGTERM'd and an error is returned so the CLI channel
// can surface a clear failure rather than a partial capture. On spawn failure
// (binary missing, permission) the error is returned with a zero result.
//
// @param args Argv after the binary (e.g. ["inspect", "--json"]).
// @param cwd Optional workspace for project-scoped config discovery.
// @param timeoutMs Soft deadline; 0 defaults to 60_000.
// @returns Captured streams + optional JSON, or an error on timeout/spawn fail.
func RunGrokCli(args []string, cwd string, timeoutMs int) (CliRunResult, error) {
	if timeoutMs <= 0 {
		timeoutMs = 60_000
	}
	bin, err := ResolveGrokBin()
	if err != nil {
		return CliRunResult{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	outStr := stdout.String()
	errStr := stderr.String()
	result := CliRunResult{
		Stdout: outStr,
		Stderr: errStr,
		JSON:   TryParseJSON(outStr),
	}

	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("grok %s timed out after %dms", strings.Join(args, " "), timeoutMs)
	}
	if runErr == nil {
		z := 0
		result.Code = &z
		return result, nil
	}
	if ee, ok := runErr.(*exec.ExitError); ok {
		c := ee.ExitCode()
		result.Code = &c
		return result, nil
	}
	// Spawn / IO failure (binary not executable, etc.).
	return result, runErr
}

// TryParseJSON parses CLI stdout as JSON, or as the last NDJSON object when
// the whole buffer is not a single value. Empty / unparseable input returns nil
// so callers can fall back to a plain-text path.
//
// @param text Raw stdout from a grok CLI invocation.
// @returns Parsed value, or nil.
func TryParseJSON(text string) any {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	var v any
	if err := json.Unmarshal([]byte(trimmed), &v); err == nil {
		return v
	}
	// NDJSON: walk lines from the end; first successful parse wins.
	lines := strings.Split(trimmed, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		var obj any
		if err := json.Unmarshal([]byte(line), &obj); err == nil {
			return obj
		}
	}
	return nil
}

// AssertCliOk returns an error when the CLI exit code is non-zero.
// Detail is truncated so a huge stderr dump cannot bloat the WS error frame.
//
// @param result From RunGrokCli.
// @param label Human label for the error message (e.g. "inspect").
// @returns nil on success, or a descriptive error.
func AssertCliOk(result CliRunResult, label string) error {
	if result.Code != nil && *result.Code == 0 {
		return nil
	}
	code := -1
	if result.Code != nil {
		code = *result.Code
	}
	detail := strings.TrimSpace(result.Stderr)
	if detail == "" {
		detail = strings.TrimSpace(result.Stdout)
	}
	if detail == "" {
		detail = "unknown error"
	}
	if len(detail) > 500 {
		detail = detail[:500]
	}
	return fmt.Errorf("%s failed (exit %d): %s", label, code, detail)
}
