package reverse

import (
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
	want := filepath.Join(root, "foo", "bar.txt")
	if abs != want {
		t.Fatalf("got %s want %s", abs, want)
	}
	_, err = ResolveWorkspacePath(root, "../escape")
	if err == nil {
		t.Fatal("expected outside error")
	}
	// Empty requested → workspace root
	r, err := ResolveWorkspacePath(root, "")
	if err != nil || r != filepath.Clean(root) {
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
	if abs != target {
		t.Fatalf("got %s want %s", abs, target)
	}
}
