package main

import (
	"strings"
	"testing"
)

// TestPickFreePort_ReturnsPositive binds an ephemeral port successfully.
func TestPickFreePort_ReturnsPositive(t *testing.T) {
	port, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	if port < 1 || port > 65535 {
		t.Fatalf("invalid port %d", port)
	}
	// Second call should also work (listener closed after first).
	port2, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	if port2 < 1 {
		t.Fatalf("invalid port2 %d", port2)
	}
}

// TestGenerateToken_NonEmptyUnique produces random base64url tokens.
func TestGenerateToken_NonEmptyUnique(t *testing.T) {
	a, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == "" || b == "" {
		t.Fatal("empty token")
	}
	if a == b {
		t.Fatal("tokens should differ")
	}
	// base64url alphabet only
	for _, tok := range []string{a, b} {
		for _, r := range tok {
			ok := (r >= 'A' && r <= 'Z') ||
				(r >= 'a' && r <= 'z') ||
				(r >= '0' && r <= '9') ||
				r == '-' || r == '_'
			if !ok {
				t.Fatalf("token has non-base64url char %q in %q", r, tok)
			}
		}
	}
}

// TestBridgeWSURL_Format embeds host port token.
func TestBridgeWSURL_Format(t *testing.T) {
	url := BridgeWSURL("127.0.0.1", 9876, "abc_TOKEN-1")
	if !strings.HasPrefix(url, "ws://127.0.0.1:9876?token=") {
		t.Fatalf("unexpected url %q", url)
	}
	if !strings.Contains(url, "abc_TOKEN-1") {
		t.Fatalf("token missing from %q", url)
	}
}

// TestBridgeInjectJS_JSONSafe escapes quotes in the injected script.
func TestBridgeInjectJS_JSONSafe(t *testing.T) {
	js := bridgeInjectJS(`ws://127.0.0.1:1?token=a"b`)
	if !strings.HasPrefix(js, "window.__GROK_BRIDGE_URL__=") {
		t.Fatalf("prefix: %q", js)
	}
	if strings.Contains(js, `token=a"b`) {
		t.Fatalf("raw quote should be escaped: %q", js)
	}
	if !strings.Contains(js, `\u0022`) && !strings.Contains(js, `\"`) {
		// encoding/json uses \u0022 for " in recent Go, or \"
		t.Fatalf("expected JSON-escaped quote in %q", js)
	}
}
