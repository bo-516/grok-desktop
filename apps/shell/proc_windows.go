//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// bridgeExitCode is the exit code TerminateJobObject stamps on the bridge
// tree; it matches os.Process.Kill (TerminateProcess with 1).
const bridgeExitCode = 1

// bridgeTree is the Windows handle for the bridge's process tree: a
// kill-on-close Job Object holding bridge-go and everything it spawns (agent
// trees in their own nested jobs, reverse terminals, one-shot grok calls).
// It is the Windows counterpart of the Unix process group, and because the
// shell holds the only handle, the tree also dies if the shell crashes.
//
// job is 0 when the job could not be created or assigned; Stop then kills the
// bridge pid only (the pre-job behavior). Launching never fails because of it.
type bridgeTree struct {
	// mu serializes handle use against release.
	mu sync.Mutex
	// job is the kill-on-close Job Object; 0 when unavailable or released.
	job windows.Handle
}

// configureBridgeProcAttr keeps the bridge child's console off-screen and
// prepares a kill-on-close job for it. The shell links with -H windowsgui and
// owns no console, so spawning a console binary would otherwise park a black
// window next to the app window.
//
// @param cmd The bridge command, not yet started; SysProcAttr is replaced.
// @returns The tree handle; call attach after a successful Start and release
// in every case (stopBridgeProcess does after a Start).
func configureBridgeProcAttr(cmd *exec.Cmd) *bridgeTree {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
	job, err := newBridgeJob()
	if err != nil {
		log.Printf("[shell] bridge job object unavailable, stop kills the bridge pid only: %v", err)
		return &bridgeTree{}
	}
	return &bridgeTree{job: job}
}

// attach assigns the started bridge to the job.
//
// The bridge is not started suspended: it spawns nothing until a WebSocket
// client authenticates with the per-start token, and the UI only receives that
// token after StartBridge returns — which is after this call. So no grandchild
// can be created outside the job. An assignment failure is logged and Stop
// falls back to killing the bridge pid.
//
// @param proc cmd.Process right after a successful Start.
func (t *bridgeTree) attach(proc *os.Process) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job == 0 {
		return
	}
	// os.Process holds its own handle until Wait, so pid cannot be recycled yet.
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(proc.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(t.job, h)
		_ = windows.CloseHandle(h)
	}
	if err != nil {
		log.Printf("[shell] assign bridge pid=%d to job object failed, stop kills the bridge pid only: %v", proc.Pid, err)
		_ = windows.CloseHandle(t.job)
		t.job = 0
	}
}

// terminate kills every process in the job (bridge, agents, terminals).
//
// @returns true when the job was terminated; false when there is no job or
// the call failed, so the caller should kill the bridge pid itself.
func (t *bridgeTree) terminate() bool {
	if t == nil {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job == 0 {
		return false
	}
	return windows.TerminateJobObject(t.job, bridgeExitCode) == nil
}

// release closes the job handle; KILL_ON_JOB_CLOSE reaps anything still in
// the job. Idempotent and nil-safe.
func (t *bridgeTree) release() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job != 0 {
		_ = windows.CloseHandle(t.job)
		t.job = 0
	}
}

// newBridgeJob creates an anonymous, non-inheritable Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
//
// @returns The job handle (caller closes it), or an error with nothing leaked.
func newBridgeJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

// processAlive is best-effort on Windows; always true so WaitUntilListening
// falls back to its dial timeout instead of a PID probe.
func processAlive(pid int) bool {
	return pid > 0
}

// stopBridgeProcess terminates the bridge and its whole tree via the job
// (TerminateJobObject), or the bridge pid alone without a job, waits up to
// grace for the bridge to exit, then closes the job handle. Windows has no
// SIGTERM, so unlike Unix there is no graceful phase: the bridge was already
// hard-killed before the job existed; the job only adds its descendants.
//
// @param cmd The started bridge command; nil / unstarted is a no-op.
// @param tree The job from configureBridgeProcAttr; nil kills the pid only.
// @param grace How long to wait for the bridge to exit before logging.
func stopBridgeProcess(cmd *exec.Cmd, tree *bridgeTree, grace time.Duration) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if !tree.terminate() {
		_ = cmd.Process.Kill()
	}
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
	tree.release()
}
