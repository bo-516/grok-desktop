package wsapi

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// writeFakeGrokCLI drops a shell/batch script that answers inspect / mcp
// subcommands with JSON. Used so dispatchCliCommand tests never touch the
// real grok binary.
func writeFakeGrokCLI(t *testing.T, dir string) string {
	t.Helper()
	var path, body string
	if runtime.GOOS == "windows" {
		path = filepath.Join(dir, "fake-grok.bat")
		// %* is all args; match on the joined command line.
		body = "@echo off\r\n" +
			"echo %* | findstr /C:\"inspect\" >nul && echo {\"skills\":[],\"mcpServers\":[]} && exit /b 0\r\n" +
			"echo %* | findstr /C:\"list\" >nul && echo [] && exit /b 0\r\n" +
			"echo %* | findstr /C:\"doctor\" >nul && echo {\"ok\":true,\"name\":\"x\"} && exit /b 0\r\n" +
			"echo unknown >&2\r\nexit /b 1\r\n"
	} else {
		path = filepath.Join(dir, "fake-grok")
		body = `#!/bin/sh
# Minimal grok stand-in for Environment CLI channel tests.
case "$*" in
  *inspect*)
    echo '{"skills":[],"mcpServers":[],"agents":[]}'
    exit 0
    ;;
  *mcp*list*)
    echo '[]'
    exit 0
    ;;
  *mcp*doctor*)
    echo '{"ok":true,"name":"browser-use"}'
    exit 0
    ;;
  *)
    echo "unexpected: $*" >&2
    exit 1
    ;;
esac
`
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write fake grok: %v", err)
	}
	return path
}

// writeSessionFixture lays down one `<home>/sessions/<encoded-cwd>/<id>/summary.json`
// so sessionsList has a real tree to walk. workspace is the decoded absolute
// path; it is percent-encoded into the folder name exactly the way upstream
// writes it, because DecodeWorkspaceDirName is what turns it back into the rail's
// group key — a plain folder name would silently pass through and hide encoding bugs.
func writeSessionFixture(t *testing.T, home, workspace, id, title string) {
	t.Helper()
	dir := filepath.Join(home, "sessions", url.QueryEscape(workspace), id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir fixture: %v", err)
	}
	summary := `{"generated_title":"` + title +
		`","updated_at":"2026-08-11T10:00:00Z","info":{"cwd":"` + workspace + `"}}`
	if err := os.WriteFile(filepath.Join(dir, "summary.json"), []byte(summary), 0o644); err != nil {
		t.Fatalf("write summary: %v", err)
	}
}

// Regression: the rail groups by workspace, so sessions_list must return every
// project under ~/.grok/sessions. Before the CLI channel was ported, the Go
// bridge failed this request outright and the side-nav showed only the projects
// that happened to be cached in the client's localStorage.
func TestSessionsListReturnsEveryWorkspace(t *testing.T) {
	home := t.TempDir()
	t.Setenv("GROK_HOME", home)
	writeSessionFixture(t, home, "/tmp/proj-a", "11111111-aaaa", "Alpha chat")
	writeSessionFixture(t, home, "/tmp/proj-b", "22222222-bbbb", "Beta chat")
	writeSessionFixture(t, home, "/tmp/proj-c", "33333333-cccc", "Gamma chat")

	data, err := dispatchCliCommand("sessions_list", nil, "/tmp/proj-a")
	if err != nil {
		t.Fatalf("sessions_list failed: %v", err)
	}
	envelope, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("want map envelope, got %T", data)
	}
	rows, ok := envelope["sessions"].([]session.DiskSessionRow)
	if !ok {
		t.Fatalf("want sessions rows, got %T", envelope["sessions"])
	}
	if len(rows) != 3 {
		t.Fatalf("want 3 rows across workspaces, got %d", len(rows))
	}
	// cwd argument must not scope the walk: passing proj-a still returns b and c.
	seen := map[string]string{}
	for _, row := range rows {
		seen[row.Cwd] = row.Title
	}
	for _, ws := range []string{"/tmp/proj-a", "/tmp/proj-b", "/tmp/proj-c"} {
		if seen[ws] == "" {
			t.Fatalf("workspace %s missing from rows: %+v", ws, rows)
		}
	}
	if seen["/tmp/proj-b"] != "Beta chat" {
		t.Fatalf("want generated_title as row title, got %q", seen["/tmp/proj-b"])
	}
}

// An absent sessions tree must not error: the desktop treats a failed
// sessions_list as "keep local catalog", and an empty list means the same
// thing, so both stay safe — but only the empty list keeps the channel honest.
func TestSessionsListEmptyHomeReturnsNoRows(t *testing.T) {
	t.Setenv("GROK_HOME", t.TempDir())

	data, err := dispatchCliCommand("sessions_list", nil, "")
	if err != nil {
		t.Fatalf("sessions_list on empty home failed: %v", err)
	}
	rows := data.(map[string]any)["sessions"].([]session.DiskSessionRow)
	if len(rows) != 0 {
		t.Fatalf("want 0 rows, got %d", len(rows))
	}
}

// Unported commands must name themselves in the error so the UI can tell the
// user which feature needs the Node bridge, not just that "cli" is dead.
func TestDispatchCliCommandUnsupported(t *testing.T) {
	_, err := dispatchCliCommand("worktree_list", nil, "")
	if err == nil {
		t.Fatal("want error for unported command")
	}
	if !strings.Contains(err.Error(), "worktree_list") {
		t.Fatalf("error must name the command, got %q", err)
	}
	if !strings.Contains(err.Error(), NodeBridgeHint) {
		t.Fatalf("error must carry the Node bridge hint, got %q", err)
	}
}

// Environment sheet load path: inspect + mcp_list must succeed on the Go
// bridge (regression for the red banner that told users to switch to Node).
func TestDispatchInspectAndMcpList(t *testing.T) {
	bin := writeFakeGrokCLI(t, t.TempDir())
	t.Setenv("GROK_BIN", bin)

	insp, err := dispatchCliCommand("inspect", nil, t.TempDir())
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}
	inspMap, ok := insp.(map[string]any)
	if !ok {
		t.Fatalf("want inspect object, got %T", insp)
	}
	if _, ok := inspMap["skills"]; !ok {
		t.Fatalf("inspect missing skills: %#v", inspMap)
	}

	list, err := dispatchCliCommand("mcp_list", nil, t.TempDir())
	if err != nil {
		t.Fatalf("mcp_list: %v", err)
	}
	// JSON array unmarshals as []any.
	if _, ok := list.([]any); !ok {
		t.Fatalf("want mcp list array, got %T %#v", list, list)
	}
}

// mcp_doctor must accept a name arg and return doctor JSON (or soft envelope).
func TestDispatchMcpDoctor(t *testing.T) {
	bin := writeFakeGrokCLI(t, t.TempDir())
	t.Setenv("GROK_BIN", bin)

	data, err := dispatchCliCommand("mcp_doctor", map[string]any{"name": "browser-use"}, "")
	if err != nil {
		t.Fatalf("mcp_doctor: %v", err)
	}
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("want map, got %T", data)
	}
	if m["ok"] != true {
		t.Fatalf("want ok=true, got %#v", m)
	}
}
