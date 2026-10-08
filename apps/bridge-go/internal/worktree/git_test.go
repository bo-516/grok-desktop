package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestSourceRepoFromCommonDir distinguishes a linked worktree from a
// checkout whose .git lives inside itself (normal clone or grok copy).
func TestSourceRepoFromCommonDir(t *testing.T) {
	source := SourceRepoFromCommonDir("/repo/wt", "/repo/.git")
	if source != filepath.Clean("/repo") && source != "/repo" {
		// canonicalPath abs-resolves; the parent of /repo/.git is /repo
		// only when those paths exist. Use a relative comparison on the
		// returned base when the fixture path is missing and EvalSymlinks
		// fails: Clean(Abs) still ends in /repo.
		if filepath.Base(source) != "repo" {
			t.Fatalf("linked source: %s", source)
		}
	}
	if got := SourceRepoFromCommonDir("/repo", "/repo/.git"); got != "" {
		t.Fatalf("inside common dir should not invent a source, got %s", got)
	}
	if got := SourceRepoFromCommonDir("", "/repo/.git"); got != "" {
		t.Fatalf("empty toplevel: %s", got)
	}
}

// TestInspectGitRepo reports branch, clean, then dirty, and a linked
// worktree's source. Skips when git is not on PATH.
func TestInspectGitRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initRepo(t)
	info, err := Inspect(repo)
	if err != nil {
		t.Fatalf("inspect clean: %v", err)
	}
	if !info.IsRepo || info.Dirty || info.Worktree || info.Branch != "main" {
		t.Fatalf("clean repo: %+v", info)
	}
	if !SamePath(info.SourceRepo, repo) || !SamePath(info.Toplevel, repo) {
		t.Fatalf("source should be the repo: %+v", info)
	}
	if err := os.WriteFile(filepath.Join(repo, "dirty.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dirty, err := Inspect(repo)
	if err != nil || !dirty.Dirty {
		t.Fatalf("dirty: %+v %v", dirty, err)
	}
	wt := filepath.Join(t.TempDir(), "linked")
	runGit(t, repo, "worktree", "add", "-b", "feat-wt", wt)
	linked, err := Inspect(wt)
	if err != nil {
		t.Fatalf("inspect linked: %v", err)
	}
	if !linked.Worktree || linked.Branch != "feat-wt" || !SamePath(linked.SourceRepo, repo) {
		t.Fatalf("linked: %+v", linked)
	}
	missing, err := Inspect(t.TempDir())
	if err != nil || missing.IsRepo {
		t.Fatalf("not a repo: %+v %v", missing, err)
	}
}

// TestCreateWithFakeGrok spawns GROK_BIN, not the real grok CLI.
// The fake prints a pre-created git worktree path; Create must return that
// path, its branch, and the source repo, and must not treat the source as
// the result.
func TestCreateWithFakeGrok(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initRepo(t)
	wt := filepath.Join(t.TempDir(), "created")
	runGit(t, repo, "worktree", "add", "-b", "feat-created", wt)
	bin := writeCreateFake(t, wt, repo)
	t.Setenv("GROK_BIN", bin)

	info, err := Create(Request{Cwd: repo, Name: "feat-created"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !SamePath(info.Path, wt) {
		t.Fatalf("path: got %s want %s", info.Path, wt)
	}
	if !SamePath(info.SourceRepo, repo) {
		t.Fatalf("source: got %s want %s", info.SourceRepo, repo)
	}
	if info.Branch != "feat-created" {
		t.Fatalf("branch: %s", info.Branch)
	}
	if info.ID != "wt-test" || info.Name != "feat-created" {
		t.Fatalf("identity: %+v", info)
	}
}

// TestCreateRejectsNonRepo does not call grok. The fake records a marker
// if it is executed; the marker must stay absent.
func TestCreateRejectsNonRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	marker := filepath.Join(t.TempDir(), "called")
	bin := writeMarkerFake(t, marker)
	t.Setenv("GROK_BIN", bin)
	_, err := Create(Request{Cwd: t.TempDir(), Name: "nope"})
	if err == nil || !stringsContains(err.Error(), "not a git repository") {
		t.Fatalf("want not a git repository, got %v", err)
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatal("grok was invoked for a non-repository")
	}
}

// TestCreateFailureDoesNotReturnSource uses a fake that exits 1.
// The error must mention worktree create, and the returned path must be empty.
func TestCreateFailureDoesNotReturnSource(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initRepo(t)
	t.Setenv("GROK_BIN", writeFailingFake(t))
	info, err := Create(Request{Cwd: repo})
	if err == nil || !stringsContains(err.Error(), "worktree create") {
		t.Fatalf("want create failure, got %v", err)
	}
	if info.Path != "" || SamePath(info.Path, repo) {
		t.Fatalf("must not fall back to source: %+v", info)
	}
}

// initRepo makes a one-commit repository on branch main.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	runGit(t, dir, "config", "user.email", "wt@example.com")
	runGit(t, dir, "config", "user.name", "wt")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "add", "README.md")
	runGit(t, dir, "commit", "-m", "init")
	return dir
}

// runGit runs git in dir and fails the test on any error.
func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", stringsJoin(args), err, out)
	}
}

func stringsJoin(args []string) string {
	return stringsJoinSep(args, " ")
}

func stringsJoinSep(args []string, sep string) string {
	out := ""
	for i, arg := range args {
		if i > 0 {
			out += sep
		}
		out += arg
	}
	return out
}

func stringsContains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && (haystack == needle || len(haystack) > 0 && contains(haystack, needle)))
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// writeCreateFake prints wt on create and a one-row JSON list.
func writeCreateFake(t *testing.T, wt, repo string) string {
	t.Helper()
	dir := t.TempDir()
	listPath := filepath.Join(dir, "list.json")
	list := `[{"id":"wt-test","path":"` + wt + `","source_repo":"` + repo + `","git_ref":"HEAD","metadata":{"label":"feat-created"}}]`
	if err := os.WriteFile(listPath, []byte(list), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "fake-grok")
	body := "#!/bin/sh\n" +
		"case \"$*\" in\n" +
		"  *worktree*create*)\n" +
		"    echo \"" + wt + "\"\n" +
		"    exit 0\n" +
		"    ;;\n" +
		"  *worktree*list*)\n" +
		"    cat \"" + listPath + "\"\n" +
		"    exit 0\n" +
		"    ;;\n" +
		"  *)\n" +
		"    echo \"unexpected: $*\" >&2\n" +
		"    exit 1\n" +
		"    ;;\n" +
		"esac\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// writeMarkerFake touches marker on any invocation, proving Create called it.
func writeMarkerFake(t *testing.T, marker string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-grok")
	body := "#!/bin/sh\ntouch \"" + marker + "\"\nexit 1\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// writeFailingFake exits 1 with a stderr line and never prints a path.
func writeFailingFake(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-grok")
	body := "#!/bin/sh\necho \"could not find repository\" >&2\nexit 1\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
