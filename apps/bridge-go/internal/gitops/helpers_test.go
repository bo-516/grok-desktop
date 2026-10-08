package gitops

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// isolateGitConfig points git at an empty global config and a fixed identity
// so tests never inherit the developer's signing, hooks path or aliases.
// t.Setenv also reaches the product code, which inherits os.Environ().
// @param t Test (must not be parallel).
func isolateGitConfig(t *testing.T) {
	t.Helper()
	global := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(global, []byte("[init]\n\tdefaultBranch = main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_AUTHOR_NAME", "Test")
	t.Setenv("GIT_AUTHOR_EMAIL", "test@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Test")
	t.Setenv("GIT_COMMITTER_EMAIL", "test@example.com")
}

// runGit runs real git in dir for fixture setup and fails the test on error.
// @param t Test.
// @param dir Working directory.
// @param args git arguments.
// @returns Trimmed combined output.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// runGitAllowFail runs real git in dir and returns its output even when git
// exits non-zero (e.g. a merge that stops on conflicts).
// @param t Test.
// @param dir Working directory.
// @param args git arguments.
// @returns Trimmed combined output.
func runGitAllowFail(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, _ := cmd.CombinedOutput()
	return strings.TrimSpace(string(out))
}

// writeFile writes content to dir/rel, creating parent directories.
// @param t Test.
// @param dir Repo root.
// @param rel Slash-separated relative path.
// @param content File body.
func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newRepo creates an isolated repo on branch main with one commit holding
// files (rel path → content).
// @param t Test.
// @param files Initial tree; empty map still makes an (empty) initial commit.
// @returns Absolute repo root (symlinks resolved, matching git's toplevel).
func newRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	isolateGitConfig(t)
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "init", "-q", "-b", "main", ".")
	for rel, content := range files {
		writeFile(t, dir, rel, content)
	}
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "--allow-empty", "-m", "initial")
	return dir
}

// newBareRemote creates a bare repo and registers it as `origin` of dir.
// @param t Test.
// @param dir Repo that gets the remote.
// @returns Bare repo path.
func newBareRemote(t *testing.T, dir string) string {
	t.Helper()
	bare := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, dir, "init", "-q", "--bare", "-b", "main", bare)
	runGit(t, dir, "remote", "add", "origin", bare)
	return bare
}

// fileByPath finds one status row.
// @param files Status rows.
// @param path Repo-relative path.
// @returns Row and whether it was found.
func fileByPath(files []FileStatus, path string) (FileStatus, bool) {
	for _, f := range files {
		if f.Path == path {
			return f, true
		}
	}
	return FileStatus{}, false
}

// diffByPath finds one diff row.
// @param files Diff rows.
// @param path Repo-relative path.
// @returns Row and whether it was found.
func diffByPath(files []DiffFile, path string) (DiffFile, bool) {
	for _, f := range files {
		if f.Path == path {
			return f, true
		}
	}
	return DiffFile{}, false
}
