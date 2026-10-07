//go:build windows

package spawn

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"golang.org/x/sys/windows"
)

// createNoWindow is CREATE_NO_WINDOW: give a console child no console window.
// The stdlib syscall package does not export it.
const createNoWindow = windows.CREATE_NO_WINDOW

// rootProcessAccess is the access the tree needs on the root grok process:
// SET_QUOTA + TERMINATE are required by AssignProcessToJobObject, SYNCHRONIZE
// lets alive() poll it without a job.
const rootProcessAccess = windows.PROCESS_SET_QUOTA | windows.PROCESS_TERMINATE | windows.SYNCHRONIZE

// HideConsoleWindow stops Windows from showing a console for cmd. The desktop
// shell is a GUI process, so every console child the bridge reaches — the agent,
// one-shot grok calls, git probes — would otherwise flash or park a black window
// beside the app. No-op on other platforms.
//
// @param cmd A command not yet started; its SysProcAttr is created when nil and
// otherwise extended (existing CreationFlags are preserved).
func HideConsoleWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}

// agentTree is the Windows handle for one grok agent tree: a kill-on-close
// Job Object that grok, its MCP servers and every tool subprocess end up in.
//
// Lifetime: configureProcessGroup creates the job before Start, attach binds
// the started child, release closes the job. Because the bridge holds the only
// handle, the tree also dies when the bridge exits for any reason.
//
// Scope: only the long-lived agent tree uses a job. One-shot RunGrokCli calls
// are bounded by their timeout and may launch a browser (auth login) that must
// outlive them; reverse terminals keep their root-only kill, same as unix, so
// a server an agent command backgrounds is not torn down on terminal/release.
// Under the desktop shell both still die on app quit through the shell's job
// around the bridge (apps/shell/proc_windows.go).
//
// When the job cannot be created or assigned the tree degrades to root-only
// kill (the pre-job behavior) and grouped() reports false; spawning never fails
// because of the job.
type agentTree struct {
	// mu serializes handle use against release so a closed (and possibly
	// recycled) handle value is never passed to a Win32 call.
	mu sync.Mutex
	// job is the kill-on-close Job Object; 0 when unavailable (root-only fallback)
	// or after release.
	job windows.Handle
	// root is our own handle to the root grok process (rootProcessAccess). It
	// pins the pid so alive() can never probe a recycled one; 0 when OpenProcess
	// failed or after release.
	root windows.Handle
	// suspended is true when the child was created with CREATE_SUSPENDED and
	// attach must resume it (only when a job was created up front).
	suspended bool
	// proc is the started root process; its Kill is the fallback when there is
	// no job (handle-based, so it never hits a recycled pid even after Wait).
	proc *os.Process
}

// configureProcessGroup prepares cmd so the agent tree can be killed as a unit.
//
// It sets CREATE_NEW_PROCESS_GROUP and hides the console (HideConsoleWindow),
// creates a kill-on-close job, and adds CREATE_SUSPENDED so the child cannot
// run — and so cannot spawn a grandchild outside the job — until attach has
// assigned it. Without a job the child is started normally.
//
// @param cmd A fully configured command not yet started; SysProcAttr is replaced.
// @returns The tree handle; the caller must call attach after a successful
// Start, and release in every case (including a failed Start) to close the job.
func configureProcessGroup(cmd *exec.Cmd) *agentTree {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	HideConsoleWindow(cmd)
	job, err := newKillOnCloseJob()
	if err != nil {
		logTreeFallback("create job object", err)
		return &agentTree{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	return &agentTree{job: job, suspended: true}
}

// attach binds the started root process: assigns it to the job while it is
// still suspended, then resumes it.
//
// An assignment failure (e.g. a restrictive parent job) is logged and the tree
// falls back to root-only kill — it never fails the spawn. Since Windows 8 a
// process already in a job (the bridge launched inside one) can join a nested
// job, so that case is normally fine.
//
// @param proc cmd.Process right after a successful Start.
// @returns nil when the child is running. An error only when the suspended
// child could not be resumed: the caller must kill and release it.
func (t *agentTree) attach(proc *os.Process) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.proc = proc
	// os.Process holds its own handle until Wait, so pid cannot be recycled yet.
	root, err := windows.OpenProcess(rootProcessAccess, false, uint32(proc.Pid))
	if err != nil {
		logTreeFallback("open grok process", err)
	} else {
		t.root = root
	}
	if t.job != 0 {
		assignErr := fmt.Errorf("no process handle")
		if t.root != 0 {
			assignErr = windows.AssignProcessToJobObject(t.job, t.root)
		}
		if assignErr != nil {
			logTreeFallback("assign grok to job object", assignErr)
			_ = windows.CloseHandle(t.job)
			t.job = 0
		}
	}
	if !t.suspended {
		return nil
	}
	if err := resumeProcess(proc.Pid); err != nil {
		return fmt.Errorf("resume suspended grok (pid=%d): %w", proc.Pid, err)
	}
	return nil
}

// grouped reports whether the whole tree is addressable (a job is attached).
// false means only the root grok process can be killed.
func (t *agentTree) grouped() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.job != 0
}

// signal stops the tree. Windows has no SIGTERM, so the soft stop (kill=false)
// sends nothing: the graceful request is the stdin EOF that
// StdioTransport.Dispose delivers right after Process.Dispose runs, on which an
// ACP stdio agent exits (closing its MCP servers' stdio in turn).
//
// kill=true terminates every process in the job (TerminateJobObject); without
// a job, or if that call fails, it kills the root only. Safe after the tree is
// gone: terminating an empty job and killing a reaped os.Process are no-ops.
//
// @param kill false = soft stop (no-op here), true = hard kill of the tree.
func (t *agentTree) signal(kill bool) {
	if !kill {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job != 0 {
		if err := windows.TerminateJobObject(t.job, jobExitCode); err == nil {
			return
		}
	}
	if t.proc != nil {
		_ = t.proc.Kill()
	}
}

// alive reports whether anything of the tree may still be running.
//
// With a job it counts live processes in the job, so it stays true while an
// orphaned MCP server outlives grok (unix only checks the root). Without a job
// it polls our root handle. Any query failure answers true so the follow-up
// kill still runs; a false "alive" is harmless because signal(true) is a no-op
// on a finished tree.
func (t *agentTree) alive() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job != 0 {
		n, err := jobActiveProcesses(t.job)
		return err != nil || n > 0
	}
	if t.root != 0 {
		ev, err := windows.WaitForSingleObject(t.root, 0)
		return err != nil || ev == uint32(windows.WAIT_TIMEOUT)
	}
	return t.proc != nil
}

// release closes the job and root handles. Closing the job's last handle
// triggers KILL_ON_JOB_CLOSE, so anything still in the job is terminated
// here as well. Idempotent; signal/alive after release fall back to the
// root-only os.Process path.
func (t *agentTree) release() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job != 0 {
		_ = windows.CloseHandle(t.job)
		t.job = 0
	}
	if t.root != 0 {
		_ = windows.CloseHandle(t.root)
		t.root = 0
	}
}

// logTreeFallback records that the agent tree degraded to root-only kill.
// Written to stderr (the bridge log) and never returned as an error: a missing
// job only weakens cleanup, it must not block a session from starting.
//
// @param step Short description of the Win32 step that failed.
// @param err The underlying error.
func logTreeFallback(step string, err error) {
	fmt.Fprintf(os.Stderr, "[bridge] spawn: %s failed, agent tree falls back to root-only kill: %v\n", step, err)
}
