package spawn

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

// treeHelperEnv selects the helper role when the test binary re-executes
// itself: "parent" spawns a "child" and prints its pid, "child" just sleeps.
const treeHelperEnv = "GROK_SPAWN_TREE_HELPER"

// treeHelperLinePrefix prefixes the line on which the helper parent reports
// its child's pid, so stray test-framework output cannot be mistaken for it.
const treeHelperLinePrefix = "grandchild="

// treeHelperSleep keeps helper processes alive far longer than any test so
// only the code under test can end them.
const treeHelperSleep = 5 * time.Minute

// TestTreeHelperProcess is not a real test. When treeHelperEnv is set the test
// binary acts as a stand-in for grok ("parent") or for an MCP server it spawned
// ("child"); in a normal run it returns immediately.
func TestTreeHelperProcess(t *testing.T) {
	switch os.Getenv(treeHelperEnv) {
	case "parent":
		child := treeHelperCommand("child")
		if err := child.Start(); err != nil {
			fmt.Fprintln(os.Stderr, "helper parent: start child:", err)
			os.Exit(2)
		}
		fmt.Printf("%s%d\n", treeHelperLinePrefix, child.Process.Pid)
		time.Sleep(treeHelperSleep)
		os.Exit(0)
	case "child":
		time.Sleep(treeHelperSleep)
		os.Exit(0)
	}
}

// treeHelperCommand builds a command that re-runs this test binary as a
// helper in the given role.
//
// @param role "parent" or "child".
// @returns An unstarted command; stdio is left for the caller to wire.
func treeHelperCommand(role string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestTreeHelperProcess$")
	cmd.Env = append(os.Environ(), treeHelperEnv+"="+role)
	return cmd
}

// startTreeHelper starts a helper parent through startAgentTree (the same path
// SpawnGrokAgent uses) and waits until it reports its grandchild's pid. The
// root is reaped in the background like StdioTransport.waitClose does; at test
// cleanup the tree is hard-killed (only while the root is unreaped, so unix
// never signals a recycled pid) and released.
//
// @returns The started command, its tree, and the grandchild pid. Fails the
// test when the helper cannot start or does not report within 30s (on Windows
// that would mean the suspended root was never resumed).
func startTreeHelper(t *testing.T) (*exec.Cmd, *agentTree, int) {
	t.Helper()
	cmd := treeHelperCommand("parent")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	tree, err := startAgentTree(cmd)
	if err != nil {
		t.Fatalf("startAgentTree: %v", err)
	}
	waited := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(waited)
	}()
	t.Cleanup(func() {
		select {
		case <-waited:
		default:
			tree.signal(true)
		}
		tree.release()
		select {
		case <-waited:
		case <-time.After(10 * time.Second):
			t.Errorf("helper parent pid=%d not reaped after cleanup", cmd.Process.Pid)
		}
	})
	pid, err := readGrandchildPid(stdout, 30*time.Second)
	if err != nil {
		t.Fatalf("helper parent pid=%d: %v", cmd.Process.Pid, err)
	}
	return cmd, tree, pid
}

// readGrandchildPid scans the helper parent's stdout for the pid line.
//
// @param r The parent's stdout pipe.
// @param timeout How long to wait for the line.
// @returns The grandchild pid, or an error on timeout / EOF / bad line.
func readGrandchildPid(r io.Reader, timeout time.Duration) (int, error) {
	type result struct {
		pid int
		err error
	}
	ch := make(chan result, 1)
	go func() {
		sc := bufio.NewScanner(r)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if !strings.HasPrefix(line, treeHelperLinePrefix) {
				continue
			}
			pid, err := strconv.Atoi(strings.TrimPrefix(line, treeHelperLinePrefix))
			ch <- result{pid: pid, err: err}
			return
		}
		ch <- result{err: fmt.Errorf("stdout closed before pid line (scan err: %v)", sc.Err())}
	}()
	select {
	case res := <-ch:
		return res.pid, res.err
	case <-time.After(timeout):
		return 0, fmt.Errorf("no pid line within %s", timeout)
	}
}

// TestProcessDisposeReapsAgentTree checks the full Dispose path on the current
// platform: soft stop, grace, hard kill, release must leave no grandchild
// behind (unix: process group; Windows: Job Object).
func TestProcessDisposeReapsAgentTree(t *testing.T) {
	cmd, tree, grandchild := startTreeHelper(t)
	if !tree.grouped() {
		t.Fatal("tree is not grouped; expected whole-tree control")
	}
	gone := watchProcess(t, grandchild)
	p := &Process{Cmd: cmd, UseGroup: tree.grouped(), tree: tree}
	p.Dispose()
	if !gone(DisposeKillGrace + 10*time.Second) {
		t.Fatalf("grandchild pid=%d survived Dispose", grandchild)
	}
}
