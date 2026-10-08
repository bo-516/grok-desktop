package grokbin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// writeFile creates name in dir with the given mode and returns its path.
func writeFile(t *testing.T, dir, name string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, mode); err != nil {
		t.Fatal(err)
	}
	return p
}

// wantReason asserts err is non-nil and mentions fragment.
func wantReason(t *testing.T, err error, fragment string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), fragment) {
		t.Fatalf("want error containing %q, got %v", fragment, err)
	}
}

func TestValidateExecutableUnixRules(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("mode bits are not meaningful on Windows")
	}
	dir := t.TempDir()
	exe := writeFile(t, dir, "grok", 0o755)
	if err := validateExecutableFor(exe, "linux"); err != nil {
		t.Fatalf("executable file: %v", err)
	}
	plain := writeFile(t, dir, "plain", 0o644)
	wantReason(t, validateExecutableFor(plain, "linux"), "not executable")
	wantReason(t, validateExecutableFor(dir, "linux"), "is a directory")
	wantReason(t, validateExecutableFor(filepath.Join(dir, "nope"), "linux"), "no such file")
	wantReason(t, validateExecutableFor("grok", "linux"), "absolute path")
	wantReason(t, validateExecutableFor("  ", "linux"), "empty")
	link := filepath.Join(dir, "link")
	if err := os.Symlink(exe, link); err != nil {
		t.Fatal(err)
	}
	if err := validateExecutableFor(link, "linux"); err != nil {
		t.Fatalf("symlink to executable must pass (installer layout): %v", err)
	}
}

func TestValidateExecutableWindowsRulesUseExtension(t *testing.T) {
	dir := t.TempDir()
	exe := writeFile(t, dir, "grok.EXE", 0o644)
	if err := validateExecutableFor(exe, "windows"); err != nil {
		t.Fatalf(".exe must pass regardless of mode bits: %v", err)
	}
	bat := writeFile(t, dir, "fake-grok.bat", 0o644)
	if err := validateExecutableFor(bat, "windows"); err != nil {
		t.Fatalf(".bat must pass: %v", err)
	}
	txt := writeFile(t, dir, "grok.txt", 0o755)
	wantReason(t, validateExecutableFor(txt, "windows"), "is not an executable")
}
