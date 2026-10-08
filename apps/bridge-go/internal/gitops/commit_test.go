package gitops

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Selected paths commit with --only semantics: another file the user staged
// earlier stays staged and out of the commit.
func TestCommitSelectedPathsOnly(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n", "b.txt": "b\n"})
	writeFile(t, dir, "a.txt", "a2\n")
	writeFile(t, dir, "b.txt", "b2\n")
	runGit(t, dir, "add", "b.txt")
	writeFile(t, dir, "new.txt", "n\n")

	res, err := Commit(dir, CommitRequest{Message: "feat: a and new\n\nbody line\n", Paths: []string{"a.txt", "new.txt"}})
	if err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if res.Summary != "feat: a and new" || res.Branch != "main" || len(res.Commit) < 40 {
		t.Fatalf("result: %+v", res)
	}
	committed := runGit(t, dir, "show", "--name-only", "--format=%B", "HEAD")
	if !strings.Contains(committed, "a.txt") || !strings.Contains(committed, "new.txt") || strings.Contains(committed, "b.txt") {
		t.Fatalf("commit contents:\n%s", committed)
	}
	if !strings.Contains(committed, "body line") {
		t.Fatalf("message body lost:\n%s", committed)
	}
	st, _ := ReadStatus(dir)
	if f, ok := fileByPath(st.Files, "b.txt"); !ok || f.Index != "M" {
		t.Fatalf("b.txt should stay staged: %+v", st.Files)
	}
}

// A rename (selected by its new name) and a deletion commit cleanly.
func TestCommitRenameAndDeletion(t *testing.T) {
	dir := newRepo(t, map[string]string{"old.txt": strings.Repeat("keep\n", 10), "gone.txt": "x\n"})
	runGit(t, dir, "mv", "old.txt", "new.txt")
	if err := os.Remove(filepath.Join(dir, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := Commit(dir, CommitRequest{Message: "move", Paths: []string{"new.txt", "gone.txt"}}); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	stat := runGit(t, dir, "show", "--name-status", "--format=", "-M", "HEAD")
	if !strings.Contains(stat, "R100\told.txt\tnew.txt") || !strings.Contains(stat, "D\tgone.txt") {
		t.Fatalf("name-status:\n%s", stat)
	}
	if st, _ := ReadStatus(dir); len(st.Files) != 0 {
		t.Fatalf("tree should be clean: %+v", st.Files)
	}
}

func TestCommitAllIncludesUntracked(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	writeFile(t, dir, "a.txt", "a2\n")
	writeFile(t, dir, "dir/u.txt", "u\n")
	if _, err := Commit(dir, CommitRequest{Message: "all", All: true}); err != nil {
		t.Fatal(err)
	}
	if st, _ := ReadStatus(dir); len(st.Files) != 0 {
		t.Fatalf("tree should be clean: %+v", st.Files)
	}
}

func TestCommitRefusals(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n", "b.txt": "b\n"})
	if _, err := Commit(dir, CommitRequest{Message: "x", All: true}); err == nil || !strings.Contains(err.Error(), "nothing to commit") {
		t.Errorf("clean tree: %v", err)
	}
	writeFile(t, dir, "a.txt", "a2\n")
	cases := []struct {
		name string
		req  CommitRequest
		want string
	}{
		{"empty message", CommitRequest{Message: "  \n", All: true}, "message is required"},
		{"no selection", CommitRequest{Message: "x"}, "no files selected"},
		{"unchanged selection", CommitRequest{Message: "x", Paths: []string{"b.txt"}}, "selected files have no changes"},
		{"escaping path", CommitRequest{Message: "x", Paths: []string{"../a.txt"}}, "outside repository"},
	}
	for _, c := range cases {
		if _, err := Commit(dir, c.req); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: want %q, got %v", c.name, c.want, err)
		}
	}
	if _, err := Commit(t.TempDir(), CommitRequest{Message: "x", All: true}); err == nil {
		t.Error("non-repo: want error")
	}
}

// A rejecting pre-commit hook surfaces its own output verbatim.
func TestCommitHookFailureIsVerbatim(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell hook fixture")
	}
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\necho 'lint failed: a.txt' >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "a.txt", "a2\n")
	_, err := Commit(dir, CommitRequest{Message: "x", Paths: []string{"a.txt"}})
	if err == nil || !strings.Contains(err.Error(), "lint failed: a.txt") {
		t.Fatalf("want hook output, got %v", err)
	}
}
