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

// agentTree is the unix handle for one grok agent tree. setpgid makes the root
// pid double as the process-group id, so kill(-pid) reaches grok and every MCP
// / tool grandchild that did not start its own group. No OS resource is held,
// so release is a no-op.
type agentTree struct {
	// pid is the root grok pid (== the process-group id); 0 until attach.
	pid int
	// useGroup is true when kill(-pid) addresses the whole tree.
	useGroup bool
}

// configureProcessGroup puts the child in its own process group (setpgid).
//
// @param cmd A fully configured command not yet started; SysProcAttr is replaced.
// @returns The tree handle; the caller must call attach after a successful Start.
func configureProcessGroup(cmd *exec.Cmd) *agentTree {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return &agentTree{useGroup: true}
}

// attach records the started root pid. Never fails on unix (the child is not
// started suspended, so there is nothing to resume).
//
// @param proc cmd.Process right after a successful Start.
// @returns Always nil.
func (t *agentTree) attach(proc *os.Process) error {
	t.pid = proc.Pid
	return nil
}

// grouped reports whether kill(-pid) can address the whole tree.
func (t *agentTree) grouped() bool { return t.useGroup }

// signal sends SIGTERM (kill=false) or SIGKILL (kill=true) to the tree.
//
// @param kill false = graceful SIGTERM, true = SIGKILL.
func (t *agentTree) signal(kill bool) { signalAgentTree(t.pid, kill, t.useGroup) }

// alive reports whether the root grok pid still exists (zombies count until
// StdioTransport.waitClose reaps them).
func (t *agentTree) alive() bool { return stillAlive(t.pid) }

// release is a no-op on unix: the process group needs no handle.
func (t *agentTree) release() {}

// signalAgentTree sends SIGTERM (or SIGKILL when kill=true) to the process
// group, falling back to the root pid when group delivery fails or useGroup is
// false.
//
// @param pid Root pid / process-group id; <= 0 sends nothing.
// @param kill true = SIGKILL, false = SIGTERM.
// @param useGroup Whether the child was started with setpgid.
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
//
// @param pid Process id; <= 0 reports false.
func stillAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil
}
