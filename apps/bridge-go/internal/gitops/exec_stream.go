package gitops

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
)

// streamExec starts spec and hands its stdout to consume while the child is
// still running, for outputs too large to buffer whole (multi-file patches).
// consume must read until EOF unless it fails; on a consume error the child
// is killed so Wait cannot block on a pipe nobody reads.
// @param spec Invocation; zero timeout means probeTimeout.
// @param consume Reader callback; its error is returned as-is.
// @returns Exit code + stderr (Stdout stays empty), or an error on timeout,
//
//	spawn failure or consume failure.
func streamExec(spec execSpec, consume func(io.Reader) error) (execResult, error) {
	timeout := spec.timeout
	if timeout <= 0 {
		timeout = probeTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := newCommand(ctx, spec)
	stderr := &cappedBuffer{max: 256 * 1024}
	cmd.Stderr = stderr
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return execResult{}, fmt.Errorf("%s: %w", describeCommand(spec), err)
	}
	if err := cmd.Start(); err != nil {
		return execResult{}, fmt.Errorf("%s: %w", describeCommand(spec), err)
	}
	consumeErr := consume(pipe)
	if consumeErr != nil {
		cancel()
	}
	waitErr := cmd.Wait()
	result := execResult{Stderr: stderr.buf.String()}
	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("%s timed out after %s", describeCommand(spec), timeout)
	}
	if consumeErr != nil {
		return result, consumeErr
	}
	if waitErr == nil {
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		result.Code = exitErr.ExitCode()
		return result, nil
	}
	return result, fmt.Errorf("%s: %w", describeCommand(spec), waitErr)
}
