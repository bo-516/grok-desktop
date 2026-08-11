package wsapi

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

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
	_, err := dispatchCliCommand("mcp_list", nil, "")
	if err == nil {
		t.Fatal("want error for unported command")
	}
	if !strings.Contains(err.Error(), "mcp_list") {
		t.Fatalf("error must name the command, got %q", err)
	}
	if !strings.Contains(err.Error(), NodeBridgeHint) {
		t.Fatalf("error must carry the Node bridge hint, got %q", err)
	}
}
