package gitops

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/workspacepath"
)

// lookPath is exec.LookPath, swappable in tests that simulate a missing CLI.
var lookPath = exec.LookPath

// gitFallbackPaths lists install locations probed when git is not on PATH.
// A desktop app launched from Finder / Explorer gets a minimal PATH, so the
// usual package-manager prefixes are tried explicitly.
var gitFallbackPaths = func() []string {
	if runtime.GOOS == "windows" {
		return []string{
			`C:\Program Files\Git\cmd\git.exe`,
			`C:\Program Files (x86)\Git\cmd\git.exe`,
		}
	}
	return []string{"/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"}
}

// ghFallbackPaths lists install locations probed when gh is not on PATH
// (same Finder / Explorer PATH problem as git). Tests replace it to simulate
// a machine without the GitHub CLI.
var ghFallbackPaths = func() []string {
	if runtime.GOOS == "windows" {
		return []string{`C:\Program Files\GitHub CLI\gh.exe`}
	}
	home, _ := os.UserHomeDir()
	out := []string{"/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"}
	if home != "" {
		out = append(out, filepath.Join(home, ".local", "bin", "gh"))
	}
	return out
}

// resolveBin finds name on PATH, else the first existing regular file among
// fallbacks.
// @param name Executable base name ("git" / "gh").
// @param fallbacks Absolute candidates tried in order after PATH.
// @returns Executable path, or "" when none exists.
func resolveBin(name string, fallbacks []string) string {
	if p, err := lookPath(name); err == nil {
		return p
	}
	for _, c := range fallbacks {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// resolveGitBin locates git for this request (not cached: PATH may change
// while the bridge runs, and a lookup is cheap next to the exec itself).
// @returns Executable path, or ErrGitNotFound.
func resolveGitBin() (string, error) {
	if p := resolveBin("git", gitFallbackPaths()); p != "" {
		return p, nil
	}
	return "", ErrGitNotFound
}

// resolveGhBin locates the GitHub CLI.
// @returns Executable path, or "" when gh is not installed.
func resolveGhBin() string {
	return resolveBin("gh", ghFallbackPaths())
}

// gitConfigArgs prefix every git invocation: verbatim non-ASCII paths (no
// octal quoting), no askpass program (with GIT_TERMINAL_PROMPT=0 git fails
// fast instead of prompting), and no color even if the user forces it.
var gitConfigArgs = []string{
	"-c", "core.quotePath=false",
	"-c", "core.askPass=",
	"-c", "color.ui=false",
}

// repo is one resolved work tree.
type repo struct {
	// bin is the git executable used for every command on this repo.
	bin string
	// root is the absolute work-tree top level (`git rev-parse --show-toplevel`).
	root string
}

// errNotRepo marks a cwd outside any git work tree. Callers that report
// status turn it into `isRepo: false`; mutating operations surface it.
var errNotRepo = errors.New("not a git repository")

// git builds an execSpec for `git <gitConfigArgs> <args>` in the repo root.
// @param timeout Deadline for this command.
// @param args Subcommand and flags.
// @returns Spec ready for runExec / streamExec.
func (r *repo) git(timeout time.Duration, args ...string) execSpec {
	full := make([]string, 0, len(gitConfigArgs)+len(args))
	full = append(full, gitConfigArgs...)
	full = append(full, args...)
	return execSpec{bin: r.bin, dir: r.root, args: full, timeout: timeout}
}

// output runs a probe and returns trimmed stdout, or an error carrying the
// verbatim failure detail when git exits non-zero.
// @param args Subcommand and flags (probeTimeout applies).
// @returns Trimmed stdout, or an error.
func (r *repo) output(args ...string) (string, error) {
	res, err := runExec(r.git(probeTimeout, args...))
	if err != nil {
		return "", err
	}
	if res.Code != 0 {
		return "", errors.New(failureDetail(res))
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

// openRepo resolves the work tree containing cwd.
// cwd must be an absolute, existing directory (the session workspace).
// Classification uses LC_ALL=C so "not a git repository" is matched in English
// regardless of the user's locale; any other failure (e.g. dubious-ownership
// safe.directory refusals) is returned verbatim.
// @param cwd Session workspace directory.
// @returns The repo, errNotRepo when cwd is outside any work tree, or another error.
func openRepo(cwd string) (*repo, error) {
	if strings.TrimSpace(cwd) == "" || !filepath.IsAbs(cwd) {
		return nil, fmt.Errorf("workspace path must be absolute: %q", cwd)
	}
	st, err := os.Stat(cwd)
	if err != nil || !st.IsDir() {
		return nil, fmt.Errorf("workspace not found: %s", cwd)
	}
	bin, err := resolveGitBin()
	if err != nil {
		return nil, err
	}
	spec := execSpec{
		bin:      bin,
		dir:      cwd,
		args:     append(append([]string{}, gitConfigArgs...), "rev-parse", "--show-toplevel"),
		timeout:  probeTimeout,
		extraEnv: []string{"LC_ALL=C"},
	}
	res, err := runExec(spec)
	if err != nil {
		return nil, err
	}
	if res.Code != 0 {
		detail := failureDetail(res)
		lower := strings.ToLower(detail)
		if strings.Contains(lower, "not a git repository") || strings.Contains(lower, "must be run in a work tree") {
			return nil, errNotRepo
		}
		return nil, errors.New(detail)
	}
	root := strings.TrimSpace(string(res.Stdout))
	if root == "" {
		return nil, errNotRepo
	}
	return &repo{bin: bin, root: filepath.Clean(filepath.FromSlash(root))}, nil
}

// cleanRepoPath validates one client-supplied path and returns it in the
// repo-relative, slash-separated form git prints. Absolute paths are accepted
// only when they sit lexically inside root. Escapes (`..`, other roots) and
// NUL bytes are rejected. The check is lexical on purpose — git itself
// refuses to stage anything beyond a symlink, and a tracked symlink whose
// target is outside the repo must stay committable.
// @param root Absolute work-tree root.
// @param p Path from the desktop (repo-relative or absolute).
// @returns Repo-relative slash path, or an error naming the rejected input.
func cleanRepoPath(root, p string) (string, error) {
	if strings.TrimSpace(p) == "" || strings.ContainsRune(p, 0) {
		return "", fmt.Errorf("invalid path: %q", p)
	}
	native := filepath.FromSlash(p)
	joined := native
	if !filepath.IsAbs(native) {
		joined = filepath.Join(root, native)
	}
	joined = filepath.Clean(joined)
	if joined == filepath.Clean(root) || !workspacepath.IsPathInsideWorkspace(root, joined) {
		return "", fmt.Errorf("path outside repository: %s", p)
	}
	rel, err := filepath.Rel(root, joined)
	if err != nil || workspacepath.IsRelativeOutsideWorkspace(rel) {
		return "", fmt.Errorf("path outside repository: %s", p)
	}
	return filepath.ToSlash(rel), nil
}
