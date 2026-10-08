package gitops

import (
	"strings"
	"testing"
)

// First push sets the upstream; the next push reuses it.
func TestPushSetsUpstreamOnFirstPush(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	bare := newBareRemote(t, dir)
	res, err := Push(dir, PushRequest{})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if res.Remote != "origin" || res.Branch != "main" || res.Upstream != "origin/main" || !res.SetUpstream {
		t.Fatalf("first push: %+v", res)
	}
	if got := runGit(t, bare, "rev-parse", "main"); got != runGit(t, dir, "rev-parse", "HEAD") {
		t.Fatalf("remote main %s != local HEAD", got)
	}
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "b")
	again, err := Push(dir, PushRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if again.SetUpstream {
		t.Fatalf("second push should reuse upstream: %+v", again)
	}
	if st, _ := ReadStatus(dir); st.Upstream != "origin/main" || st.Ahead != 0 {
		t.Fatalf("status after push: %+v", st)
	}
}

// A branch created from origin/main tracks main; Push must publish it under
// its own name, never onto main.
func TestPushNeverTargetsDifferentlyNamedUpstream(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	bare := newBareRemote(t, dir)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
	runGit(t, dir, "checkout", "-q", "-b", "feat", "--track", "origin/main")
	writeFile(t, dir, "f.txt", "f\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-q", "-m", "f")
	mainBefore := runGit(t, bare, "rev-parse", "main")
	res, err := Push(dir, PushRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Upstream != "origin/feat" || !res.SetUpstream {
		t.Fatalf("push result: %+v", res)
	}
	if runGit(t, bare, "rev-parse", "main") != mainBefore {
		t.Fatal("remote main moved")
	}
}

func TestPushRefusals(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	if _, err := Push(dir, PushRequest{}); err == nil || !strings.Contains(err.Error(), "no git remote") {
		t.Errorf("no remote: %v", err)
	}
	newBareRemote(t, dir)
	if _, err := Push(dir, PushRequest{Remote: "nope"}); err == nil || !strings.Contains(err.Error(), "no such remote") {
		t.Errorf("unknown remote: %v", err)
	}
	runGit(t, dir, "checkout", "-q", "--detach")
	if _, err := Push(dir, PushRequest{}); err == nil || !strings.Contains(err.Error(), "detached") {
		t.Errorf("detached: %v", err)
	}
}

// A non-fast-forward rejection comes back as git's own text.
func TestPushRejectionIsVerbatim(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	bare := newBareRemote(t, dir)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
	other := t.TempDir()
	runGit(t, other, "clone", "-q", bare, ".")
	writeFile(t, other, "o.txt", "o\n")
	runGit(t, other, "add", "o.txt")
	runGit(t, other, "commit", "-q", "-m", "other")
	runGit(t, other, "push", "-q", "origin", "main")
	writeFile(t, dir, "l.txt", "l\n")
	runGit(t, dir, "add", "l.txt")
	runGit(t, dir, "commit", "-q", "-m", "local")
	_, err := Push(dir, PushRequest{})
	if err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("want rejection text, got %v", err)
	}
}
