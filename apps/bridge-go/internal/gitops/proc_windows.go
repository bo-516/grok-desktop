//go:build windows

package gitops

import "os/exec"

// detachFromTerminal is a no-op on Windows: newCommand already hides the
// console (spawn.HideConsoleWindow with CREATE_NO_WINDOW), so ssh and
// credential helpers have no console to prompt on. Cancel keeps the default
// Process.Kill; WaitDelay bounds any grandchild that keeps a pipe open.
// @param cmd A command not yet started; left unchanged.
func detachFromTerminal(cmd *exec.Cmd) {
	_ = cmd
}
