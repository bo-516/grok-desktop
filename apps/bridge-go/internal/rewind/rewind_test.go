package rewind

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// writeFile creates parent folders and writes content, failing the test on error.
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// exists reports whether path is present on disk.
func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// checkpointLog is a rewind_points.jsonl sample in grok-build's format:
// prompt 0 created c.txt; prompt 1 created a.txt and edited b.txt; prompt 2
// edited c.txt and created d.txt; a malformed line and a superseded prompt-1
// line are mixed in.
const checkpointLog = `{"prompt_index":0,"created_at":"t0","file_snapshots":{"c.txt":{"path":"c.txt","content":null}},"after_snapshots":{}}
{"prompt_index":1,"created_at":"t1","file_snapshots":{"old.txt":{"path":"old.txt","content":null}},"after_snapshots":{}}
not json
{"prompt_index":1,"created_at":"t1","file_snapshots":{"a.txt":{"path":"a.txt","content":null},"./b.txt":{"path":"b.txt","content":"before\n"}},"after_snapshots":{}}
{"prompt_index":2,"created_at":"t2","file_snapshots":{"c.txt":{"path":"c.txt","content":"c0\n"},"sub/d.txt":{"path":"sub/d.txt","content":null},"e.txt":{"path":"e.txt"}},"after_snapshots":{}}
`

func TestAbsentAtTarget(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, CheckpointFile)
	writeFile(t, path, checkpointLog)

	got, err := AbsentAtTarget(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(got))
	for k := range got {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	// old.txt was superseded by the later prompt-1 line; c.txt existed at the
	// boundary (its first snapshot ≥ 1 has content); e.txt has no content key.
	want := []string{"a.txt", "sub/d.txt"}
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("absent = %v, want %v", keys, want)
	}

	got0, err := AbsentAtTarget(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !got0["c.txt"] {
		t.Fatalf("c.txt should be absent before prompt 0: %v", got0)
	}

	missing, err := AbsentAtTarget(filepath.Join(dir, "nope.jsonl"), 0)
	if err != nil || len(missing) != 0 {
		t.Fatalf("missing log: %v %v", missing, err)
	}
}

// fakeAgent records the last request and answers with a canned result.
type fakeAgent struct {
	method string
	params map[string]any
	result any
	err    error
}

// request implements RequestFunc.
func (f *fakeAgent) request(method string, params map[string]any) (any, error) {
	f.method = method
	f.params = params
	return f.result, f.err
}

func TestExecuteRemovesCreatedFiles(t *testing.T) {
	ws := t.TempDir()
	sessionDir := t.TempDir()
	writeFile(t, filepath.Join(sessionDir, CheckpointFile), checkpointLog)
	writeFile(t, filepath.Join(ws, "a.txt"), "new\n")
	writeFile(t, filepath.Join(ws, "b.txt"), "before\n")
	writeFile(t, filepath.Join(ws, "sub", "d.txt"), "new\n")
	agent := &fakeAgent{result: map[string]any{
		"success":             true,
		"target_prompt_index": float64(1),
		"reverted_files":      []any{"a.txt", "b.txt", "sub/d.txt"},
		"clean_files":         []any{},
		"conflicts":           []any{map[string]any{"path": "b.txt", "conflict_type": "modified_externally"}},
		"error":               nil,
	}}

	res, err := Execute(agent.request, ExecuteOptions{
		SessionID: "s1", Cwd: ws, SessionDir: sessionDir, TargetPromptIndex: 1, Force: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if agent.method != "_x.ai/rewind/execute" {
		t.Fatalf("method = %s", agent.method)
	}
	wantParams := map[string]any{"sessionId": "s1", "targetPromptIndex": 1, "mode": "files_only", "force": true}
	if !reflect.DeepEqual(agent.params, wantParams) {
		t.Fatalf("params = %v", agent.params)
	}
	if !res.Success || res.TargetPromptIndex != 1 {
		t.Fatalf("result = %+v", res)
	}
	if !reflect.DeepEqual(res.DeletedFiles, []string{"a.txt", "sub/d.txt"}) {
		t.Fatalf("deleted = %v", res.DeletedFiles)
	}
	if exists(filepath.Join(ws, "a.txt")) || exists(filepath.Join(ws, "sub", "d.txt")) {
		t.Fatal("created files should be removed")
	}
	if !exists(filepath.Join(ws, "b.txt")) {
		t.Fatal("modified file must stay")
	}
	if len(res.Conflicts) != 1 || res.Conflicts[0].Type != "modified_externally" {
		t.Fatalf("conflicts = %+v", res.Conflicts)
	}
}

func TestExecuteRefusalTouchesNothing(t *testing.T) {
	ws := t.TempDir()
	sessionDir := t.TempDir()
	writeFile(t, filepath.Join(sessionDir, CheckpointFile), checkpointLog)
	writeFile(t, filepath.Join(ws, "a.txt"), "new\n")
	agent := &fakeAgent{result: map[string]any{
		"success":        false,
		"reverted_files": []any{},
		"clean_files":    []any{"a.txt"},
		"conflicts":      []any{map[string]any{"path": "b.txt", "conflict_type": "modified_externally"}},
		"error":          "External modifications detected. Confirm to revert anyway.",
	}}
	res, err := Execute(agent.request, ExecuteOptions{SessionID: "s1", Cwd: ws, SessionDir: sessionDir, TargetPromptIndex: 1})
	if err != nil {
		t.Fatal(err)
	}
	if res.Success || !strings.Contains(res.Error, "External modifications") {
		t.Fatalf("result = %+v", res)
	}
	if agent.params["force"] != false {
		t.Fatalf("force should default to false: %v", agent.params)
	}
	if !reflect.DeepEqual(res.CleanFiles, []string{"a.txt"}) || len(res.DeletedFiles) != 0 {
		t.Fatalf("result = %+v", res)
	}
	if !exists(filepath.Join(ws, "a.txt")) {
		t.Fatal("refusal must not delete")
	}
}

func TestExecuteGuardsWorkspace(t *testing.T) {
	parent := t.TempDir()
	ws := filepath.Join(parent, "ws")
	sessionDir := t.TempDir()
	log := `{"prompt_index":0,"file_snapshots":{"../outside.txt":{"content":null},"dir":{"content":null}}}` + "\n"
	writeFile(t, filepath.Join(sessionDir, CheckpointFile), log)
	writeFile(t, filepath.Join(parent, "outside.txt"), "x")
	if err := os.MkdirAll(filepath.Join(ws, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	agent := &fakeAgent{result: map[string]any{"success": true, "reverted_files": []any{"../outside.txt", "dir"}}}
	res, err := Execute(agent.request, ExecuteOptions{SessionID: "s1", Cwd: ws, SessionDir: sessionDir, TargetPromptIndex: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.DeletedFiles) != 0 || len(res.Warnings) != 2 {
		t.Fatalf("result = %+v", res)
	}
	if !exists(filepath.Join(parent, "outside.txt")) || !exists(filepath.Join(ws, "dir")) {
		t.Fatal("guarded paths must stay")
	}
}

func TestExecuteErrors(t *testing.T) {
	agent := &fakeAgent{err: errors.New("boom")}
	if _, err := Execute(agent.request, ExecuteOptions{SessionID: "s1", TargetPromptIndex: 0}); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("transport error = %v", err)
	}
	if _, err := Execute(agent.request, ExecuteOptions{SessionID: "s1", TargetPromptIndex: -1}); err == nil {
		t.Fatal("negative target must fail")
	}
	if _, err := Execute(agent.request, ExecuteOptions{TargetPromptIndex: 0}); err == nil {
		t.Fatal("missing session must fail")
	}
	if _, err := Execute(nil, ExecuteOptions{SessionID: "s1"}); err == nil {
		t.Fatal("nil sender must fail")
	}
	agent.err = nil
	agent.result = "not an object"
	res, err := Execute(agent.request, ExecuteOptions{SessionID: "s1", TargetPromptIndex: 0})
	if err != nil || res.Success || res.Error == "" {
		t.Fatalf("non-object result = %+v %v", res, err)
	}
}

func TestListPoints(t *testing.T) {
	agent := &fakeAgent{result: map[string]any{"rewind_points": []any{
		map[string]any{"prompt_index": float64(0), "created_at": "t0", "num_file_snapshots": float64(2), "has_file_changes": true, "prompt_preview": "Fix the bug..."},
		map[string]any{"prompt_index": float64(2), "created_at": "", "num_file_snapshots": float64(0), "has_file_changes": false, "prompt_preview": "hi"},
		map[string]any{"prompt_preview": "no index"},
		"junk",
	}}}
	points, err := ListPoints(agent.request, "s1")
	if err != nil {
		t.Fatal(err)
	}
	want := []Point{
		{PromptIndex: 0, Preview: "Fix the bug...", CreatedAt: "t0", FileCount: 2, HasFileChanges: true},
		{PromptIndex: 2, Preview: "hi"},
	}
	if !reflect.DeepEqual(points, want) {
		t.Fatalf("points = %+v", points)
	}
	if agent.method != "_x.ai/rewind/points" || agent.params["sessionId"] != "s1" {
		t.Fatalf("request = %s %v", agent.method, agent.params)
	}
	if _, err := ListPoints(agent.request, " "); err == nil {
		t.Fatal("blank session must fail")
	}
}
