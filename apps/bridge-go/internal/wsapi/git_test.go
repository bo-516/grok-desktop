package wsapi

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/gitops"
)

// The cli channel routes git_* ids to gitops with the frame cwd and args.
func TestDispatchGitCommandsThroughCli(t *testing.T) {
	global := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(global, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_AUTHOR_NAME", "Test")
	t.Setenv("GIT_AUTHOR_EMAIL", "test@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Test")
	t.Setenv("GIT_COMMITTER_EMAIL", "test@example.com")
	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init", "-q", "-b", "main").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	data, err := dispatchCliCommand("git_status", nil, dir, nil)
	if err != nil {
		t.Fatalf("git_status: %v", err)
	}
	st, ok := data.(*gitops.Status)
	if !ok || !st.IsRepo || len(st.Files) != 1 {
		t.Fatalf("git_status payload: %#v", data)
	}

	data, err = dispatchCliCommand("git_diff", map[string]any{"paths": []any{"a.txt"}}, dir, nil)
	if err != nil {
		t.Fatalf("git_diff: %v", err)
	}
	if diff, ok := data.(*gitops.DiffResult); !ok || len(diff.Files) != 1 || !diff.Files[0].Untracked {
		t.Fatalf("git_diff payload: %#v", data)
	}

	data, err = dispatchCliCommand("git_commit", map[string]any{"message": "first", "all": true}, dir, nil)
	if err != nil {
		t.Fatalf("git_commit: %v", err)
	}
	if res, ok := data.(*gitops.CommitResult); !ok || res.Summary != "first" {
		t.Fatalf("git_commit payload: %#v", data)
	}

	if _, err := dispatchCliCommand("git_push", nil, dir, nil); err == nil || !strings.Contains(err.Error(), "no git remote") {
		t.Fatalf("git_push without remote: %v", err)
	}
	if _, err := dispatchGitCliCommand("git_nope", nil, dir); err == nil {
		t.Fatal("unknown git command should error")
	}
}
