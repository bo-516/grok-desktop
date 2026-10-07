package spawn

import "os/exec"

// startAgentTree starts cmd as the root of an agent tree that can later be
// stopped as a unit: grok plus every MCP server and tool subprocess it spawns.
//
// The platform half lives in agentTree (process_unix.go / process_windows.go),
// which both platforms implement with the same methods:
//   - configureProcessGroup(cmd): before Start (unix setpgid; Windows
//     kill-on-close job + CREATE_SUSPENDED).
//   - attach(proc): after Start (Windows: assign to the job, then resume).
//   - grouped(): whether the whole tree is addressable (Process.UseGroup).
//   - signal(kill): soft stop / hard kill of the tree.
//   - alive(): whether the tree may still be running.
//   - release(): drop OS resources (Windows: close the job, killing leftovers).
//
// @param cmd Fully configured (path, args, env, pipes), not yet started; its
// SysProcAttr is replaced.
// @returns The tree bound to the running child; the caller owns it and must
// eventually call release (Process.Dispose does). On error nothing is left
// running: a Start failure leaves no child, and an attach failure (Windows: the
// suspended child could not be resumed) kills the child, reaps it in the
// background, and releases the tree.
func startAgentTree(cmd *exec.Cmd) (*agentTree, error) {
	tree := configureProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		tree.release()
		return nil, err
	}
	if err := tree.attach(cmd.Process); err != nil {
		_ = cmd.Process.Kill()
		tree.release()
		// Wait closes our pipe ends; the killed child exits promptly.
		go func() { _ = cmd.Wait() }()
		return nil, err
	}
	return tree, nil
}
