package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveOptionalRepoRootFrom_EmptyTree(t *testing.T) {
	empty := t.TempDir()
	if got := ResolveOptionalRepoRootFrom(empty, empty); got != "" {
		t.Fatalf("empty tree should be packaged mode, got %q", got)
	}
}

func TestResolveOptionalRepoRootFrom_Checkout(t *testing.T) {
	repo := writeRepoMarker(t)
	if got := ResolveOptionalRepoRootFrom(repo, emptyExe(t)); got != repo {
		t.Fatalf("got %q want repo %q", got, repo)
	}
	nested := filepath.Join(repo, "apps", "desktop")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ResolveOptionalRepoRootFrom(nested, emptyExe(t)); got != repo {
		t.Fatalf("nested walk got %q want %q", got, repo)
	}
}

func TestGoBridgeBinaryCandidates_EmptyRepoIsExeAdjacentOnly(t *testing.T) {
	dir := t.TempDir()
	restoreExe(t, filepath.Join(dir, "grok-desktop"))
	cands := GoBridgeBinaryCandidates("")
	if len(cands) == 0 {
		t.Fatal("expected packaged candidates")
	}
	for _, c := range cands {
		if strings.Contains(c, "apps/bridge-go") || !filepath.IsAbs(c) {
			t.Fatalf("packaged candidate must not use repo-relative apps/: %q", c)
		}
	}
	if FindGoBridgeBinary("") != "" {
		t.Fatal("empty tree with no sibling binary must not resolve a checkout bridge")
	}
}

func TestFindGoBridgeBinary_SiblingAndResources(t *testing.T) {
	dir := t.TempDir()
	restoreExe(t, filepath.Join(dir, "grok-desktop"))
	sibling := filepath.Join(dir, "bridge-go")
	if err := os.WriteFile(sibling, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindGoBridgeBinary(""); got != sibling {
		t.Fatalf("sibling: got %q want %q", got, sibling)
	}

	resDir := filepath.Join(t.TempDir(), "Contents", "Resources")
	macos := filepath.Join(filepath.Dir(resDir), "MacOS")
	if err := os.MkdirAll(resDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(macos, 0o755); err != nil {
		t.Fatal(err)
	}
	resBin := filepath.Join(resDir, "bridge-go")
	if err := os.WriteFile(resBin, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	restoreExe(t, filepath.Join(macos, "grok-desktop"))
	got := FindGoBridgeBinary("")
	want, _ := filepath.Abs(resBin)
	gotAbs, _ := filepath.Abs(got)
	if gotAbs != want {
		t.Fatalf("resources: got %q want %q", gotAbs, want)
	}
}

func TestFindGoBridgeBinary_WindowsPrefersExe(t *testing.T) {
	pinExeSuffix(t, ".exe")
	dir := t.TempDir()
	restoreExe(t, filepath.Join(dir, "grok-desktop.exe"))

	cands := GoBridgeBinaryCandidates("")
	if len(cands) == 0 || !strings.HasSuffix(cands[0], "bridge-go.exe") {
		t.Fatalf("windows: first candidate must be bridge-go.exe, got %v", cands)
	}

	winBin := filepath.Join(dir, "bridge-go.exe")
	if err := os.WriteFile(winBin, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindGoBridgeBinary(""); got != winBin {
		t.Fatalf("windows sibling: got %q want %q", got, winBin)
	}

	repo := t.TempDir()
	repoBin := filepath.Join(repo, "apps", "bridge-go", "bin")
	if err := os.MkdirAll(repoBin, 0o755); err != nil {
		t.Fatal(err)
	}
	checkout := filepath.Join(repoBin, "bridge-go.exe")
	if err := os.WriteFile(checkout, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindGoBridgeBinary(repo); got != checkout {
		t.Fatalf("windows checkout: got %q want %q", got, checkout)
	}
}

func TestResolveBridgeLaunchCwd_BridgeCwdWins(t *testing.T) {
	custom := t.TempDir()
	t.Setenv("BRIDGE_CWD", custom)
	repo := writeRepoMarker(t)
	if got := ResolveBridgeLaunchCwd(""); got != custom {
		t.Fatalf("empty repo: got %q want %q", got, custom)
	}
	if got := ResolveBridgeLaunchCwd(repo); got != custom {
		t.Fatalf("with repo: got %q want %q", got, custom)
	}
}

func TestResolveBridgeLaunchCwd_CheckoutIsRepoRoot(t *testing.T) {
	t.Setenv("BRIDGE_CWD", "")
	repo := writeRepoMarker(t)
	if got := ResolveBridgeLaunchCwd(repo); got != repo {
		t.Fatalf("got %q want repo %q", got, repo)
	}
}

func writeRepoMarker(t *testing.T) string {
	t.Helper()
	repo := t.TempDir()
	marker := filepath.Join(repo, "apps", "bridge", "src")
	if err := os.MkdirAll(marker, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(marker, "server.ts"), []byte("// marker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return repo
}

func emptyExe(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "not-a-repo", "grok-desktop")
}

func pinExeSuffix(t *testing.T, suffix string) {
	t.Helper()
	orig := exeSuffix
	exeSuffix = suffix
	t.Cleanup(func() { exeSuffix = orig })
}

func restoreExe(t *testing.T, path string) {
	t.Helper()
	orig := executablePath
	executablePath = func() (string, error) { return path, nil }
	t.Cleanup(func() { executablePath = orig })
}
