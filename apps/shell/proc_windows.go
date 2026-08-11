//go:build windows

package main

import (
	"log"
	"os/exec"
	"time"
)

// configureBridgeProcAttr is a no-op on Windows for now.
// Future: assign the bridge to a Job Object with KILL_ON_JOB_CLOSE
// (see plan §3.1) so MCP/agent grandchildren are reaped reliably.
func configureBridgeProcAttr(cmd *exec.Cmd) {
	// Intentionally empty until Job Object wiring lands with bridge-go.
}

// processAlive is best-effort on Windows; always true so WaitUntilListening
// falls back to its dial timeout instead of a PID probe.
func processAlive(pid int) bool {
	return pid > 0
}

// stopBridgeProcess terminates the bridge process; tree kill is best-effort.
func stopBridgeProcess(cmd *exec.Cmd, grace time.Duration) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Kill()
	done := make(chan struct{})
	go func() {
		_, _ = cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(grace):
		log.Printf("[shell] bridge pid=%d still alive after kill (windows)", pid)
	}
}
