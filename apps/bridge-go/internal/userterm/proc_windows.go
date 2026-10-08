//go:build windows

package userterm

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"

	pty "github.com/aymanbagabas/go-pty"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// defaultShell resolves the user's interactive shell on Windows.
//
// @returns Shell path and args; see resolveWindowsShell.
func defaultShell() (string, []string) {
	exists := func(p string) bool {
		_, err := os.Stat(p)
		return err == nil
	}
	return resolveWindowsShell(exec.LookPath, exists, os.Getenv("SystemRoot"), os.Getenv("COMSPEC"))
}

// procTree addresses the processes behind one Windows user terminal: a
// kill-on-close Job Object (spawn.TreeJob) holding the ConPTY shell and
// everything it launches, so closing a tab also stops `npm run dev` & co.
// Without a job it degrades to killing the shell only.
type procTree struct {
	// job is nil when the Job Object could not be created.
	job *spawn.TreeJob
	// proc is the started shell; its Kill is the root-only fallback.
	proc *os.Process
}

// prepareTree creates the job and asks go-pty to start the shell suspended so
// it cannot escape the job before attach assigns it.
//
// @param cmd The shell command, not yet started; SysProcAttr is created or extended.
// @param _ The PTY (unused on Windows).
// @returns The tree handle; call attach after a successful Start and release in every case.
func prepareTree(cmd *pty.Cmd, _ pty.Pty) *procTree {
	job, err := spawn.NewTreeJob()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[bridge] terminal: job object unavailable, root-only kill: %v\n", err)
		return &procTree{}
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= spawn.CreateSuspended
	return &procTree{job: job}
}

// attach binds the started shell: assigns it to the job and resumes it.
//
// @param proc cmd.Process right after a successful Start.
// @returns An error only when the suspended shell could not be resumed.
func (t *procTree) attach(proc *os.Process) error {
	t.proc = proc
	if t.job == nil {
		return nil
	}
	return t.job.AdoptSuspended(proc.Pid)
}

// stop ends the terminal's processes. Windows has no SIGHUP, so this is the
// hard kill: closing the pseudo console alone only sends CTRL_CLOSE_EVENT to
// console clients and leaves GUI / detached children running.
func (t *procTree) stop() { t.kill() }

// kill terminates the whole job, or the shell alone without a job.
func (t *procTree) kill() {
	if t.job != nil && t.job.Terminate() {
		return
	}
	if t.proc != nil {
		_ = t.proc.Kill()
	}
}

// release closes the job (killing anything left inside). Idempotent.
func (t *procTree) release() {
	if t.job != nil {
		t.job.Close()
	}
}
