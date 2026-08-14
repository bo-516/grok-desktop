package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUserDocumentsDirUnifiedLeaf(t *testing.T) {
	t.Setenv("XDG_DOCUMENTS_DIR", "")
	home := filepath.Join(t.TempDir(), "home")
	got := UserDocumentsDir(home)
	want := filepath.Join(home, "Documents")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	prod := ProductionWorkspaceDir(home)
	if prod != filepath.Join(want, ProductWorkspaceFolder) {
		t.Fatalf("prod %q", prod)
	}
}

func TestUserDocumentsDirPrefersXDG(t *testing.T) {
	docs := t.TempDir()
	t.Setenv("XDG_DOCUMENTS_DIR", docs)
	if got := UserDocumentsDir("/ignored"); got != docs {
		t.Fatalf("got %q want %q", got, docs)
	}
}

func TestDefaultBridgeCWDUsesRepoRoot(t *testing.T) {
	repo := filepath.Join(t.TempDir(), "grok-desktop")
	if got := DefaultBridgeCWD(repo); got != repo {
		t.Fatalf("got %q want repo %q", got, repo)
	}
}

func TestDefaultBridgeCWDUsesDocumentsWhenNoRepo(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_DOCUMENTS_DIR", "")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	got := DefaultBridgeCWD("")
	want := filepath.Join(home, "Documents", ProductWorkspaceFolder)
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if st, err := os.Stat(got); err != nil || !st.IsDir() {
		t.Fatalf("production workspace should be created: err=%v", err)
	}
}
