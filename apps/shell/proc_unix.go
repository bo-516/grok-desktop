//go:build unix

package main

import (
	"log"
	"os/exec"
	"syscall"
	"time"
)

// configureBridgeProcAttr puts the child in its own process group (Setpgid)
// so stopBridgeProcess can kill the whole tree with a negative pid.
func configureBridgeProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// stopBridgeProcess sends SIGTERM to the process group, then SIGKILL after grace.
func stopBridgeProcess(cmd *exec.Cmd, grace time.Duration) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	// Negative pid = process group (requires Setpgid).
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		_, _ = cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(grace):
		log.Printf("[shell] bridge pid=%d still alive, SIGKILL process group", pid)
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			_ = cmd.Process.Kill()
		}
	}
}
