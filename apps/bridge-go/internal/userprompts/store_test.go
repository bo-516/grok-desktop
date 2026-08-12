package userprompts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type sandbox struct {
	root     string
	grokHome string
	repo     string
	prevHome string
	hadHome  bool
}

func makeSandbox(t *testing.T) *sandbox {
	t.Helper()
	root, err := os.MkdirTemp("", "up-go-store-")
	if err != nil {
		t.Fatal(err)
	}
	gh := filepath.Join(root, "gh")
	repo := filepath.Join(root, "proj")
	_ = os.MkdirAll(filepath.Join(gh, "rules"), 0o700)
	_ = os.MkdirAll(filepath.Join(repo, "src", "deep"), 0o700)
	if out, err := exec.Command("git", "init", "-q", repo).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	excludeDir := filepath.Join(repo, ".git", "info")
	_ = os.MkdirAll(excludeDir, 0o755)
	exclude := filepath.Join(excludeDir, "exclude")
	if _, err := os.Stat(exclude); err != nil {
		_ = os.WriteFile(exclude, []byte{}, 0o644)
	}
	_ = os.WriteFile(filepath.Join(repo, ".gitignore"), []byte("# keep\n"), 0o644)
	prev, had := os.LookupEnv("GROK_HOME")
	_ = os.Setenv("GROK_HOME", gh)
	return &sandbox{root: root, grokHome: gh, repo: repo, prevHome: prev, hadHome: had}
}

func (s *sandbox) cleanup() {
	if s.hadHome {
		_ = os.Setenv("GROK_HOME", s.prevHome)
	} else {
		_ = os.Unsetenv("GROK_HOME")
	}
	_ = os.RemoveAll(s.root)
}

func e(text, id string) PromptEntry {
	return PromptEntry{Id: id, Text: text, Enabled: true}
}

func TestStoreOpsPerScope(t *testing.T) {
	scopes := []PromptScope{ScopeGlobal, ScopeProject, ScopeProjectLocal}
	for _, scope := range scopes {
		scope := scope
		t.Run(string(scope), func(t *testing.T) {
			sb := makeSandbox(t)
			defer sb.cleanup()

			r1, err := PromptsSet(scope, []PromptEntry{e("Hello world", "a")}, sb.repo)
			if err != nil || r1.Removed {
				t.Fatalf("add: %+v %v", r1, err)
			}
			body, _ := os.ReadFile(r1.Path)
			if !strings.Contains(string(body), "Hello world") || !strings.Contains(string(body), ManagedMarker) {
				t.Fatalf("body: %s", body)
			}

			r2, err := PromptsSet(scope, []PromptEntry{e("Hello changed", "a")}, sb.repo)
			if err != nil {
				t.Fatal(err)
			}
			body, _ = os.ReadFile(r2.Path)
			if !strings.Contains(string(body), "Hello changed") || strings.Contains(string(body), "Hello world") {
				t.Fatalf("change: %s", body)
			}

			_, err = PromptsSet(scope, []PromptEntry{e("Keep", "a"), e("Drop me", "b")}, sb.repo)
			if err != nil {
				t.Fatal(err)
			}
			after, err := PromptsSet(scope, []PromptEntry{e("Keep", "a")}, sb.repo)
			if err != nil {
				t.Fatal(err)
			}
			body, _ = os.ReadFile(after.Path)
			if !strings.Contains(string(body), "Keep") || strings.Contains(string(body), "Drop me") {
				t.Fatalf("delete one: %s", body)
			}

			cleared, err := PromptsClear(scope, sb.repo)
			if err != nil || !cleared.Removed {
				t.Fatalf("clear: %+v %v", cleared, err)
			}
			if _, err := os.Stat(cleared.Path); !os.IsNotExist(err) {
				t.Fatalf("file still exists")
			}
		})
	}
}

func TestClearNotZeroByte(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("bye", "a")}, sb.repo)
	r, err := PromptsClear(ScopeGlobal, sb.repo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
		t.Fatal("S-14: file should be gone")
	}
}

func TestClearPreservesSibling(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	own := filepath.Join(sb.grokHome, "rules", "my-own.md")
	_ = os.WriteFile(own, []byte("# mine\n"), 0o644)
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("managed", "a")}, sb.repo)
	_, _ = PromptsClear(ScopeGlobal, sb.repo)
	raw, _ := os.ReadFile(own)
	if string(raw) != "# mine\n" {
		t.Fatalf("S-15: sibling changed: %q", raw)
	}
}

func TestForeignRefuse(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	p := ScopePath(ScopeGlobal, sb.grokHome, sb.repo)
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	foreign := "# not ours\n- leave me\n"
	_ = os.WriteFile(p, []byte(foreign), 0o644)
	if _, err := PromptsSet(ScopeGlobal, []PromptEntry{e("x", "a")}, sb.repo); err == nil {
		t.Fatal("S-16: set should fail")
	}
	if _, err := PromptsClear(ScopeGlobal, sb.repo); err == nil {
		t.Fatal("S-16: clear should fail")
	}
	raw, _ := os.ReadFile(p)
	if string(raw) != foreign {
		t.Fatalf("S-16: bytes changed")
	}
}

func TestNoTmpLeftovers(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("atom", "a")}, sb.repo)
	dir := filepath.Join(sb.grokHome, "rules")
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("S-18: leftover %s", e.Name())
		}
	}
}

func TestGrokHomeSandbox(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	if ResolveGrokHome() != sb.grokHome {
		t.Fatalf("S-20: home %s want %s", ResolveGrokHome(), sb.grokHome)
	}
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("home", "a")}, sb.repo)
	if _, err := os.Stat(filepath.Join(sb.grokHome, "rules", GlobalFile)); err != nil {
		t.Fatal(err)
	}
}

func TestDeepCwdProjectRoot(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	deep := filepath.Join(sb.repo, "src", "deep")
	r, err := PromptsSet(ScopeProject, []PromptEntry{e("deep", "a")}, deep)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(sb.repo, ".grok", "rules", GlobalFile)
	gotReal, _ := filepath.EvalSymlinks(r.Path)
	wantReal, _ := filepath.EvalSymlinks(want)
	if gotReal != wantReal {
		t.Fatalf("S-21: path %s want %s", gotReal, wantReal)
	}
}

func TestNonGit(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	plain := filepath.Join(sb.root, "plain")
	_ = os.MkdirAll(plain, 0o700)
	root, gitRepo := ResolveProjectRoot(plain)
	if gitRepo {
		t.Fatal("S-22: expected non-git")
	}
	if root != plain && root != filepath.Clean(plain) {
		// Abs may resolve
		abs, _ := filepath.Abs(plain)
		if root != abs {
			t.Fatalf("S-22: root %s", root)
		}
	}
	r, err := PromptsSet(ScopeProjectLocal, []PromptEntry{e("local", "a")}, plain)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(r.Path); err != nil {
		t.Fatal(err)
	}
}

func TestExcludeIdempotent(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeProjectLocal, []PromptEntry{e("one", "a")}, sb.repo)
	_, _ = PromptsSet(ScopeProjectLocal, []PromptEntry{e("two", "a")}, sb.repo)
	raw, _ := os.ReadFile(filepath.Join(sb.repo, ".git", "info", "exclude"))
	hits := 0
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(line) == LocalExcludeLine {
			hits++
		}
	}
	if hits != 1 {
		t.Fatalf("S-23: hits=%d body=%q", hits, raw)
	}
}

func TestGitignoreUntouched(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	gi := filepath.Join(sb.repo, ".gitignore")
	before, _ := os.ReadFile(gi)
	_, _ = PromptsSet(ScopeProjectLocal, []PromptEntry{e("x", "a")}, sb.repo)
	_, _ = PromptsSet(ScopeProject, []PromptEntry{e("y", "a")}, sb.repo)
	after, _ := os.ReadFile(gi)
	if string(before) != string(after) {
		t.Fatal("S-24: .gitignore changed")
	}
}

func TestGitVisibility(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeProject, []PromptEntry{e("team", "a")}, sb.repo)
	_, _ = PromptsSet(ScopeProjectLocal, []PromptEntry{e("mine", "a")}, sb.repo)
	localPath := filepath.Join(sb.repo, ".grok", "rules", ProjectLocalFile)
	teamPath := filepath.Join(sb.repo, ".grok", "rules", GlobalFile)
	if err := exec.Command("git", "-C", sb.repo, "check-ignore", "-q", localPath).Run(); err != nil {
		t.Fatalf("S-25: check-ignore: %v", err)
	}
	// Team must not be ignored.
	if err := exec.Command("git", "-C", sb.repo, "check-ignore", "-q", teamPath).Run(); err == nil {
		t.Fatal("S-25: team file should not be check-ignore hit")
	}
	out, _ := exec.Command("git", "-C", sb.repo, "status", "--porcelain").Output()
	status := string(out)
	if !strings.Contains(status, ".grok") {
		t.Fatalf("S-25: team tree missing from status: %s", status)
	}
	if strings.Contains(status, "01-grok-desktop.local.md") {
		t.Fatalf("S-25: local should be hidden: %s", status)
	}
}

func TestMoveSuccessAndForeignRollback(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("move-me", "m"), e("stay", "s")}, sb.repo)
	_, err := PromptsMove(ScopeGlobal, ScopeProject, 0, sb.repo)
	if err != nil {
		t.Fatal(err)
	}
	snap, _ := PromptsGet(sb.repo)
	if len(snap.Global.Entries) != 1 || snap.Global.Entries[0].Text != "stay" {
		t.Fatalf("from: %#v", snap.Global.Entries)
	}
	if len(snap.Project.Entries) != 1 || snap.Project.Entries[0].Text != "move-me" {
		t.Fatalf("to: %#v", snap.Project.Entries)
	}

	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("a", "1")}, sb.repo)
	_, _ = PromptsSet(ScopeProject, []PromptEntry{e("b", "2")}, sb.repo)
	gPath := ScopePath(ScopeGlobal, sb.grokHome, sb.repo)
	_ = os.WriteFile(gPath, []byte("# foreign\n"), 0o644)
	if _, err := PromptsMove(ScopeGlobal, ScopeProject, 0, sb.repo); err == nil {
		t.Fatal("expected foreign error")
	}
	snap, _ = PromptsGet(sb.repo)
	if len(snap.Project.Entries) != 1 || snap.Project.Entries[0].Text != "b" {
		t.Fatalf("S-26 rollback: %#v", snap.Project.Entries)
	}
}

func TestClearGlobalIsolation(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("g", "a")}, sb.repo)
	_, _ = PromptsSet(ScopeProject, []PromptEntry{e("p", "a")}, sb.repo)
	_, _ = PromptsSet(ScopeProjectLocal, []PromptEntry{e("l", "a")}, sb.repo)
	_, _ = PromptsClear(ScopeGlobal, sb.repo)
	snap, _ := PromptsGet(sb.repo)
	if snap.Global.Exists {
		t.Fatal("global should be gone")
	}
	if snap.Project.Entries[0].Text != "p" || snap.ProjectLocal.Entries[0].Text != "l" {
		t.Fatalf("S-27: %#v %#v", snap.Project, snap.ProjectLocal)
	}
}

func TestConcurrentSets(t *testing.T) {
	sb := makeSandbox(t)
	defer sb.cleanup()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = PromptsSet(ScopeGlobal, []PromptEntry{e("v"+string(rune('0'+i)), "id")}, sb.repo)
		}(i)
	}
	wg.Wait()
	snap, err := PromptsGet(sb.repo)
	if err != nil || !snap.Global.Exists || len(snap.Global.Entries) != 1 {
		t.Fatalf("S-28: %#v %v", snap.Global, err)
	}
	body, _ := os.ReadFile(snap.Global.Path)
	if !strings.HasPrefix(string(body), ManagedMarker) {
		t.Fatalf("S-28: bad body %s", body)
	}
}
