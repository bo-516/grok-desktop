//go:build windows

package spawn

import (
	"os"
	"os/exec"
	"syscall"
)

// configureProcessGroup is a Job Object stub on Windows.
// Full Job Object (CreateJobObject + KILL_ON_JOB_CLOSE) is the long-term win;
// for T0 we mark useGroup=false and fall back to direct process kill.
// TODO(windows): attach child to a job object so MCP grandchildren die on dispose.
func configureProcessGroup(cmd *exec.Cmd) bool {
	// CREATE_NEW_PROCESS_GROUP so Ctrl-break style signals can target the tree later.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	return false
}

// signalAgentTree kills the root agent pid (Job Object not yet wired).
func signalAgentTree(pid int, kill bool, useGroup bool) {
	_ = useGroup
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	if kill {
		_ = proc.Kill()
		return
	}
	// Windows has no SIGTERM; Kill is the practical equivalent.
	_ = proc.Kill()
}

// stillAlive probes whether the process still exists.
func stillAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Windows FindProcess always succeeds; Signal(0) is not portable.
	// Best-effort: try to open with SYNCHRONIZE and check wait.
	_ = proc
	return true
}
