//go:build !windows

package userterm

import (
	"os"
	"runtime"
	"strconv"
	"syscall"

	pty "github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/unix"
)

// defaultShell resolves the user's interactive shell on unix.
//
// @returns Shell path and args (login shell); see resolveUnixShell.
func defaultShell() (string, []string) {
	passwd := ""
	if raw, err := os.ReadFile("/etc/passwd"); err == nil {
		passwd = passwdShellFor(string(raw), strconv.Itoa(os.Getuid()))
	}
	return resolveUnixShell(os.Getenv("SHELL"), passwd, runtime.GOOS, isExecutableFile)
}

// isExecutableFile reports whether path is a regular file with any execute bit.
//
// @param path Absolute candidate path.
// @returns false for missing files, directories and non-executables.
func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}

// procTree addresses the processes behind one unix user terminal.
//
// go-pty starts the shell with Setsid + Setctty, so the shell is a session
// leader whose pid is also its process-group id. Job-control shells move
// foreground jobs into their own groups, so hangup also signals the PTY's
// current foreground group (tcgetpgrp on the master) — what the kernel does on
// a real terminal hangup. Closing the master alone is not enough on darwin:
// creack/pty opens it in blocking mode, so Close is deferred while the reader
// goroutine sits in read(2) and the slave never sees the hangup.
type procTree struct {
	// pid is the shell pid (== its process-group id); 0 until attach.
	pid int
	// master is the PTY master, used to look up the foreground process group.
	master *os.File
}

// prepareTree configures cmd before Start. Nothing to add on unix: go-pty
// already requests a new session with the PTY as controlling terminal.
//
// @param cmd The shell command, not yet started.
// @param p The PTY it will attach to (its master is kept for tcgetpgrp).
// @returns The tree handle; call attach after a successful Start.
func prepareTree(cmd *pty.Cmd, p pty.Pty) *procTree {
	t := &procTree{}
	if u, ok := p.(pty.UnixPty); ok {
		t.master = u.Master()
	}
	return t
}

// attach records the started shell.
//
// @param proc cmd.Process right after a successful Start.
// @returns Always nil on unix (nothing to resume).
func (t *procTree) attach(proc *os.Process) error {
	t.pid = proc.Pid
	return nil
}

// stop asks the terminal's processes to exit: SIGHUP to the shell's group and
// to the foreground job group, like closing a terminal window.
func (t *procTree) stop() { t.signal(syscall.SIGHUP) }

// kill force-kills the shell's group and the foreground job group (SIGKILL).
func (t *procTree) kill() { t.signal(syscall.SIGKILL) }

// release frees OS resources; unix holds none.
func (t *procTree) release() {}

// signal delivers sig to the shell's process group (falling back to the pid)
// and to the PTY foreground process group when it differs.
//
// @param sig Signal to send; no-op before attach.
func (t *procTree) signal(sig syscall.Signal) {
	if t.pid <= 0 {
		return
	}
	if err := syscall.Kill(-t.pid, sig); err != nil {
		_ = syscall.Kill(t.pid, sig)
	}
	if fg := t.foregroundGroup(); fg > 0 && fg != t.pid {
		_ = syscall.Kill(-fg, sig)
	}
}

// foregroundGroup returns the PTY's foreground process group id.
//
// @returns The pgid, or 0 when the master is unavailable/closed or the ioctl fails.
func (t *procTree) foregroundGroup() int {
	if t.master == nil {
		return 0
	}
	conn, err := t.master.SyscallConn()
	if err != nil {
		return 0
	}
	pgid := 0
	_ = conn.Control(func(fd uintptr) {
		if v, e := unix.IoctlGetInt(int(fd), unix.TIOCGPGRP); e == nil {
			pgid = v
		}
	})
	return pgid
}
