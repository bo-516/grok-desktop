package spawn

import (
	"context"
	"errors"
	"os/exec"
	"sync"
	"time"
	"unicode/utf8"
)

// SetupRunTimeout caps one install / update run. The installer downloads a
// ~170 MiB binary, so this is sized for a slow connection, not a fast one.
const SetupRunTimeout = 15 * time.Minute

// setupWaitDelay bounds how long Wait keeps reading output after the root
// process exited, so a backgrounded grandchild holding the pipe cannot keep
// the run "in progress" forever.
const setupWaitDelay = 2 * time.Second

// SetupRunResult is the outcome of one RunSetupCommand.
type SetupRunResult struct {
	// Code is the root process exit code; nil when it was killed (cancel /
	// timeout) or never started.
	Code *int `json:"code"`
	// TimedOut is true when the run hit its timeout and was killed.
	TimedOut bool `json:"timedOut"`
	// Canceled is true when the caller's context was canceled (user pressed
	// Cancel) and the run was killed.
	Canceled bool `json:"canceled"`
}

// RunSetupCommand runs argv as a process tree, streams its combined
// stdout/stderr to onOutput, and waits for it to finish. It backs the
// onboarding "Run installer" / "Update" buttons.
//
// The child gets the same tree treatment as an agent (unix process group,
// Windows kill-on-close job), so cancel and timeout stop the whole pipeline —
// `bash -c "curl … | bash"` included — not just the root shell. Stdin is the
// null device: installers that would prompt see EOF instead of hanging.
//
// @param ctx Cancel to stop the run (the tree gets SIGTERM, then SIGKILL after
// DisposeKillGrace; Windows terminates the job).
// @param argv Program and arguments; must be non-empty.
// @param env Full child environment (nil inherits the bridge's).
// @param timeout Hard cap; <= 0 uses SetupRunTimeout.
// @param onOutput Called with each output chunk, never with a split UTF-8
// sequence; calls are serialized. May be nil.
// @returns The result, or an error when argv is empty or the process could not
// start (the result is then zero).
func RunSetupCommand(
	ctx context.Context,
	argv []string,
	env []string,
	timeout time.Duration,
	onOutput func(chunk string),
) (SetupRunResult, error) {
	if len(argv) == 0 {
		return SetupRunResult{}, errors.New("empty setup command")
	}
	if timeout <= 0 {
		timeout = SetupRunTimeout
	}
	out := &utf8ChunkWriter{emit: onOutput}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = env
	cmd.Stdout = out
	cmd.Stderr = out
	cmd.WaitDelay = setupWaitDelay
	tree, err := startAgentTree(cmd)
	if err != nil {
		return SetupRunResult{}, err
	}
	defer tree.release()

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var waitErr error
	result := SetupRunResult{}
	select {
	case waitErr = <-done:
	case <-ctx.Done():
		result.Canceled = true
		waitErr = stopSetupTree(tree, done)
	case <-timer.C:
		result.TimedOut = true
		waitErr = stopSetupTree(tree, done)
	}
	out.flush()
	if result.Canceled || result.TimedOut {
		return result, nil
	}
	code := 0
	if waitErr != nil {
		var ee *exec.ExitError
		if !errors.As(waitErr, &ee) {
			return result, waitErr
		}
		code = ee.ExitCode()
	}
	result.Code = &code
	return result, nil
}

// stopSetupTree soft-stops the tree, hard-kills it after DisposeKillGrace if
// Wait has not returned, and then waits for Wait.
//
// @param tree The running tree.
// @param done Receives cmd.Wait's error exactly once.
// @returns Wait's error (normally a signal / kill exit).
func stopSetupTree(tree *agentTree, done <-chan error) error {
	tree.signal(false)
	select {
	case err := <-done:
		return err
	case <-time.After(DisposeKillGrace):
		tree.signal(true)
		return <-done
	}
}

// utf8ChunkWriter forwards writes to emit, holding back an incomplete trailing
// UTF-8 sequence until the next write so a multi-byte character is never split
// across two chunks (JSON encoding would turn each half into U+FFFD).
type utf8ChunkWriter struct {
	// mu serializes Write and flush (stdout and stderr share this writer).
	mu sync.Mutex
	// pending holds at most utf8.UTFMax-1 bytes of an unfinished character.
	pending []byte
	// emit receives each complete chunk; nil discards output.
	emit func(chunk string)
}

// Write implements io.Writer. Never fails.
//
// @param p Raw output bytes.
// @returns len(p), nil.
func (w *utf8ChunkWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	buf := append(w.pending, p...)
	cut := completeUTF8Prefix(buf)
	w.pending = append([]byte(nil), buf[cut:]...)
	if cut > 0 && w.emit != nil {
		w.emit(string(buf[:cut]))
	}
	return len(p), nil
}

// flush emits whatever is still held back (an invalid tail stays invalid).
func (w *utf8ChunkWriter) flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.pending) > 0 && w.emit != nil {
		w.emit(string(w.pending))
	}
	w.pending = nil
}

// completeUTF8Prefix returns the length of buf without a trailing, possibly
// still-arriving UTF-8 sequence. Only the last utf8.UTFMax-1 bytes are
// examined; invalid bytes elsewhere pass through unchanged.
//
// @param buf Output bytes accumulated so far.
// @returns The byte count safe to emit now.
func completeUTF8Prefix(buf []byte) int {
	for back := 1; back < utf8.UTFMax && back <= len(buf); back++ {
		b := buf[len(buf)-back]
		if b < 0x80 {
			return len(buf) // ASCII: everything before is complete.
		}
		if utf8.RuneStart(b) {
			if utf8.FullRune(buf[len(buf)-back:]) {
				return len(buf)
			}
			return len(buf) - back
		}
	}
	return len(buf)
}
