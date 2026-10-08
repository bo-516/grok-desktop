//go:build windows

package spawn

import (
	"fmt"
	"sync"

	"golang.org/x/sys/windows"
)

// CreateSuspended is the CreationFlags bit a caller sets before starting a
// process it will hand to TreeJob.AdoptSuspended, so the child cannot spawn a
// grandchild outside the job before it is assigned.
const CreateSuspended = windows.CREATE_SUSPENDED

// TreeJob is an exported kill-on-close Job Object for process trees that are
// not started through os/exec — notably ConPTY shells for user terminals,
// which need CreateProcess with a pseudo-console attribute that exec.Cmd
// cannot express (see internal/userterm). It reuses the same job helpers as
// the agent tree (newKillOnCloseJob / resumeProcess).
//
// Lifetime: NewTreeJob before start, AdoptSuspended after start, Terminate to
// kill the tree, Close exactly once (closing kills whatever is left).
type TreeJob struct {
	// mu serializes handle use against Close so a closed handle value is never reused.
	mu sync.Mutex
	// job is the kill-on-close job handle; 0 after Close or when adoption failed.
	job windows.Handle
}

// NewTreeJob creates an empty kill-on-close job.
//
// @returns The job, or an error when the Job Object could not be created (the
// caller should then start the process normally and fall back to root kill).
func NewTreeJob() (*TreeJob, error) {
	job, err := newKillOnCloseJob()
	if err != nil {
		return nil, err
	}
	return &TreeJob{job: job}, nil
}

// AdoptSuspended assigns a process started with CreateSuspended to the job and
// resumes it.
//
// An assignment failure is logged and degrades to root-only kill (the job is
// closed; Terminate then reports false) — it never fails the spawn. Only a
// failed resume is returned, because the child would otherwise stay frozen.
//
// @param pid Pid of the suspended child; the caller still holds its handle
// (os.Process), so the pid cannot have been recycled.
// @returns nil when the child is running; an error when it could not be
// resumed and must be killed by the caller.
func (j *TreeJob) AdoptSuspended(pid int) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	root, err := windows.OpenProcess(rootProcessAccess, false, uint32(pid))
	if err != nil {
		logTreeFallback("open terminal shell process", err)
		j.closeLocked()
	} else {
		if err := windows.AssignProcessToJobObject(j.job, root); err != nil {
			logTreeFallback("assign terminal shell to job object", err)
			j.closeLocked()
		}
		_ = windows.CloseHandle(root)
	}
	if err := resumeProcess(pid); err != nil {
		return fmt.Errorf("resume suspended terminal shell (pid=%d): %w", pid, err)
	}
	return nil
}

// Terminate kills every process in the job.
//
// @returns true when the job existed and TerminateJobObject succeeded; false
// means the caller should kill the root process itself.
func (j *TreeJob) Terminate() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.job == 0 {
		return false
	}
	return windows.TerminateJobObject(j.job, jobExitCode) == nil
}

// Close releases the job handle; KILL_ON_JOB_CLOSE terminates anything still
// inside. Idempotent.
func (j *TreeJob) Close() {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.closeLocked()
}

// closeLocked closes the job handle; j.mu must be held.
func (j *TreeJob) closeLocked() {
	if j.job != 0 {
		_ = windows.CloseHandle(j.job)
		j.job = 0
	}
}
