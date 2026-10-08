package grokbin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// useTempSettings points settingsPath at a fresh temp file for one test and
// restores it afterwards. Tests using it must not run in parallel.
//
// @returns The settings file path (not yet created).
func useTempSettings(t *testing.T) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "cfg", appConfigDirName, settingsFileName)
	prev := settingsPath
	settingsPath = func() (string, error) { return file, nil }
	t.Cleanup(func() { settingsPath = prev })
	return file
}

// executable writes a runnable stand-in for grok and returns its path.
func executable(t *testing.T) string {
	t.Helper()
	name := "grok"
	if runtime.GOOS == "windows" {
		name = "grok.exe"
	}
	return writeFile(t, t.TempDir(), name, 0o755)
}

func TestSaveCustomBinRoundTripAndClear(t *testing.T) {
	file := useTempSettings(t)
	if LoadCustomBin() != "" {
		t.Fatal("missing file reads as auto-detect")
	}
	bin := executable(t)
	stored, err := SaveCustomBin("  " + bin + "  ")
	if err != nil || stored != bin {
		t.Fatalf("save: %q %v", stored, err)
	}
	if got := LoadCustomBin(); got != bin {
		t.Fatalf("load after save: %q", got)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("file must exist: %v", err)
	}
	if stored, err := SaveCustomBin(""); err != nil || stored != "" {
		t.Fatalf("clear: %q %v", stored, err)
	}
	if LoadCustomBin() != "" {
		t.Fatal("cleared setting must read empty")
	}
}

// A rejected path must leave the previous, working value in place.
func TestSaveCustomBinRejectsInvalidWithoutWriting(t *testing.T) {
	useTempSettings(t)
	bin := executable(t)
	if _, err := SaveCustomBin(bin); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "nope")
	_, err := SaveCustomBin(missing)
	if err == nil || !strings.Contains(err.Error(), "no such file") || !strings.Contains(err.Error(), missing) {
		t.Fatalf("want rejection naming the path, got %v", err)
	}
	if LoadCustomBin() != bin {
		t.Fatal("previous setting must survive a rejected save")
	}
	if _, err := SaveCustomBin("relative/grok"); err == nil {
		t.Fatal("relative path must be rejected")
	}
}

func TestLoadCustomBinIgnoresMalformedFile(t *testing.T) {
	file := useTempSettings(t)
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if LoadCustomBin() != "" {
		t.Fatal("malformed file must read as auto-detect")
	}
	// Saving over a malformed file repairs it.
	bin := executable(t)
	if _, err := SaveCustomBin(bin); err != nil || LoadCustomBin() != bin {
		t.Fatalf("save over malformed: %v", err)
	}
}
