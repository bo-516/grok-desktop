package session

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/worktree"
)

// TestWithoutAgentWorktreeKeepsModel checks the spawn-config copy drops the
// agent worktree flags and leaves the caller's struct alone.
func TestWithoutAgentWorktreeKeepsModel(t *testing.T) {
	original := &pool.SessionSpawnConfig{
		Model:     "grok-4",
		Worktree:  true,
		Ref:       "main",
		ExtraArgs: []string{"--debug"},
	}
	next := withoutAgentWorktree(original)
	if next == nil || next.Model != "grok-4" || next.Worktree != nil || next.Ref != "" {
		t.Fatalf("stripped copy: %+v", next)
	}
	if len(next.ExtraArgs) != 1 || next.ExtraArgs[0] != "--debug" {
		t.Fatalf("extra args: %+v", next.ExtraArgs)
	}
	enabled, ok := original.Worktree.(bool)
	if !ok || !enabled || original.Ref != "main" {
		t.Fatal("original spawn config was mutated")
	}
	if withoutAgentWorktree(nil) != nil {
		t.Fatal("nil config should stay nil")
	}
}

// TestStartWorktreeCreateSpawnsInWorktree uses GROK_BIN. Create prints a
// pre-made git worktree; the agent argv records its cwd and must not pass
// --worktree or --ref. Handshake fails, the pool stays empty, and the error
// names the leftover worktree. DefaultListCwd stays the source repo.
func TestStartWorktreeCreateSpawnsInWorktree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fake grok")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initSessionRepo(t)
	wt := filepath.Join(t.TempDir(), "created")
	runSessionGit(t, repo, "worktree", "add", "-b", "feat-created", wt)
	marker := filepath.Join(t.TempDir(), "cwd.txt")
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("GROK_BIN", writeSessionFake(t, wt, repo, marker, argsFile, false))

	cfg := &pool.SessionSpawnConfig{Model: "grok-4", Worktree: true, Ref: "main"}
	deps := testLifecycleDeps()
	err := StartOrResume(deps, StartOpts{
		Cwd:         repo,
		ForceNew:    true,
		SpawnConfig: cfg,
		Worktree:    &worktree.Request{Name: "feat-created"},
	})
	if err == nil || !strings.Contains(err.Error(), "worktree left at") {
		t.Fatalf("want leftover worktree error, got %v", err)
	}
	if deps.Pool.Size() != 0 {
		t.Fatalf("pool size %d", deps.Pool.Size())
	}
	if !worktree.SamePath(deps.State.DefaultListCwd, repo) {
		t.Fatalf("list cwd %s", deps.State.DefaultListCwd)
	}
	got := strings.TrimSpace(readTestFile(t, marker))
	if !worktree.SamePath(got, wt) {
		t.Fatalf("agent cwd %s want %s", got, wt)
	}
	args := readTestFile(t, argsFile)
	if !strings.Contains(args, "agent") || !strings.Contains(args, "--model") || !strings.Contains(args, "grok-4") {
		t.Fatalf("agent args: %s", args)
	}
	if strings.Contains(args, "--worktree") || strings.Contains(args, "--ref") {
		t.Fatalf("nested worktree flags: %s", args)
	}
	enabled, ok := cfg.Worktree.(bool)
	if !ok || !enabled || cfg.Ref != "main" {
		t.Fatal("caller spawn config was mutated")
	}
}

// TestStartWorktreeCreateFailureDoesNotSpawn checks a failing create never
// starts the agent and never occupies a pool slot.
func TestStartWorktreeCreateFailureDoesNotSpawn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fake grok")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initSessionRepo(t)
	marker := filepath.Join(t.TempDir(), "cwd.txt")
	t.Setenv("GROK_BIN", writeSessionFake(t, "", repo, marker, "", true))
	deps := testLifecycleDeps()
	err := StartOrResume(deps, StartOpts{
		Cwd:      repo,
		ForceNew: true,
		Worktree: &worktree.Request{},
	})
	if err == nil || !strings.Contains(err.Error(), "worktree create") {
		t.Fatalf("want create failure, got %v", err)
	}
	if strings.Contains(err.Error(), "worktree left at") {
		t.Fatalf("create failure must not claim a leftover path: %v", err)
	}
	if deps.Pool.Size() != 0 {
		t.Fatalf("pool size %d", deps.Pool.Size())
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatal("agent was spawned after create failed")
	}
}

// TestStartWorktreeRejectsNonRepo does not invoke grok when cwd is not a
// repository, and does not reserve a pool slot.
func TestStartWorktreeRejectsNonRepo(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fake grok")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	marker := filepath.Join(t.TempDir(), "called")
	t.Setenv("GROK_BIN", writeMarkerOnlyFake(t, marker))
	deps := testLifecycleDeps()
	err := StartOrResume(deps, StartOpts{
		Cwd:      t.TempDir(),
		ForceNew: true,
		Worktree: &worktree.Request{Name: "nope"},
	})
	if err == nil || !strings.Contains(err.Error(), "not a git repository") {
		t.Fatalf("want not a git repository, got %v", err)
	}
	if deps.Pool.Size() != 0 {
		t.Fatalf("pool size %d", deps.Pool.Size())
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatal("grok was invoked for a non-repository")
	}
}

// TestStartWorktreeRejectsResume refuses to create a worktree onto an
// existing session id. The fake must not run.
func TestStartWorktreeRejectsResume(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fake grok")
	}
	marker := filepath.Join(t.TempDir(), "called")
	t.Setenv("GROK_BIN", writeMarkerOnlyFake(t, marker))
	deps := testLifecycleDeps()
	err := StartOrResume(deps, StartOpts{
		Cwd:      t.TempDir(),
		ResumeID: "sess-1",
		Worktree: &worktree.Request{},
	})
	if err == nil || !strings.Contains(err.Error(), "worktree create cannot resume session sess-1") {
		t.Fatalf("want resume rejection, got %v", err)
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatal("grok was invoked for a rejected resume")
	}
}

// TestStartExistingWorktreeDoesNotCreate spawns in the attached worktree
// and does not call `worktree create`. The error is the handshake failure
// without a "left at" note, because this call did not create the directory.
func TestStartExistingWorktreeDoesNotCreate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fake grok")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	repo := initSessionRepo(t)
	wt := filepath.Join(t.TempDir(), "existing")
	runSessionGit(t, repo, "worktree", "add", "-b", "feat-existing", wt)
	marker := filepath.Join(t.TempDir(), "cwd.txt")
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("GROK_BIN", writeSessionFake(t, wt, repo, marker, argsFile, false))
	deps := testLifecycleDeps()
	err := StartOrResume(deps, StartOpts{
		Cwd: repo,
		SpawnConfig: &pool.SessionSpawnConfig{
			Worktree: "nested",
			Ref:      "other",
		},
		ExistingWorktree: &worktree.Info{
			Path: wt, Branch: "feat-existing", SourceRepo: repo, Name: "existing",
		},
	})
	if err == nil {
		t.Fatal("expected handshake failure from the fake agent")
	}
	if strings.Contains(err.Error(), "worktree left at") || strings.Contains(err.Error(), "worktree create") {
		t.Fatalf("recovery must not create: %v", err)
	}
	got := strings.TrimSpace(readTestFile(t, marker))
	if !worktree.SamePath(got, wt) {
		t.Fatalf("agent cwd %s want %s", got, wt)
	}
	args := readTestFile(t, argsFile)
	if strings.Contains(args, "--worktree") || strings.Contains(args, "--ref") || strings.Contains(args, "worktree create") {
		t.Fatalf("created or nested: %s", args)
	}
	if !worktree.SamePath(deps.State.DefaultListCwd, repo) {
		t.Fatalf("list cwd %s", deps.State.DefaultListCwd)
	}
}

// testLifecycleDeps is a pool and empty broadcasts. Broadcast must be non-nil
// because a failed handshake still reports stderr.
func testLifecycleDeps() LifecycleDeps {
	return LifecycleDeps{
		Pool:          pool.NewRuntimePool(2),
		State:         &HandlerState{},
		SessionSeeds:  &sync.Map{},
		Broadcast:     func(map[string]any) {},
		BroadcastPool: func() {},
	}
}

// initSessionRepo makes a one-commit repository on branch main.
func initSessionRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runSessionGit(t, dir, "init", "-b", "main")
	runSessionGit(t, dir, "config", "user.email", "wt@example.com")
	runSessionGit(t, dir, "config", "user.name", "wt")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runSessionGit(t, dir, "add", "README.md")
	runSessionGit(t, dir, "commit", "-m", "init")
	return dir
}

// runSessionGit runs git in dir and fails the test on any error.
func runSessionGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

// readTestFile returns the file body or fails the test when it is missing.
func readTestFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(body)
}

// writeSessionFake answers worktree create/list and records the agent cwd.
// failCreate makes every create exit 1 and never print a path. An agent
// invocation writes its cwd to marker and its argv to argsFile when set.
func writeSessionFake(t *testing.T, wt, repo, marker, argsFile string, failCreate bool) string {
	t.Helper()
	dir := t.TempDir()
	listPath := filepath.Join(dir, "list.json")
	list := `[{"id":"wt-test","path":"` + wt + `","source_repo":"` + repo + `","git_ref":"HEAD","metadata":{"label":"feat-created"}}]`
	if err := os.WriteFile(listPath, []byte(list), 0o644); err != nil {
		t.Fatal(err)
	}
	createBody := "    echo \"" + wt + "\"\n    exit 0\n"
	if failCreate {
		createBody = "    echo \"could not find repository\" >&2\n    exit 1\n"
	}
	argsLine := "    :\n"
	if argsFile != "" {
		argsLine = "    echo \"$*\" > \"" + argsFile + "\"\n"
	}
	path := filepath.Join(dir, "fake-grok")
	body := "#!/bin/sh\n" +
		"case \"$*\" in\n" +
		"  *worktree*create*)\n" +
		createBody +
		"    ;;\n" +
		"  *worktree*list*|*worktree*show*)\n" +
		"    cat \"" + listPath + "\"\n" +
		"    exit 0\n" +
		"    ;;\n" +
		"  *agent*)\n" +
		"    echo \"$PWD\" > \"" + marker + "\"\n" +
		argsLine +
		"    exit 1\n" +
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

// writeMarkerOnlyFake touches marker on any invocation.
func writeMarkerOnlyFake(t *testing.T, marker string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-grok")
	body := "#!/bin/sh\ntouch \"" + marker + "\"\nexit 1\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
