//go:build windows

package spawn

import (
	"slices"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// treeGoneTimeout bounds how long a killed tree may take to disappear.
const treeGoneTimeout = 10 * time.Second

// watchProcess opens a SYNCHRONIZE handle to pid right away, while it is known
// to be alive, so later waits can never observe a recycled pid. The handle is
// closed at test cleanup.
//
// @param pid The process to watch; it must be alive when watchProcess is called.
// @returns gone(timeout): true once the process has exited, false on timeout.
func watchProcess(t *testing.T, pid int) func(time.Duration) bool {
	t.Helper()
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		t.Fatalf("OpenProcess(pid=%d): %v", pid, err)
	}
	t.Cleanup(func() { _ = windows.CloseHandle(h) })
	return func(timeout time.Duration) bool {
		ev, err := windows.WaitForSingleObject(h, uint32(timeout.Milliseconds()))
		return err == nil && ev == windows.WAIT_OBJECT_0
	}
}

// jobProcessIDs lists the pids currently in job via
// JOBOBJECT_BASIC_PROCESS_ID_LIST (not defined by x/sys, mirrored here with a
// fixed-capacity array large enough for the helper tree plus conhost).
//
// @param job The tree's job handle.
// @returns The pids in the job; fails the test when the query fails.
func jobProcessIDs(t *testing.T, job windows.Handle) []uint32 {
	t.Helper()
	var list struct {
		NumberOfAssignedProcesses uint32
		NumberOfProcessIdsInList  uint32
		ProcessIDList             [64]uintptr
	}
	if err := windows.QueryInformationJobObject(
		job,
		windows.JobObjectBasicProcessIdList,
		uintptr(unsafe.Pointer(&list)),
		uint32(unsafe.Sizeof(list)),
		nil,
	); err != nil {
		t.Fatalf("QueryInformationJobObject(BasicProcessIdList): %v", err)
	}
	out := make([]uint32, 0, list.NumberOfProcessIdsInList)
	for _, id := range list.ProcessIDList[:list.NumberOfProcessIdsInList] {
		out = append(out, uint32(id))
	}
	return out
}

// TestAgentTreeJobHoldsGrandchild proves the suspended start closes the race:
// the grandchild spawned by the (resumed) root is already inside the job.
func TestAgentTreeJobHoldsGrandchild(t *testing.T) {
	cmd, tree, grandchild := startTreeHelper(t)
	if !tree.grouped() {
		t.Fatal("job not attached; expected whole-tree control")
	}
	ids := jobProcessIDs(t, tree.job)
	if !slices.Contains(ids, uint32(cmd.Process.Pid)) {
		t.Errorf("root pid=%d not in job %v", cmd.Process.Pid, ids)
	}
	if !slices.Contains(ids, uint32(grandchild)) {
		t.Errorf("grandchild pid=%d not in job %v", grandchild, ids)
	}
}

// TestAgentTreeKillTerminatesGrandchild checks the hard-kill path
// (TerminateJobObject) takes down the root and its grandchild.
func TestAgentTreeKillTerminatesGrandchild(t *testing.T) {
	cmd, tree, grandchild := startTreeHelper(t)
	rootGone := watchProcess(t, cmd.Process.Pid)
	grandchildGone := watchProcess(t, grandchild)
	tree.signal(true)
	if !rootGone(treeGoneTimeout) {
		t.Fatalf("root pid=%d survived TerminateJobObject", cmd.Process.Pid)
	}
	if !grandchildGone(treeGoneTimeout) {
		t.Fatalf("grandchild pid=%d survived TerminateJobObject", grandchild)
	}
	deadline := time.Now().Add(treeGoneTimeout)
	for tree.alive() {
		if time.Now().After(deadline) {
			t.Fatal("alive() still true after the whole job exited")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestAgentTreeReleaseKillsOnJobClose checks KILL_ON_JOB_CLOSE: closing the
// only job handle (what the kernel does when the bridge dies) reaps the tree
// without any explicit terminate call.
func TestAgentTreeReleaseKillsOnJobClose(t *testing.T) {
	cmd, tree, grandchild := startTreeHelper(t)
	rootGone := watchProcess(t, cmd.Process.Pid)
	grandchildGone := watchProcess(t, grandchild)
	tree.release()
	if !rootGone(treeGoneTimeout) {
		t.Fatalf("root pid=%d survived job handle close", cmd.Process.Pid)
	}
	if !grandchildGone(treeGoneTimeout) {
		t.Fatalf("grandchild pid=%d survived job handle close", grandchild)
	}
}

// TestAgentTreeSoftSignalKeepsTree documents the Windows soft stop: with no
// SIGTERM equivalent, signal(false) sends nothing and the tree keeps running
// (the graceful request is stdin EOF from StdioTransport.Dispose).
func TestAgentTreeSoftSignalKeepsTree(t *testing.T) {
	_, tree, grandchild := startTreeHelper(t)
	grandchildGone := watchProcess(t, grandchild)
	tree.signal(false)
	if grandchildGone(500 * time.Millisecond) {
		t.Fatalf("grandchild pid=%d exited on a soft stop", grandchild)
	}
	if !tree.alive() {
		t.Fatal("alive() false while the tree is running")
	}
}
