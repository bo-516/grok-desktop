package worktree

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Info is the worktree identity returned on the pool entry and stored on
// the runtime so crash recovery can keep the badge without creating again.
type Info struct {
	// Path is the worktree directory the agent process uses as cwd.
	Path string `json:"path"`
	// Branch is the checked-out branch (`git rev-parse --abbrev-ref HEAD`).
	// "HEAD" means detached or the name could not be read.
	Branch string `json:"branch"`
	// SourceRepo is the repository the worktree belongs to. The session rail
	// groups the chat under this path, not under Path.
	SourceRepo string `json:"sourceRepo"`
	// Name is the worktree label (requested name, CLI label, or directory base).
	Name string `json:"name,omitempty"`
	// ID is the grok worktree id. `worktree rm` accepts this, the name, or Path.
	// Empty when list/show did not identify the row; rm then uses Path.
	ID string `json:"id,omitempty"`
}

// InspectResult is the `workspace_git` CLI payload.
// IsRepo false is a successful answer (not an error): the new-chat option
// stays hidden, and Remove worktree is refused because dirtiness is unknown
// only when Inspect itself returns an error.
type InspectResult struct {
	// IsRepo is false when path is not inside a git work tree.
	IsRepo bool `json:"isRepo"`
	// Branch is the checked-out branch, or "HEAD" when detached. Empty when
	// IsRepo is false.
	Branch string `json:"branch,omitempty"`
	// Toplevel is this checkout's root (`--show-toplevel`).
	Toplevel string `json:"toplevel,omitempty"`
	// SourceRepo is the main repository. Equal to Toplevel when path is not
	// a linked worktree or a grok-managed copy.
	SourceRepo string `json:"sourceRepo,omitempty"`
	// Dirty is true when `git status --porcelain` is non-empty (tracked
	// changes and untracked files). Remove worktree is refused when this is set.
	Dirty bool `json:"dirty"`
	// Worktree is true when SourceRepo is a different directory from Toplevel
	// (linked git worktree or grok `worktree list` row).
	Worktree bool `json:"worktree"`
	// WorktreeID is the grok id when list/show identified this checkout.
	WorktreeID string `json:"worktreeId,omitempty"`
	// WorktreeName is the grok label when known.
	WorktreeName string `json:"worktreeName,omitempty"`
	// WorktreePath is Toplevel when this checkout is a worktree, else empty.
	WorktreePath string `json:"worktreePath,omitempty"`
}

// SamePath reports whether two paths are the same directory after abs and
// symlink resolution. `/tmp/repo` and `/private/tmp/repo` match on macOS.
// Empty inputs are not equal, even to each other.
//
// @param a First path; relative paths are resolved against the process cwd.
// @param b Second path.
// @returns True when both resolve to the same cleaned path.
func SamePath(a, b string) bool {
	left := canonicalPath(a)
	right := canonicalPath(b)
	if left == "" || right == "" {
		return false
	}
	return left == right
}

// canonicalPath abs-cleans and resolves symlinks.
// A missing path still returns the cleaned absolute form so a create result
// can be compared before the directory is visible. Empty stays empty.
//
// @param path User or CLI path.
// @returns Comparable path, or "" when path is blank.
func canonicalPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		abs = trimmed
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(resolved)
}

// SourceRepoFromCommonDir maps `git rev-parse --git-common-dir` to the main
// checkout. A linked worktree's common dir is `<source>/.git` and lives
// outside the worktree, so the source is its parent. When the common dir is
// inside the checkout (a normal clone, or grok's standalone copy which has
// its own `.git`), this returns "" and the caller keeps the toplevel — grok
// list/show is what identifies those copies.
//
// @param toplevel `git rev-parse --show-toplevel` for the checkout.
// @param commonDir Absolute `--git-common-dir`. Relative values should be
// made absolute by the caller. Empty returns "".
// @returns Source repository path, or "" when commonDir does not point outside.
func SourceRepoFromCommonDir(toplevel, commonDir string) string {
	top := canonicalPath(toplevel)
	common := canonicalPath(commonDir)
	if top == "" || common == "" {
		return ""
	}
	rel, err := filepath.Rel(top, common)
	if err != nil {
		return ""
	}
	// "." and any path that does not escape top means the common dir is this
	// checkout's own git dir, not a link back to another repository.
	inside := rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
	if inside || filepath.Base(common) != ".git" {
		return ""
	}
	return canonicalPath(filepath.Dir(common))
}

// looksLikeGrokWorktree reports whether path sits under grok's worktree root.
// Those checkouts are often full copies, so git-common-dir does not point at
// the source repo and Inspect must ask `grok worktree list`.
//
// @param path Checkout path.
// @returns True when a path segment chain contains `/.grok/worktrees/`.
func looksLikeGrokWorktree(path string) bool {
	slashed := filepath.ToSlash(canonicalPath(path))
	return strings.Contains(slashed, "/.grok/worktrees/")
}

// gitOutput runs git and returns trimmed stdout.
// A non-zero exit (not a repository, bad revision) is an error and stdout
// is discarded. stderr is not included; callers map the failure to a
// product error such as "not a git repository".
//
// @param cwd Working directory. Empty uses the process cwd.
// @param args Git args after the binary (`rev-parse`, `--show-toplevel`, …).
// @returns Trimmed stdout. Error when git cannot be run or exits non-zero.
func gitOutput(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// ensureGitRepo resolves cwd to a repository toplevel.
// Not a repository, or git missing, returns "not a git repository: <cwd>"
// so session start fails before `grok worktree create` and before any spawn
// in the original checkout.
//
// @param cwd Directory the user selected as the project.
// @returns Symlink-resolved toplevel. Error when cwd is not a git work tree.
func ensureGitRepo(cwd string) (string, error) {
	top, err := gitOutput(cwd, "rev-parse", "--show-toplevel")
	if err != nil || strings.TrimSpace(top) == "" {
		return "", fmt.Errorf("not a git repository: %s", cwd)
	}
	return canonicalPath(top), nil
}

// gitAbbrevHead returns the checked-out branch name.
// Detached HEAD comes back as the literal "HEAD" from git itself.
//
// @param cwd Checkout to query.
// @returns Branch name, or an error when git fails.
func gitAbbrevHead(cwd string) (string, error) {
	return gitOutput(cwd, "rev-parse", "--abbrev-ref", "HEAD")
}

// gitCommonDir returns the absolute shared git dir for cwd.
// Prefers `--path-format=absolute` (Git 2.31+). Older git gets
// `--git-common-dir`, joined with cwd when the answer is relative.
//
// @param cwd Checkout to query.
// @returns Resolved common dir, or "" when git cannot answer.
func gitCommonDir(cwd string) string {
	out, err := gitOutput(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil || out == "" {
		out, err = gitOutput(cwd, "rev-parse", "--git-common-dir")
		if err != nil || out == "" {
			return ""
		}
		if !filepath.IsAbs(out) {
			out = filepath.Join(cwd, out)
		}
	}
	return canonicalPath(out)
}

// dirtyAt reports uncommitted changes in cwd.
// Porcelain output covers staged, unstaged, and untracked files. An empty
// report is clean. A git failure is an error so Remove worktree is refused
// instead of deleting a checkout we could not inspect.
//
// @param cwd Repository or worktree root.
// @returns True when porcelain is non-empty. Error when git status fails.
func dirtyAt(cwd string) (bool, error) {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("git status failed in %s: %w", cwd, err)
	}
	return strings.TrimSpace(string(out)) != "", nil
}
