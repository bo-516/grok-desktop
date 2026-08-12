package spawn

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// writeFakeGrok drops a tiny shell/batch script that emulates a grok CLI
// for unit tests. mode selects the response:
//   - "json": exit 0, prints a JSON object on stdout
//   - "plain": exit 0, prints plain text (so --json path falls back)
//   - "fail": exit 2 with a stderr message
//   - "ndjson": exit 0, prints two NDJSON lines (last object wins)
func writeFakeGrok(t *testing.T, dir, mode string) string {
	t.Helper()
	var path string
	var body string
	if runtime.GOOS == "windows" {
		path = filepath.Join(dir, "fake-grok.bat")
		switch mode {
		case "json":
			body = "@echo off\r\necho {\"ok\":true,\"skills\":[]}\r\n"
		case "plain":
			body = "@echo off\r\necho inspect plain output\r\n"
		case "fail":
			body = "@echo off\r\necho boom 1>&2\r\nexit /b 2\r\n"
		case "ndjson":
			body = "@echo off\r\necho {\"n\":1}\r\necho {\"n\":2}\r\n"
		default:
			t.Fatalf("unknown mode %q", mode)
		}
	} else {
		path = filepath.Join(dir, "fake-grok")
		switch mode {
		case "json":
			body = "#!/bin/sh\necho '{\"ok\":true,\"skills\":[]}'\n"
		case "plain":
			body = "#!/bin/sh\necho 'inspect plain output'\n"
		case "fail":
			body = "#!/bin/sh\necho boom >&2\nexit 2\n"
		case "ndjson":
			body = "#!/bin/sh\necho '{\"n\":1}'\necho '{\"n\":2}'\n"
		default:
			t.Fatalf("unknown mode %q", mode)
		}
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write fake grok: %v", err)
	}
	return path
}

func TestTryParseJSONObject(t *testing.T) {
	v := TryParseJSON(`{"a":1}`)
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", v)
	}
	if m["a"].(float64) != 1 {
		t.Fatalf("want a=1, got %#v", m["a"])
	}
}

func TestTryParseJSONNdjsonLastWins(t *testing.T) {
	v := TryParseJSON("{\"n\":1}\n{\"n\":2}\n")
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", v)
	}
	if m["n"].(float64) != 2 {
		t.Fatalf("want last object n=2, got %#v", m["n"])
	}
}

func TestTryParseJSONEmpty(t *testing.T) {
	if TryParseJSON("  \n") != nil {
		t.Fatal("empty stdout must yield nil")
	}
	if TryParseJSON("not json at all") != nil {
		t.Fatal("plain text must yield nil")
	}
}

func TestRunGrokCliJSONSuccess(t *testing.T) {
	dir := t.TempDir()
	bin := writeFakeGrok(t, dir, "json")
	t.Setenv("GROK_BIN", bin)

	result, err := RunGrokCli([]string{"inspect", "--json"}, "", 5_000)
	if err != nil {
		t.Fatalf("RunGrokCli: %v", err)
	}
	if result.Code == nil || *result.Code != 0 {
		t.Fatalf("want exit 0, got %#v", result.Code)
	}
	m, ok := result.JSON.(map[string]any)
	if !ok {
		t.Fatalf("want JSON object, got %T / %q", result.JSON, result.Stdout)
	}
	if m["ok"] != true {
		t.Fatalf("want ok=true, got %#v", m["ok"])
	}
}

func TestRunGrokCliFailExit(t *testing.T) {
	dir := t.TempDir()
	bin := writeFakeGrok(t, dir, "fail")
	t.Setenv("GROK_BIN", bin)

	result, err := RunGrokCli([]string{"inspect"}, "", 5_000)
	if err != nil {
		t.Fatalf("non-zero exit should still return result, got err: %v", err)
	}
	if result.Code == nil || *result.Code != 2 {
		t.Fatalf("want exit 2, got %#v", result.Code)
	}
	if err := AssertCliOk(result, "inspect"); err == nil {
		t.Fatal("AssertCliOk must fail on non-zero exit")
	} else if !strings.Contains(err.Error(), "inspect failed") {
		t.Fatalf("error must name the label, got %q", err)
	}
}

func TestRunGrokCliTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("timeout script uses sleep; covered on unix")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "slow-grok")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GROK_BIN", path)

	_, err := RunGrokCli([]string{"inspect"}, "", 200)
	if err == nil {
		t.Fatal("want timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("want timed out, got %q", err)
	}
}

func TestRunGrokCliNdjson(t *testing.T) {
	dir := t.TempDir()
	bin := writeFakeGrok(t, dir, "ndjson")
	t.Setenv("GROK_BIN", bin)

	result, err := RunGrokCli([]string{"inspect"}, "", 5_000)
	if err != nil {
		t.Fatalf("RunGrokCli: %v", err)
	}
	m, ok := result.JSON.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", result.JSON)
	}
	if m["n"].(float64) != 2 {
		t.Fatalf("want last NDJSON object, got %#v", m)
	}
}
