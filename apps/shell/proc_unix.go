//go:build unix

package main

import (
	"log"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// bridgeTree is a placeholder on Unix: Setpgid makes the bridge pid the
// process-group id, so killing the tree needs no extra handle. It exists so
// bridge_launcher.go can drive both platforms through the same calls.
type bridgeTree struct{}

// configureBridgeProcAttr puts the child in its own process group (Setpgid)
// so stopBridgeProcess can kill the whole tree with a negative pid.
//
// @param cmd The bridge command, not yet started; SysProcAttr is replaced.
// @returns An empty tree handle (no OS resource).
func configureBridgeProcAttr(cmd *exec.Cmd) *bridgeTree {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return &bridgeTree{}
}

// attach is a no-op on Unix: the process group exists from Start.
func (t *bridgeTree) attach(proc *os.Process) {}

// release is a no-op on Unix: there is no handle to close.
func (t *bridgeTree) release() {}

// processAlive reports whether pid still exists (signal 0 probe; no signal sent).
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

// stopBridgeProcess sends SIGTERM to the process group, then SIGKILL after grace.
//
// @param cmd The started bridge command; nil / unstarted is a no-op.
// @param tree Unused on Unix (the group id is the bridge pid).
// @param grace How long SIGTERM gets before the group is SIGKILLed.
func stopBridgeProcess(cmd *exec.Cmd, tree *bridgeTree, grace time.Duration) {
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
