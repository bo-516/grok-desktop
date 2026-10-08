package wsapi

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/worktree"
)

// TestWorkspaceGitInspectsRepo checks the cli channel reports a real git
// checkout and a non-repo without calling grok. args.path wins over cwd.
func TestWorkspaceGitInspectsRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initWorkspaceGitRepo(t)
	data, err := dispatchCliCommand("workspace_git", map[string]any{"path": repo}, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	info, ok := data.(worktree.InspectResult)
	if !ok || !info.IsRepo || info.Branch != "main" || info.Dirty || info.Worktree {
		t.Fatalf("repo inspect: %#v", data)
	}
	if !worktree.SamePath(info.SourceRepo, repo) {
		t.Fatalf("source %s", info.SourceRepo)
	}
	missing, err := dispatchCliCommand("workspace_git", nil, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	blank, ok := missing.(worktree.InspectResult)
	if !ok || blank.IsRepo {
		t.Fatalf("non-repo: %#v", missing)
	}
}

// initWorkspaceGitRepo makes a one-commit repository on branch main.
func initWorkspaceGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runWorkspaceGit(t, dir, "init", "-b", "main")
	runWorkspaceGit(t, dir, "config", "user.email", "wt@example.com")
	runWorkspaceGit(t, dir, "config", "user.name", "wt")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runWorkspaceGit(t, dir, "add", "README.md")
	runWorkspaceGit(t, dir, "commit", "-m", "init")
	return dir
}

// runWorkspaceGit runs git in dir and fails the test on any error.
func runWorkspaceGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}
