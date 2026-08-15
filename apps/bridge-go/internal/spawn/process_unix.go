//go:build !windows

package spawn

import (
	"os"
	"os/exec"
	"syscall"
)

// HideConsoleWindow is a no-op outside Windows; only that platform pops a
// console window for child processes. See process_windows.go.
func HideConsoleWindow(cmd *exec.Cmd) {}

// configureProcessGroup puts the child in its own process group (setpgid).
// Returns true when group kill via kill(-pid) is available.
func configureProcessGroup(cmd *exec.Cmd) bool {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return true
}

// signalAgentTree sends SIGTERM (or SIGKILL when kill=true) to the process group.
func signalAgentTree(pid int, kill bool, useGroup bool) {
	sig := syscall.SIGTERM
	if kill {
		sig = syscall.SIGKILL
	}
	if useGroup && pid > 0 {
		// Negative pid targets the process group.
		if err := syscall.Kill(-pid, sig); err == nil {
			return
		}
	}
	if pid > 0 {
		_ = syscall.Kill(pid, sig)
	}
}

// stillAlive reports whether pid exists (kill with signal 0).
func stillAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil
}

// Ensure we can signal our own process group leader without special rights on macOS.
var _ = os.Getpid
