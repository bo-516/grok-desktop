//go:build windows

package spawn

import (
	"errors"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// jobExitCode is the exit code TerminateJobObject stamps on every process it
// kills. It matches os.Process.Kill (TerminateProcess with 1) so callers that
// inspect the root's exit code see the same value whichever path killed it.
const jobExitCode = 1

// jobBasicAccounting mirrors JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, which
// golang.org/x/sys/windows does not define. Only ActiveProcesses is read; the
// other fields exist so the struct has the exact size and layout the kernel
// writes into.
type jobBasicAccounting struct {
	// TotalUserTime is the user-mode CPU time of all processes ever in the job (100ns ticks).
	TotalUserTime int64
	// TotalKernelTime is the kernel-mode CPU time of all processes ever in the job (100ns ticks).
	TotalKernelTime int64
	// ThisPeriodTotalUserTime is user-mode CPU time since the last time limit was set.
	ThisPeriodTotalUserTime int64
	// ThisPeriodTotalKernelTime is kernel-mode CPU time since the last time limit was set.
	ThisPeriodTotalKernelTime int64
	// TotalPageFaultCount is the page-fault count of all processes ever in the job.
	TotalPageFaultCount uint32
	// TotalProcesses counts every process ever associated with the job.
	TotalProcesses uint32
	// ActiveProcesses counts processes currently alive in the job (and its child jobs).
	ActiveProcesses uint32
	// TotalTerminatedProcesses counts processes killed by a job limit violation.
	TotalTerminatedProcesses uint32
}

// newKillOnCloseJob creates an anonymous Job Object configured with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: when the last handle to it closes, every
// process still in the job (and in any job nested under it) is terminated.
//
// The handle is not inheritable, so children never hold a reference to the
// job; the bridge's handle is the only one. That is what makes the job die
// with the bridge even when the bridge itself is killed (TerminateProcess from
// the shell, a crash): the kernel closes the handle and reaps the tree.
//
// @returns The job handle, owned by the caller (close it exactly once).
// On error no handle is leaked; callers fall back to root-only kill.
func newKillOnCloseJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("CreateJobObject: %w", err)
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
		return 0, fmt.Errorf("SetInformationJobObject(KILL_ON_JOB_CLOSE): %w", err)
	}
	return job, nil
}

// jobActiveProcesses reports how many processes are currently running inside
// job, including processes in nested child jobs.
//
// @param job An open job handle with JOB_OBJECT_QUERY access (ours has all access).
// @returns The live process count; an error when the query fails, in which
// case the caller should assume the tree may still be alive.
func jobActiveProcesses(job windows.Handle) (uint32, error) {
	var info jobBasicAccounting
	if err := windows.QueryInformationJobObject(
		job,
		windows.JobObjectBasicAccountingInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
		nil,
	); err != nil {
		return 0, fmt.Errorf("QueryInformationJobObject(BasicAccounting): %w", err)
	}
	return info.ActiveProcesses, nil
}

// resumeProcess resumes the threads of a process that was created with
// CREATE_SUSPENDED. os/exec closes the primary-thread handle CreateProcess
// returns, so the thread is found again through a Toolhelp thread snapshot.
//
// A freshly created suspended process owns exactly one thread. Every thread
// owned by pid is resumed anyway: ResumeThread on a thread whose suspend count
// is already 0 is a no-op, so this is safe even if something else injected a
// thread in the meantime.
//
// pid must identify a process the caller still holds a handle to (os.Process
// does until Wait), otherwise it could have been recycled.
//
// @param pid Process id of the suspended child.
// @returns nil once at least one thread was resumed. An error means the child
// may still be frozen; the caller must kill it rather than hand it out, or
// the session would hang forever waiting on a process that never runs.
func resumeProcess(pid int) error {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer func() { _ = windows.CloseHandle(snap) }()

	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	resumed := 0
	for err = windows.Thread32First(snap, &entry); err == nil; err = windows.Thread32Next(snap, &entry) {
		if entry.OwnerProcessID != uint32(pid) {
			continue
		}
		thread, openErr := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
		if openErr != nil {
			return fmt.Errorf("OpenThread(tid=%d): %w", entry.ThreadID, openErr)
		}
		_, resumeErr := windows.ResumeThread(thread)
		_ = windows.CloseHandle(thread)
		if resumeErr != nil {
			return fmt.Errorf("ResumeThread(tid=%d): %w", entry.ThreadID, resumeErr)
		}
		resumed++
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return fmt.Errorf("Thread32Next: %w", err)
	}
	if resumed == 0 {
		return fmt.Errorf("no threads found for pid %d", pid)
	}
	return nil
}
