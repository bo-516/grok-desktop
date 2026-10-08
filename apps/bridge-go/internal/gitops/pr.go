package gitops

import (
	"errors"
	"regexp"
	"strings"
)

// errGhMissing explains how to get the GitHub CLI when it is not installed.
var errGhMissing = errors.New("GitHub CLI (gh) is not installed — install it from https://cli.github.com and run `gh auth login`")

// prURLPattern finds a GitHub pull-request URL in gh output.
var prURLPattern = regexp.MustCompile(`https?://\S+/pull/\d+`)

// PRPreflight is the `git_pr_preflight` reply: everything the PR dialog needs
// to prefill fields and explain why creation is (un)available.
type PRPreflight struct {
	// GhAvailable is false when the gh executable cannot be found.
	GhAvailable bool `json:"ghAvailable"`
	// GhAuthenticated is true when `gh auth status` succeeds.
	GhAuthenticated bool `json:"ghAuthenticated"`
	// GhMessage carries gh's own explanation when it is missing or logged out.
	GhMessage string `json:"ghMessage,omitempty"`
	// Branch is the current branch; "" when detached.
	Branch string `json:"branch,omitempty"`
	// Upstream is "<remote>/<branch>" when the branch tracks a remote branch.
	Upstream string `json:"upstream,omitempty"`
	// Ahead counts commits not pushed yet (PR would miss them).
	Ahead int `json:"ahead"`
	// DefaultBase is the suggested base branch name (e.g. "main").
	DefaultBase string `json:"defaultBase,omitempty"`
	// Bases lists branch names on the remote, for the base picker.
	Bases []string `json:"bases"`
}

// PRRequest is the `git_pr_create` cli payload.
type PRRequest struct {
	// Title is required.
	Title string
	// Body may be empty.
	Body string
	// Base is the target branch; "" lets gh use the repository default.
	Base string
	// Draft opens the PR as a draft.
	Draft bool
}

// PRResult is the `git_pr_create` reply.
type PRResult struct {
	// URL is the pull request's web URL.
	URL string `json:"url"`
	// Existing is true when gh reported a PR for this branch already exists
	// (URL then points at that PR instead of a new one).
	Existing bool `json:"existing"`
}

// PreflightPR answers `git_pr_preflight`. gh problems are reported in the
// payload (not as errors) so the dialog can render them next to a disabled
// Create button; only repo-level failures are errors.
// @param cwd Absolute session workspace.
// @returns Preflight snapshot.
func PreflightPR(cwd string) (*PRPreflight, error) {
	r, err := openRepo(cwd)
	if errors.Is(err, errNotRepo) {
		return nil, errors.New("this workspace is not inside a git repository")
	}
	if err != nil {
		return nil, err
	}
	st, err := r.status()
	if err != nil {
		return nil, err
	}
	out := &PRPreflight{Branch: st.Branch, Upstream: st.Upstream, Ahead: st.Ahead, Bases: []string{}}
	upRemote := ""
	if st.Branch != "" {
		upRemote, _, _ = r.upstreamOf(st.Branch)
	}
	all, _ := r.remotes()
	if remote, err := pickRemote("", upRemote, all); err == nil {
		out.DefaultBase, _ = r.defaultBase(remote)
		if names, err := r.remoteBranches(remote); err == nil {
			out.Bases = names
		}
	}
	gh := resolveGhBin()
	if gh == "" {
		out.GhMessage = errGhMissing.Error()
		return out, nil
	}
	out.GhAvailable = true
	res, err := runExec(execSpec{bin: gh, dir: r.root, args: []string{"auth", "status"}, timeout: ghAuthTimeout})
	switch {
	case err != nil:
		out.GhMessage = err.Error()
	case res.Code != 0:
		out.GhMessage = failureDetail(res)
	default:
		out.GhAuthenticated = true
	}
	return out, nil
}

// CreatePR answers `git_pr_create` by running `gh pr create` non-interactively
// in the work-tree root. The branch must already track a remote branch (push
// first) — gh would otherwise try to prompt for a push target. When gh says a
// PR for the branch already exists, that PR's URL is returned with Existing
// set instead of an error.
// @param cwd Absolute session workspace.
// @param req Title / body / base / draft.
// @returns PR URL, or an error (gh missing, not logged in, no upstream, …).
func CreatePR(cwd string, req PRRequest) (*PRResult, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return nil, errors.New("pull request title is required")
	}
	base := strings.TrimSpace(req.Base)
	if base != "" {
		if err := validRefArg(base); err != nil {
			return nil, err
		}
	}
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
	if remote, _, err := r.upstreamOf(branch); err != nil || remote == "" {
		return nil, errors.New("push this branch before creating a pull request (it has no upstream yet)")
	}
	gh := resolveGhBin()
	if gh == "" {
		return nil, errGhMissing
	}
	res, err := runExec(execSpec{bin: gh, dir: r.root, args: buildPRCreateArgs(title, req.Body, base, req.Draft), timeout: ghTimeout})
	if err != nil {
		return nil, err
	}
	combined := string(res.Stdout) + "\n" + res.Stderr
	if res.Code != 0 {
		if url := prURLPattern.FindString(combined); url != "" && strings.Contains(strings.ToLower(combined), "already exists") {
			return &PRResult{URL: url, Existing: true}, nil
		}
		return nil, errors.New(failureDetail(res))
	}
	url := prURLPattern.FindString(string(res.Stdout))
	if url == "" {
		url = prURLPattern.FindString(combined)
	}
	if url == "" {
		return nil, errors.New("gh pr create succeeded but printed no pull request URL: " + failureDetail(res))
	}
	return &PRResult{URL: url}, nil
}

// buildPRCreateArgs renders `gh pr create` argv. Values use the `--flag=value`
// form so a title or body starting with "-" can never be read as a flag.
// @param title Non-empty title.
// @param body Body text (may be empty; gh still needs --body to stay non-interactive).
// @param base Base branch or "".
// @param draft Draft flag.
// @returns Arguments after the gh binary.
func buildPRCreateArgs(title, body, base string, draft bool) []string {
	args := []string{"pr", "create", "--title=" + title, "--body=" + body}
	if base != "" {
		args = append(args, "--base="+base)
	}
	if draft {
		args = append(args, "--draft")
	}
	return args
}
