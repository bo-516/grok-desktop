package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestLogDir_DarwinShape checks the macOS path layout under a fake home.
func TestLogDir_DarwinShape(t *testing.T) {
	if os.Getenv("GOOS_OVERRIDE") != "" {
		t.Skip("platform override not used")
	}
	// LogDir uses runtime.GOOS; only assert absolute join under temp home.
	dir, err := LogDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(dir) {
		t.Fatalf("expected abs path, got %q", dir)
	}
	if filepath.Base(dir) != "grok-desktop" && filepath.Base(dir) != "logs" {
		// darwin: …/Logs/grok-desktop ; linux: …/grok-desktop/logs
		// base is either "grok-desktop" or "logs" depending on OS.
		t.Fatalf("unexpected log dir base %q full=%s", filepath.Base(dir), dir)
	}
}

// TestPurgeOldLogs_DeletesStale keeps fresh files and removes aged ones.
func TestPurgeOldLogs_DeletesStale(t *testing.T) {
	dir := t.TempDir()
	fresh := filepath.Join(dir, "shell-fresh.log")
	stale := filepath.Join(dir, "shell-stale.log")
	if err := os.WriteFile(fresh, []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stale, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Backdate stale mtime beyond retention window.
	old := time.Now().Add(-13 * time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}

	deleted, err := PurgeOldLogs(dir, 12*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted=%d want 1", deleted)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh file should remain: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale file should be gone, stat err=%v", err)
	}
}

// TestPurgeOldLogs_MissingDir is a no-op.
func TestPurgeOldLogs_MissingDir(t *testing.T) {
	n, err := PurgeOldLogs(filepath.Join(t.TempDir(), "nope"), LogRetention)
	if err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

// TestSessionLogger_AppendUI writes a line without panicking.
func TestSessionLogger_AppendUI(t *testing.T) {
	dir := t.TempDir()
	uiPath := filepath.Join(dir, "ui.log")
	f, err := os.Create(uiPath)
	if err != nil {
		t.Fatal(err)
	}
	sl := &SessionLogger{
		Dir:    dir,
		UIPath: uiPath,
		uiFile: f,
		multi:  ioDiscard{},
	}
	defer sl.Close()
	if err := sl.AppendUI("error", "boom\nline2"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(uiPath)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	if !strings.Contains(body, "[ui/error]") || !strings.Contains(body, "boom") {
		t.Fatalf("unexpected ui log body: %q", body)
	}
}

// ioDiscard is a tiny io.Writer used when the test does not care about multi output.
type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) { return len(p), nil }
