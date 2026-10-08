package gitops

import (
	"errors"
	"strings"
)

// PushRequest is the `git_push` cli payload.
type PushRequest struct {
	// Remote optionally names the remote; "" uses the upstream remote,
	// then origin, then the only remote.
	Remote string
}

// PushResult is the `git_push` reply.
type PushResult struct {
	// Remote is the remote pushed to.
	Remote string `json:"remote"`
	// Branch is the local (and remote) branch name.
	Branch string `json:"branch"`
	// Upstream is "<remote>/<branch>" after the push.
	Upstream string `json:"upstream"`
	// SetUpstream is true when this push configured the tracking branch.
	SetUpstream bool `json:"setUpstream"`
	// Output is git's own push report (stderr), trimmed.
	Output string `json:"output,omitempty"`
}

// Push answers the `git_push` cli command: push the current branch to the
// same-named branch on its remote. The first push of a branch (or a branch
// tracking a differently named ref, e.g. created from origin/main) runs with
// --set-upstream so later pushes and `gh pr create` find it; a push never
// targets a branch with another name. Credentials come only from configured
// helpers / ssh agents — prompts are disabled — and auth or rejection errors
// are returned verbatim.
// @param cwd Absolute session workspace.
// @param req Optional remote.
// @returns What was pushed, or an error (detached HEAD, no remote, rejected, …).
func Push(cwd string, req PushRequest) (*PushResult, error) {
	r, err := openRepo(cwd)
	if errors.Is(err, errNotRepo) {
		return nil, errors.New("this workspace is not inside a git repository")
	}
	if err != nil {
		return nil, err
	}
	branch, err := r.currentBranch()
	if err != nil {
		return nil, err
	}
	upRemote, upRef, err := r.upstreamOf(branch)
	if err != nil {
		return nil, err
	}
	all, err := r.remotes()
	if err != nil {
		return nil, err
	}
	remote, err := pickRemote(strings.TrimSpace(req.Remote), upRemote, all)
	if err != nil {
		return nil, err
	}
	setUpstream := upRemote != remote || upRef != "refs/heads/"+branch
	args := []string{"push"}
	if setUpstream {
		args = append(args, "--set-upstream")
	}
	args = append(args, remote, "refs/heads/"+branch+":refs/heads/"+branch)
	res, err := runExec(r.git(pushTimeout, args...))
	if err != nil {
		return nil, err
	}
	if res.Code != 0 {
		return nil, errors.New(failureDetail(res))
	}
	return &PushResult{
		Remote:      remote,
		Branch:      branch,
		Upstream:    remote + "/" + branch,
		SetUpstream: setUpstream,
		Output:      strings.TrimSpace(res.Stderr),
	}, nil
}
