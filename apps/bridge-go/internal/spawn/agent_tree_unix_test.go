//go:build !windows

package spawn

import (
	"syscall"
	"testing"
	"time"
)

// watchProcess returns a waiter reporting whether pid has disappeared within
// a timeout. Unix polls kill(pid, 0); a zombie still counts as present until
// its parent (or init, after reparenting) reaps it.
//
// @param pid The process to watch; it must be alive when watchProcess is called.
// @returns gone(timeout): true once pid no longer exists, false on timeout.
func watchProcess(t *testing.T, pid int) func(time.Duration) bool {
	t.Helper()
	return func(timeout time.Duration) bool {
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			if syscall.Kill(pid, 0) == syscall.ESRCH {
				return true
			}
			time.Sleep(20 * time.Millisecond)
		}
		return false
	}
}
