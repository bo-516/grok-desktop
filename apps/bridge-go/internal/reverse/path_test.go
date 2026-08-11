package reverse

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestIsPathInsideWorkspace(t *testing.T) {
	root := filepath.Join(t.TempDir(), "ws")
	inside := filepath.Join(root, "src", "a.go")
	neighbor := root + "-evil"
	if !IsPathInsideWorkspace(root, root) {
		t.Fatal("root should be inside itself")
	}
	if !IsPathInsideWorkspace(root, inside) {
		t.Fatal("descendant should be inside")
	}
	if IsPathInsideWorkspace(root, neighbor) {
		t.Fatal("prefix-neighbor must be rejected")
	}
	if IsPathInsideWorkspace(root, filepath.Join(root, "..", "other")) {
		t.Fatal("parent escape must be rejected")
	}
}

func TestResolveWorkspacePath(t *testing.T) {
	root := t.TempDir()
	abs, err := ResolveWorkspacePath(root, "foo/bar.txt")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(mustReal(t, root), "foo", "bar.txt")
	if abs != want {
		t.Fatalf("got %s want %s", abs, want)
	}
	_, err = ResolveWorkspacePath(root, "../escape")
	if err == nil {
		t.Fatal("expected outside error")
	}
	// Empty requested → workspace root (realpath)
	r, err := ResolveWorkspacePath(root, "")
	if err != nil || r != mustReal(t, root) {
		t.Fatalf("empty: %s %v", r, err)
	}
}

func TestResolveAbsoluteInside(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("path style")
	}
	root := t.TempDir()
	target := filepath.Join(root, "x")
	abs, err := ResolveWorkspacePath(root, target)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(mustReal(t, root), "x")
	if abs != want {
		t.Fatalf("got %s want %s", abs, want)
	}
}

func mustReal(t *testing.T, p string) string {
	t.Helper()
	r, err := filepath.EvalSymlinks(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return r
}

func TestResolveSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics")
	}
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("leak"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	_, err := ResolveWorkspacePath(root, "escape/secret.txt")
	if err == nil {
		t.Fatal("expected symlink escape to be rejected")
	}
}
