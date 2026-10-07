package gitops

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// useFakeGh swaps gh resolution for a shell script (script == "" simulates
// gh missing entirely). Real git keeps resolving through PATH. The fake
// records its argv to <dir>/args so tests can assert the exact flags.
// @param t Test.
// @param script Shell body run as the fake gh; "" means not installed.
// @returns Path of the argv log file.
func useFakeGh(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture for gh")
	}
	dir := t.TempDir()
	argsLog := filepath.Join(dir, "args")
	fake := filepath.Join(dir, "gh")
	if script != "" {
		body := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + argsLog + "'\n" + script
		if err := os.WriteFile(fake, []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	prevLook, prevFallback := lookPath, ghFallbackPaths
	lookPath = func(name string) (string, error) {
		if name == "gh" {
			if script == "" {
				return "", exec.ErrNotFound
			}
			return fake, nil
		}
		return exec.LookPath(name)
	}
	ghFallbackPaths = func() []string { return nil }
	t.Cleanup(func() { lookPath, ghFallbackPaths = prevLook, prevFallback })
	return argsLog
}

// pushedRepo returns a repo whose feature branch tracks origin/feat.
// @param t Test.
// @returns Repo root.
func pushedRepo(t *testing.T) string {
	t.Helper()
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	newBareRemote(t, dir)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
	runGit(t, dir, "checkout", "-q", "-b", "feat")
	runGit(t, dir, "push", "-q", "-u", "origin", "feat")
	return dir
}

func TestPreflightReportsMissingGh(t *testing.T) {
	useFakeGh(t, "")
	dir := pushedRepo(t)
	pre, err := PreflightPR(dir)
	if err != nil {
		t.Fatal(err)
	}
	if pre.GhAvailable || pre.GhAuthenticated || !strings.Contains(pre.GhMessage, "not installed") {
		t.Fatalf("gh missing: %+v", pre)
	}
	if pre.Branch != "feat" || pre.Upstream != "origin/feat" || pre.DefaultBase != "main" {
		t.Fatalf("branch info: %+v", pre)
	}
	if len(pre.Bases) != 2 {
		t.Fatalf("bases: %v", pre.Bases)
	}
	if _, err := CreatePR(dir, PRRequest{Title: "t"}); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("create without gh: %v", err)
	}
}

func TestPreflightReportsLoggedOutGh(t *testing.T) {
	useFakeGh(t, "echo 'You are not logged into any GitHub hosts. To log in, run: gh auth login' >&2\nexit 1\n")
	pre, err := PreflightPR(pushedRepo(t))
	if err != nil {
		t.Fatal(err)
	}
	if !pre.GhAvailable || pre.GhAuthenticated || !strings.Contains(pre.GhMessage, "gh auth login") {
		t.Fatalf("logged out: %+v", pre)
	}
}

func TestCreatePRPassesFlagsAndParsesURL(t *testing.T) {
	argsLog := useFakeGh(t, "echo 'Creating pull request for feat into main'\necho 'https://github.com/o/r/pull/42'\n")
	res, err := CreatePR(pushedRepo(t), PRRequest{Title: "-dash title", Body: "line1\nline2", Base: "main", Draft: true})
	if err != nil {
		t.Fatalf("CreatePR: %v", err)
	}
	if res.URL != "https://github.com/o/r/pull/42" || res.Existing {
		t.Fatalf("result: %+v", res)
	}
	raw, err := os.ReadFile(argsLog)
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	for _, want := range []string{"pr\ncreate\n", "--title=-dash title\n", "--body=line1\nline2\n", "--base=main\n", "--draft\n"} {
		if !strings.Contains(got, want) {
			t.Errorf("argv missing %q:\n%s", want, got)
		}
	}
}

func TestCreatePRReturnsExistingPR(t *testing.T) {
	useFakeGh(t, "echo 'a pull request for branch \"feat\" into branch \"main\" already exists:' >&2\necho 'https://github.com/o/r/pull/7' >&2\nexit 1\n")
	res, err := CreatePR(pushedRepo(t), PRRequest{Title: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Existing || res.URL != "https://github.com/o/r/pull/7" {
		t.Fatalf("existing: %+v", res)
	}
}

func TestCreatePRRefusals(t *testing.T) {
	useFakeGh(t, "echo 'gh: some failure' >&2\nexit 1\n")
	unpushed := newRepo(t, map[string]string{"a.txt": "a\n"})
	if _, err := CreatePR(unpushed, PRRequest{Title: "t"}); err == nil || !strings.Contains(err.Error(), "push this branch") {
		t.Errorf("no upstream: %v", err)
	}
	dir := pushedRepo(t)
	if _, err := CreatePR(dir, PRRequest{Title: "  "}); err == nil || !strings.Contains(err.Error(), "title is required") {
		t.Errorf("empty title: %v", err)
	}
	if _, err := CreatePR(dir, PRRequest{Title: "t", Base: "--evil"}); err == nil {
		t.Error("flag-like base accepted")
	}
	if _, err := CreatePR(dir, PRRequest{Title: "t"}); err == nil || !strings.Contains(err.Error(), "gh: some failure") {
		t.Errorf("gh failure should be verbatim: %v", err)
	}
}
