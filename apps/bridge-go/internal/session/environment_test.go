package session

import (
	"os"
	"path/filepath"
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
