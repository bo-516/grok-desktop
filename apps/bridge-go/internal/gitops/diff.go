package gitops

import (
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// Diff size defaults. A patch carries full-file context, so the per-file cap
// is roughly "largest file shown inline"; the total keeps one WebSocket frame
// reasonable. Callers may lower (not raise past the hard limits) both.
const (
	defaultMaxPatchFileBytes  = 1 << 20
	defaultMaxPatchTotalBytes = 8 << 20
	hardMaxPatchFileBytes     = 4 << 20
	hardMaxPatchTotalBytes    = 32 << 20
	// maxUntrackedFiles caps untracked files folded into one diff.
	maxUntrackedFiles = 2000
	// fullContextLines is passed as -U so every hunk spans the whole file:
	// the desktop rebuilds exact old/new texts from the patch (git's clean /
	// CRLF filters already applied) and can expand every collapsed gap.
	fullContextLines = 1_000_000
)

// Diff modes accepted by DiffRequest.Mode.
const (
	// DiffModeHead compares the working tree (incl. untracked) with HEAD.
	DiffModeHead = "head"
	// DiffModeMergeBase compares the working tree with merge-base(HEAD, base).
	DiffModeMergeBase = "merge-base"
)

// DiffRequest is the `git_diff` cli payload.
type DiffRequest struct {
	// Mode is DiffModeHead (default) or DiffModeMergeBase.
	Mode string
	// Base is the ref for merge-base mode; "" picks the default base branch.
	Base string
	// Paths optionally limits the diff (pass both sides of a rename).
	Paths []string
	// MaxFileBytes overrides the per-file patch cap (0 = default).
	MaxFileBytes int
	// MaxTotalBytes overrides the aggregate patch budget (0 = default).
	MaxTotalBytes int
}

// DiffResult is the `git_diff` reply.
type DiffResult struct {
	// IsRepo is false outside a work tree; every other field is then zero.
	IsRepo bool `json:"isRepo"`
	// Root is the absolute work-tree root the paths are relative to.
	Root string `json:"root,omitempty"`
	// Mode echoes the effective mode.
	Mode string `json:"mode"`
	// Base is "HEAD" or the base ref compared against (e.g. "origin/main").
	Base string `json:"base,omitempty"`
	// BaseCommit is the resolved commit (or the empty tree before the first commit).
	BaseCommit string `json:"baseCommit,omitempty"`
	// Files lists every changed path in git order.
	Files []DiffFile `json:"files"`
	// Added / Removed are line totals across text files.
	Added   int `json:"added"`
	Removed int `json:"removed"`
	// Truncated is true when untracked files were capped.
	Truncated bool `json:"truncated"`
}

// ReadDiff answers the `git_diff` cli command: working tree (tracked and
// untracked, never ignored) against HEAD or against the merge-base with a
// base branch, as per-file unified patches with size caps, binary detection
// and rename detection.
//
// Untracked files are folded in through a throwaway index (a copy of the real
// one plus `git add --intent-to-add`), so the user's staging area is never
// touched while git still produces real "new file" patches for them.
// @param cwd Absolute session workspace.
// @param req Mode / base / path filter / caps.
// @returns Diff, `{isRepo:false}` outside a repo, or an error.
func ReadDiff(cwd string, req DiffRequest) (*DiffResult, error) {
	r, err := openRepo(cwd)
	if errors.Is(err, errNotRepo) {
		return &DiffResult{IsRepo: false, Mode: DiffModeHead, Files: []DiffFile{}}, nil
	}
	if err != nil {
		return nil, err
	}
	mode := req.Mode
	if mode == "" {
		mode = DiffModeHead
	}
	if mode != DiffModeHead && mode != DiffModeMergeBase {
		return nil, fmt.Errorf("unknown diff mode: %s", mode)
	}
	paths, err := cleanRepoPaths(r.root, req.Paths)
	if err != nil {
		return nil, err
	}
	label, commit, err := r.resolveDiffBase(mode, req.Base)
	if err != nil {
		return nil, err
	}
	untracked, truncated, err := r.untrackedFiles(paths)
	if err != nil {
		return nil, err
	}
	out := &DiffResult{IsRepo: true, Root: r.root, Mode: mode, Base: label, BaseCommit: commit, Truncated: truncated}
	err = r.withIntentIndex(untracked, func(env []string) error {
		files, err := r.diffFiles(commit, paths, env)
		if err != nil {
			return err
		}
		if err := r.attachDiffPatches(files, commit, paths, env, req); err != nil {
			return err
		}
		markUntracked(files, untracked)
		out.Files = files
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, f := range out.Files {
		out.Added += f.Added
		out.Removed += f.Removed
	}
	return out, nil
}

// cleanRepoPaths validates every path with cleanRepoPath.
// @param root Work-tree root.
// @param paths Client paths; nil / empty means "no filter".
// @returns Repo-relative paths, or the first validation error.
func cleanRepoPaths(root string, paths []string) ([]string, error) {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		clean, err := cleanRepoPath(root, p)
		if err != nil {
			return nil, err
		}
		out = append(out, clean)
	}
	return out, nil
}

// resolveDiffBase resolves the commit the working tree is compared with.
// head mode: HEAD, or the empty tree before the first commit.
// merge-base mode: merge-base(HEAD, base), where base defaults to the remote
// default branch (see defaultBase).
// @param mode DiffModeHead or DiffModeMergeBase.
// @param base Client base ref for merge-base mode ("" = default).
// @returns (label, commit) for DiffResult.Base / BaseCommit.
func (r *repo) resolveDiffBase(mode, base string) (string, string, error) {
	head, headErr := r.output("rev-parse", "--verify", "--quiet", "HEAD^{commit}")
	if mode == DiffModeHead {
		if headErr == nil && head != "" {
			return "HEAD", head, nil
		}
		empty, err := r.emptyTree()
		return "HEAD", empty, err
	}
	if headErr != nil || head == "" {
		return "", "", errors.New("this branch has no commits yet — nothing to compare with a base branch")
	}
	if base == "" {
		base = r.defaultBaseRef()
		if base == "" {
			return "", "", errors.New("no base branch found (looked for the remote default branch, main and master)")
		}
	}
	if err := validRefArg(base); err != nil {
		return "", "", err
	}
	baseCommit, err := r.output("rev-parse", "--verify", "--quiet", base+"^{commit}")
	if err != nil || baseCommit == "" {
		return "", "", fmt.Errorf("unknown base branch: %s", base)
	}
	mb, err := r.output("merge-base", head, baseCommit)
	if err != nil || mb == "" {
		return "", "", fmt.Errorf("HEAD and %s have no common ancestor", base)
	}
	return base, mb, nil
}

// defaultBaseRef resolves the default base for merge-base diffs on the
// current branch's remote (or origin / the only remote).
// @returns A ref such as "origin/main", or "" when none is found.
func (r *repo) defaultBaseRef() string {
	upstreamRemote := ""
	if branch, err := r.currentBranch(); err == nil {
		upstreamRemote, _, _ = r.upstreamOf(branch)
	}
	all, _ := r.remotes()
	remote, err := pickRemote("", upstreamRemote, all)
	if err != nil {
		remote = ""
	}
	_, ref := r.defaultBase(remote)
	return ref
}

// emptyTree returns the id of the empty tree in this repo's hash format
// (SHA-1 or SHA-256), used as the base before the first commit.
// @returns Tree id.
func (r *repo) emptyTree() (string, error) {
	spec := r.git(probeTimeout, "hash-object", "-t", "tree", "--stdin")
	spec.stdin = strings.NewReader("")
	res, err := runExec(spec)
	if err != nil {
		return "", err
	}
	if res.Code != 0 {
		return "", errors.New(failureDetail(res))
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

// diffArgs builds the shared `git diff` flags + base + optional pathspec.
// @param extra Output-format flags for this call.
// @param commit Base commit / tree.
// @param paths Optional repo-relative filter.
// @returns argv after "git".
func diffArgs(extra []string, commit string, paths []string) []string {
	args := append([]string{"diff", "-M", "--no-color", "--no-ext-diff", "--no-textconv"}, extra...)
	args = append(args, commit)
	if len(paths) > 0 {
		args = append(append(args, "--"), paths...)
	}
	return args
}

// diffFiles lists changed files with modes, statuses and line counts.
// @param commit Base commit / tree.
// @param paths Optional filter.
// @param env Extra env (temp index) or nil.
// @returns Files in diff-queue order.
func (r *repo) diffFiles(commit string, paths, env []string) ([]DiffFile, error) {
	spec := r.git(diffTimeout, diffArgs([]string{"--raw", "--numstat", "-z"}, commit, paths)...)
	spec.extraEnv = env
	res, err := runExec(spec)
	if err != nil {
		return nil, err
	}
	if res.Code != 0 {
		return nil, errors.New(failureDetail(res))
	}
	return parseRawNumstat(string(res.Stdout))
}

// attachDiffPatches streams the full-context patch and attaches each file's
// section within the requested caps.
// @param files Files from diffFiles (mutated).
// @param commit Base commit / tree.
// @param paths Optional filter (same as diffFiles so sections line up).
// @param env Extra env (temp index) or nil.
// @param req Caps.
// @returns Stream / exec error.
func (r *repo) attachDiffPatches(files []DiffFile, commit string, paths, env []string, req DiffRequest) error {
	if len(files) == 0 {
		return nil
	}
	maxFile := clampCap(req.MaxFileBytes, defaultMaxPatchFileBytes, hardMaxPatchFileBytes)
	maxTotal := clampCap(req.MaxTotalBytes, defaultMaxPatchTotalBytes, hardMaxPatchTotalBytes)
	spec := r.git(diffTimeout, diffArgs([]string{"-U" + strconv.Itoa(fullContextLines)}, commit, paths)...)
	spec.extraEnv = env
	var sections []*patchSection
	res, err := streamExec(spec, func(rd io.Reader) error {
		var splitErr error
		sections, splitErr = splitPatchStream(rd, maxFile, maxTotal)
		return splitErr
	})
	if err != nil {
		return err
	}
	if res.Code != 0 {
		return errors.New(failureDetail(execResult{Stderr: res.Stderr, Code: res.Code}))
	}
	attachPatches(files, sections)
	return nil
}

// clampCap applies a default to a zero/negative request and an upper bound.
// @param requested Client value.
// @param def Default when requested <= 0.
// @param hard Upper bound.
// @returns Effective cap.
func clampCap(requested, def, hard int) int {
	if requested <= 0 {
		return def
	}
	if requested > hard {
		return hard
	}
	return requested
}

// markUntracked flags files that were untracked before the intent-to-add
// index made them visible (they show as "added").
// @param files Diff files (mutated).
// @param untracked Untracked paths.
func markUntracked(files []DiffFile, untracked []string) {
	if len(untracked) == 0 {
		return
	}
	set := make(map[string]bool, len(untracked))
	for _, p := range untracked {
		set[p] = true
	}
	for i := range files {
		if files[i].Status == "added" && set[files[i].Path] {
			files[i].Untracked = true
		}
	}
}
