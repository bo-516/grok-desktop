package session

import (
	"os"
	"path/filepath"
	"testing"
)

// writeRepoMarker creates the monorepo marker under root so FindRepoRoot succeeds.
func writeRepoMarker(t *testing.T, root string) {
	t.Helper()
	marker := filepath.Join(root, filepath.FromSlash(repoMarker))
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("// marker\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindRepoRootWalksUp(t *testing.T) {
	root := t.TempDir()
	writeRepoMarker(t, root)
	nested := filepath.Join(root, "apps", "desktop", "src")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := FindRepoRoot(nested); got != root {
		t.Fatalf("nested walk got %q want %q", got, root)
	}
	if got := FindRepoRoot(root); got != root {
		t.Fatalf("root walk got %q want %q", got, root)
	}
}

func TestFindRepoRootMissing(t *testing.T) {
	bare := t.TempDir()
	if got := FindRepoRoot(bare); got != "" {
		t.Fatalf("bare tree should not look like a repo, got %q", got)
	}
}

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

func TestResolveDefaultWorkspaceCwdBridgeCwdWins(t *testing.T) {
	root := t.TempDir()
	writeRepoMarker(t, root)
	explicit := t.TempDir()
	t.Setenv("BRIDGE_CWD", explicit)
	got := ResolveDefaultWorkspaceCwd(root)
	if got != explicit {
		t.Fatalf("got %q want explicit %q", got, explicit)
	}
}

func TestResolveDefaultWorkspaceCwdUsesRepo(t *testing.T) {
	root := t.TempDir()
	writeRepoMarker(t, root)
	t.Setenv("BRIDGE_CWD", "")
	got := ResolveDefaultWorkspaceCwd(filepath.Join(root, "apps", "bridge", "src"))
	if got != root {
		t.Fatalf("got %q want repo %q", got, root)
	}
}

func TestResolveDefaultWorkspaceCwdUsesDocuments(t *testing.T) {
	bare := t.TempDir()
	home := t.TempDir()
	t.Setenv("BRIDGE_CWD", "")
	t.Setenv("XDG_DOCUMENTS_DIR", "")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	got := ResolveDefaultWorkspaceCwd(bare)
	want := filepath.Join(home, "Documents", ProductWorkspaceFolder)
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if st, err := os.Stat(got); err != nil || !st.IsDir() {
		t.Fatalf("production workspace should be created: err=%v", err)
	}
}
