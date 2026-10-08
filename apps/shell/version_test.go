package main

import "testing"

// TestAppVersionDefault checks an unstamped test binary keeps the dev placeholder.
func TestAppVersionDefault(t *testing.T) {
	if AppVersion() != devAppVersion {
		t.Fatalf("unstamped AppVersion() = %q, want %q", AppVersion(), devAppVersion)
	}
}

// TestAppVersionEmptyFallsBack ensures a blank -X stamp does not log as empty.
func TestAppVersionEmptyFallsBack(t *testing.T) {
	prev := appVersion
	t.Cleanup(func() { appVersion = prev })
	appVersion = ""
	if AppVersion() != devAppVersion {
		t.Fatalf("empty stamp = %q, want %q", AppVersion(), devAppVersion)
	}
}

// TestAppVersionReturnsStamp ensures a release -X value is what callers see.
func TestAppVersionReturnsStamp(t *testing.T) {
	prev := appVersion
	t.Cleanup(func() { appVersion = prev })
	appVersion = "0.2.1"
	if AppVersion() != "0.2.1" {
		t.Fatalf("stamp = %q, want 0.2.1", AppVersion())
	}
}
