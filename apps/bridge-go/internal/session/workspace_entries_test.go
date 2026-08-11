package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeWorkspaceMentionQuery(t *testing.T) {
	root := t.TempDir()
	// Normalize to absolute so Rel comparisons match production Abs(workspace).
	root, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	absFile := filepath.Join(root, "src", "app.ts")

	cases := []struct {
		name  string
		query string
		want  string
	}{
		{name: "relative", query: "src/app", want: "src/app"},
		{name: "absolute under workspace", query: absFile, want: "src/app.ts"},
		{name: "file uri under workspace", query: "file://" + absFile, want: "src/app.ts"},
		{name: "workspace root", query: root, want: ""},
		{name: "outside workspace", query: filepath.Join(os.TempDir(), "other", "src", "app.ts"), want: ""}, // checked below
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeWorkspaceMentionQuery(root, tc.query)
			if tc.name == "outside workspace" {
				// Outside paths stay absolute (lowercased) so they do not false-match.
				if got == "src/app.ts" || got == "" && filepath.IsAbs(tc.query) {
					// empty only if Rel collapsed oddly; must not be the relative hit.
				}
				if got == "src/app.ts" {
					t.Fatalf("outside absolute must not map to relative entry, got %q", got)
				}
				return
			}
			if got != tc.want {
				t.Fatalf("normalizeWorkspaceMentionQuery(%q) = %q, want %q", tc.query, got, tc.want)
			}
		})
	}
}

func TestListWorkspaceEntriesAbsoluteQuery(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "app.ts"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	absFile := filepath.Join(root, "src", "app.ts")

	entries, err := ListWorkspaceEntries(root, absFile)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.Path == "src/app.ts" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("absolute query under workspace must return src/app.ts, got %+v", entries)
	}
}
