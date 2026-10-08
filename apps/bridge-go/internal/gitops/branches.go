package gitops

import (
	"errors"
	"fmt"
	"strings"
)

// errDetachedHead is returned by operations that need a checked-out branch.
var errDetachedHead = errors.New("HEAD is detached — check out a branch first")

// currentBranch returns the checked-out branch short name.
// @returns Branch name, or errDetachedHead when HEAD is not symbolic.
func (r *repo) currentBranch() (string, error) {
	res, err := runExec(r.git(probeTimeout, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(string(res.Stdout))
	if res.Code != 0 || name == "" {
		return "", errDetachedHead
	}
	return name, nil
}

// upstreamOf reports the remote name and remote ref a branch tracks.
// @param branch Local branch short name.
// @returns (remote, remoteRef) such as ("origin", "refs/heads/feat"); both
//
//	empty when the branch has no upstream configured.
func (r *repo) upstreamOf(branch string) (string, string, error) {
	out, err := r.output(
		"for-each-ref",
		"--format=%(upstream:remotename)%00%(upstream:remoteref)",
		"refs/heads/"+branch,
	)
	if err != nil {
		return "", "", err
	}
	remote, ref, _ := strings.Cut(out, "\x00")
	return strings.TrimSpace(remote), strings.TrimSpace(ref), nil
}

// remotes lists configured remote names (`git remote`).
// @returns Names in git's order; empty when none are configured.
func (r *repo) remotes() ([]string, error) {
	out, err := r.output("remote")
	if err != nil {
		return nil, err
	}
	return strings.Fields(out), nil
}

// pickRemote chooses the remote for push / PR / default-base lookups:
// an explicit request, else the branch's upstream remote, else "origin",
// else the only remote.
// @param requested Remote named by the client; "" when not specified.
// @param upstreamRemote The branch's tracking remote; "" when none.
// @param all Configured remotes.
// @returns Remote name, or an error explaining why none can be chosen.
func pickRemote(requested, upstreamRemote string, all []string) (string, error) {
	has := func(name string) bool {
		for _, n := range all {
			if n == name {
				return true
			}
		}
		return false
	}
	switch {
	case requested != "":
		if !has(requested) {
			return "", fmt.Errorf("no such remote: %s", requested)
		}
		return requested, nil
	case upstreamRemote != "" && has(upstreamRemote):
		return upstreamRemote, nil
	case has("origin"):
		return "origin", nil
	case len(all) == 1:
		return all[0], nil
	case len(all) == 0:
		return "", errors.New("no git remote configured — add one with `git remote add origin <url>`")
	default:
		return "", fmt.Errorf("several remotes configured (%s) and none is origin; set an upstream first", strings.Join(all, ", "))
	}
}

// remoteBranches lists branch names on remote (without the "<remote>/"
// prefix and without the symbolic HEAD entry), from local remote-tracking refs.
// @param remote Remote name; "" returns nil.
// @returns Branch names sorted by git (refname order).
func (r *repo) remoteBranches(remote string) ([]string, error) {
	if remote == "" {
		return nil, nil
	}
	out, err := r.output("for-each-ref", "--format=%(refname)", "refs/remotes/"+remote+"/")
	if err != nil {
		return nil, err
	}
	prefix := "refs/remotes/" + remote + "/"
	names := []string{}
	for _, line := range strings.Split(out, "\n") {
		name := strings.TrimPrefix(strings.TrimSpace(line), prefix)
		if name == "" || name == "HEAD" || name == line {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

// localBranches lists local branch short names.
// @returns Names in refname order.
func (r *repo) localBranches() ([]string, error) {
	out, err := r.output("for-each-ref", "--format=%(refname:short)", "refs/heads/")
	if err != nil {
		return nil, err
	}
	return strings.Fields(out), nil
}

// defaultBase picks the branch a PR targets and a branch diff compares to:
// the remote's HEAD branch (`refs/remotes/<remote>/HEAD`), else main /
// master on the remote, else local main / master.
// @param remote Remote to inspect; "" skips remote lookups.
// @returns (branch, ref): the bare branch name for `gh pr create --base` and
//
//	the ref to resolve for merge-base ("origin/main" or "main"); both empty
//	when nothing suitable exists.
func (r *repo) defaultBase(remote string) (string, string) {
	if remote != "" {
		if out, err := r.output("symbolic-ref", "--quiet", "refs/remotes/"+remote+"/HEAD"); err == nil {
			if name := strings.TrimPrefix(out, "refs/remotes/"+remote+"/"); name != "" && name != out {
				return name, remote + "/" + name
			}
		}
		if names, err := r.remoteBranches(remote); err == nil {
			for _, want := range []string{"main", "master"} {
				for _, n := range names {
					if n == want {
						return n, remote + "/" + n
					}
				}
			}
		}
	}
	if names, err := r.localBranches(); err == nil {
		for _, want := range []string{"main", "master"} {
			for _, n := range names {
				if n == want {
					return n, n
				}
			}
		}
	}
	return "", ""
}

// validRefArg rejects ref arguments that git could parse as options or that
// carry whitespace / control bytes, before they reach argv.
// @param ref Client-supplied branch or ref name.
// @returns nil when the ref is safe to pass after `--end-of-options`.
func validRefArg(ref string) error {
	if ref == "" || strings.HasPrefix(ref, "-") || strings.ContainsAny(ref, " \t\r\n\x00~^:?*[\\") {
		return fmt.Errorf("invalid branch or ref name: %q", ref)
	}
	return nil
}
