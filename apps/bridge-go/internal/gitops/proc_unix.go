//go:build !windows

package gitops

import (
	"os"
	"os/exec"
	"syscall"
)

// detachFromTerminal starts cmd in a new session (setsid). Without a
// controlling terminal, ssh and credential helpers cannot open /dev/tty to
// ask for a passphrase or host-key confirmation even when the bridge itself
// was launched from a shell, so they fail fast instead of hanging until the
// timeout. Setsid also makes the child a process-group leader, so Cancel can
// kill the whole tree (git → ssh / hooks) with one signal.
// @param cmd A command not yet started; SysProcAttr and Cancel are replaced.
func detachFromTerminal(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		// Negative pid addresses the process group created by Setsid.
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
			if err == syscall.ESRCH {
				return os.ErrProcessDone
			}
			return cmd.Process.Kill()
		}
		return nil
	}
}
