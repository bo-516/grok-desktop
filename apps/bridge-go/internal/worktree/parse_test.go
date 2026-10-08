package worktree

import (
	"strings"
	"testing"
)

// TestParseCreatePath covers the 1.0.46 single-line path and a JSON path.
func TestParseCreatePath(t *testing.T) {
	path, err := ParseCreatePath("/Users/me/.grok/worktrees/repo/probe-a\n")
	if err != nil || path != "/Users/me/.grok/worktrees/repo/probe-a" {
		t.Fatalf("plain path: %q %v", path, err)
	}
	path, err = ParseCreatePath("note: copying\n/tmp/wt-out\n")
	if err != nil || path != "/tmp/wt-out" {
		t.Fatalf("last absolute line: %q %v", path, err)
	}
	path, err = ParseCreatePath("{\"path\":\"/tmp/from-json\",\"branch\":\"feat\"}\n")
	if err != nil || path != "/tmp/from-json" {
		t.Fatalf("json path: %q %v", path, err)
	}
	if _, err := ParseCreatePath("created ok\n"); err == nil || !strings.Contains(err.Error(), "did not return a path") {
		t.Fatalf("missing path should fail, got %v", err)
	}
}

// TestParseShow reads the plain-text labels grok 1.0.46 prints.
func TestParseShow(t *testing.T) {
	text := "" +
		"  Path:           /wt/probe-a\n" +
		"  ID:             probe-a-abc\n" +
		"  Source Repo:    /src/repo\n" +
		"  Git Ref:        HEAD\n" +
		"  Label:          probe-a\n"
	fields := ParseShow(text)
	if fields.Path != "/wt/probe-a" || fields.ID != "probe-a-abc" ||
		fields.SourceRepo != "/src/repo" || fields.Label != "probe-a" || fields.GitRef != "HEAD" {
		t.Fatalf("show fields: %+v", fields)
	}
}

// TestDecodeListAndMatch accepts a bare array and a wrapped list.
func TestDecodeListAndMatch(t *testing.T) {
	raw := `[{"id":"wt-1","path":"/tmp/wt-a","source_repo":"/tmp/src","git_ref":"HEAD","metadata":{"label":"alpha"}}]`
	row, ok := MatchList(raw, "/tmp/wt-a")
	if !ok || row.ID != "wt-1" || row.Metadata.Label != "alpha" || row.SourceRepo != "/tmp/src" {
		t.Fatalf("match: ok=%v row=%+v", ok, row)
	}
	wrapped := `{"worktrees":[{"id":"wt-2","path":"/tmp/wt-b","source_repo":"/tmp/src"}]}`
	rows := DecodeList(wrapped)
	if len(rows) != 1 || rows[0].ID != "wt-2" {
		t.Fatalf("wrapped: %+v", rows)
	}
	if _, ok := MatchList(raw, "/tmp/missing"); ok {
		t.Fatal("missing path should not match")
	}
}

// TestBuildCreateArgs omits empty name and ref and keeps name before --ref.
func TestBuildCreateArgs(t *testing.T) {
	got := strings.Join(BuildCreateArgs("", ""), " ")
	if got != "worktree create" {
		t.Fatalf("defaults: %s", got)
	}
	got = strings.Join(BuildCreateArgs("feat", "origin/main"), " ")
	if got != "worktree create feat --ref origin/main" {
		t.Fatalf("named: %s", got)
	}
	got = strings.Join(BuildCreateArgs("", "HEAD"), " ")
	if got != "worktree create --ref HEAD" {
		t.Fatalf("ref only: %s", got)
	}
}

// TestParseRequest rejects flags and non-objects, and treats {} as create.
func TestParseRequest(t *testing.T) {
	missing, err := ParseRequest(nil)
	if err != nil || missing != nil {
		t.Fatalf("nil: %+v %v", missing, err)
	}
	empty, err := ParseRequest(map[string]any{})
	if err != nil || empty == nil || empty.Name != "" || empty.Ref != "" {
		t.Fatalf("empty object: %+v %v", empty, err)
	}
	named, err := ParseRequest(map[string]any{"name": " feat ", "ref": "main"})
	if err != nil || named.Name != "feat" || named.Ref != "main" {
		t.Fatalf("named: %+v %v", named, err)
	}
	if _, err := ParseRequest("yes"); err == nil {
		t.Fatal("string worktree should fail")
	}
	if _, err := ParseRequest(map[string]any{"name": "-rf"}); err == nil {
		t.Fatal("dash name should fail")
	}
	if _, err := ParseRequest(map[string]any{"ref": "--all"}); err == nil {
		t.Fatal("dash ref should fail")
	}
}
