package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPoolCapacityFromEnv(t *testing.T) {
	t.Setenv("BRIDGE_POOL_CAPACITY", "")
	if got := PoolCapacityFromEnv(); got != 8 {
		t.Fatalf("empty env want 8 got %d", got)
	}
	t.Setenv("BRIDGE_POOL_CAPACITY", "4")
	if got := PoolCapacityFromEnv(); got != 4 {
		t.Fatalf("want 4 got %d", got)
	}
	t.Setenv("BRIDGE_POOL_CAPACITY", "99")
	if got := PoolCapacityFromEnv(); got != 16 {
		t.Fatalf("want clamp 16 got %d", got)
	}
	t.Setenv("BRIDGE_POOL_CAPACITY", "0")
	if got := PoolCapacityFromEnv(); got != 8 {
		t.Fatalf("zero want 8 got %d", got)
	}
	t.Setenv("BRIDGE_POOL_CAPACITY", "abc")
	if got := PoolCapacityFromEnv(); got != 8 {
		t.Fatalf("invalid want 8 got %d", got)
	}
}

func TestProbeAuthSourcePrefersAPIKey(t *testing.T) {
	t.Setenv("XAI_API_KEY", "sk-test")
	authed, src, path := ProbeAuthSource()
	if !authed || src != "xai_api_key" {
		t.Fatalf("authed=%v src=%s", authed, src)
	}
	if path == "" {
		t.Fatal("authPathChecked must be set")
	}
}

func TestProbeAuthSourceCachedToken(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XAI_API_KEY", "")
	dir := filepath.Join(home, ".grok")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	auth := filepath.Join(dir, "auth.json")
	if err := os.WriteFile(auth, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	authed, src, path := ProbeAuthSource()
	if !authed || src != "cached_token" {
		t.Fatalf("authed=%v src=%s", authed, src)
	}
	if path != auth {
		t.Fatalf("path=%s want %s", path, auth)
	}
}

func TestProbeAuthSourceNone(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XAI_API_KEY", "")
	authed, src, _ := ProbeAuthSource()
	if authed || src != "none" {
		t.Fatalf("authed=%v src=%s", authed, src)
	}
}

// ProbeAuth answers `check_auth` on the desktop's 3s poll, so it must carry
// every field the UI reads and must track the same sources ProbeAuthSource does.
func TestProbeAuthCarriesFullPayload(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XAI_API_KEY", "")

	out := ProbeAuth()
	if out.Authed || out.AuthSource != "none" {
		t.Fatalf("logged out: authed=%v src=%s", out.Authed, out.AuthSource)
	}
	if out.AuthPathChecked == "" {
		t.Fatal("AuthPathChecked must be set even when logged out")
	}

	t.Setenv("XAI_API_KEY", "sk-test")
	out = ProbeAuth()
	if !out.Authed || out.AuthSource != "xai_api_key" {
		t.Fatalf("logged in: authed=%v src=%s", out.Authed, out.AuthSource)
	}
}

// writeFakeGrok writes an executable stand-in for `grok --version`.
// script is a full shell program. GROK_BIN must point at the returned path
// or CheckEnvironment will find a real CLI instead.
func writeFakeGrok(t *testing.T, script string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "grok")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestGrokVersionSupportedMessages(t *testing.T) {
	old := "grok 0.8.9"
	got := grokVersionSupported(&old, minGrokVersion)
	if got.OK || got.Message != "grok 0.8.9 is below the minimum supported version 0.9.0. Please upgrade the CLI." {
		t.Fatalf("old: %+v", got)
	}
	okLine := "grok 1.0.0 (abc)"
	got = grokVersionSupported(&okLine, minGrokVersion)
	if !got.OK || got.Parsed != "1.0.0" {
		t.Fatalf("parsed: %+v", got)
	}
	got = grokVersionSupported(nil, minGrokVersion)
	if got.Message != "Unable to parse grok version (null); need ≥ 0.9.0" {
		t.Fatalf("null: %q", got.Message)
	}
}

func TestCheckEnvironmentRejectsOldVersionEvenWhenAuthed(t *testing.T) {
	bin := writeFakeGrok(t, "#!/bin/sh\nprintf '%s\\n' 'grok 0.8.9'\n")
	t.Setenv("GROK_BIN", bin)
	t.Setenv("XAI_API_KEY", "sk-test")
	info := CheckEnvironment(8)
	if info.OK {
		t.Fatal("old version must not be ok")
	}
	if !strings.Contains(info.Message, "below the minimum") {
		t.Fatalf("message %q", info.Message)
	}
	if !info.Authed || info.AuthSource != "xai_api_key" {
		t.Fatalf("login must not hide the version failure: authed=%v src=%s", info.Authed, info.AuthSource)
	}
}

func TestCheckEnvironmentAcceptsParsedVersionWhenAuthed(t *testing.T) {
	bin := writeFakeGrok(t, "#!/bin/sh\nprintf '%s\\n' 'grok 1.0.0 (abc)'\n")
	t.Setenv("GROK_BIN", bin)
	t.Setenv("XAI_API_KEY", "sk-test")
	info := CheckEnvironment(8)
	if !info.OK {
		t.Fatalf("want ok, message %q", info.Message)
	}
	if info.Version == nil || *info.Version != "grok 1.0.0 (abc)" {
		t.Fatalf("version %+v", info.Version)
	}
}

func TestCheckEnvironmentRejectsUnparsedVersion(t *testing.T) {
	bin := writeFakeGrok(t, "#!/bin/sh\nexit 1\n")
	t.Setenv("GROK_BIN", bin)
	t.Setenv("XAI_API_KEY", "sk-test")
	info := CheckEnvironment(8)
	if info.OK {
		t.Fatal("unparsed version must not be ok")
	}
	if info.Message != "Unable to parse grok version (null); need ≥ 0.9.0" {
		t.Fatalf("message %q", info.Message)
	}
	if !info.Authed {
		t.Fatal("auth probe still reports the API key")
	}
}
