package main

import (
	"strings"
	"testing"
)

// TestBridgeEnv_Overrides sets BRIDGE_* and preserves unrelated parent vars.
func TestBridgeEnv_Overrides(t *testing.T) {
	parent := []string{"PATH=/usr/bin", "BRIDGE_PORT=1", "FOO=bar"}
	out := bridgeEnv(parent, BridgeLaunchParams{
		Port:           9999,
		Token:          "tok",
		Host:           "127.0.0.1",
		AllowedOrigins: "null,file://",
		Cwd:            "/tmp/ws",
	})
	m := map[string]string{}
	for _, e := range out {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			m[parts[0]] = parts[1]
		}
	}
	if m["BRIDGE_PORT"] != "9999" {
		t.Fatalf("port: %q", m["BRIDGE_PORT"])
	}
	if m["BRIDGE_TOKEN"] != "tok" {
		t.Fatalf("token: %q", m["BRIDGE_TOKEN"])
	}
	if m["BRIDGE_HOST"] != "127.0.0.1" {
		t.Fatalf("host: %q", m["BRIDGE_HOST"])
	}
	if m["BRIDGE_CWD"] != "/tmp/ws" {
		t.Fatalf("cwd: %q", m["BRIDGE_CWD"])
	}
	if m["FOO"] != "bar" {
		t.Fatalf("parent FOO lost: %v", m)
	}
	if m["PATH"] != "/usr/bin" {
		t.Fatalf("PATH lost: %v", m)
	}
}

// TestDefaultAllowedOrigins_IncludesWailsAndNull covers shell packaging origins.
func TestDefaultAllowedOrigins_IncludesWailsAndNull(t *testing.T) {
	s := DefaultAllowedOrigins()
	for _, need := range []string{"null", "file://", "wails://localhost"} {
		if !strings.Contains(s, need) {
			t.Fatalf("missing %q in %q", need, s)
		}
	}
}
