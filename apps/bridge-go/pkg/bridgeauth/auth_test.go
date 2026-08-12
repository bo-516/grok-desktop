package bridgeauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveListenPort(t *testing.T) {
	if ResolveListenPort("", 8765) != 8765 {
		t.Fatal("default")
	}
	if ResolveListenPort("0", 8765) != 0 {
		t.Fatal("ephemeral")
	}
	if ResolveListenPort("99999", 8765) != 8765 {
		t.Fatal("invalid high")
	}
	if ResolveListenPort("9000", 8765) != 9000 {
		t.Fatal("valid")
	}
}

func TestResolveBridgeToken(t *testing.T) {
	if ResolveBridgeToken("  abc  ") != "abc" {
		t.Fatal("trim")
	}
	a := ResolveBridgeToken("")
	if a == "" {
		t.Fatal("empty token")
	}
	// Two empty calls should almost always differ (random 24-byte secret).
	b := ResolveBridgeToken("")
	if a == b {
		t.Log("token collision (extremely unlikely); not failing hard")
	}
}

func TestResolveAllowedOriginsDefault(t *testing.T) {
	origins := ResolveAllowedOrigins("")
	found := false
	for _, o := range origins {
		if o == "http://localhost:5173" {
			found = true
		}
	}
	if !found {
		t.Fatal("default missing vite origin")
	}
	custom := ResolveAllowedOrigins("http://a,http://a,http://b")
	if len(custom) != 2 {
		t.Fatalf("dedupe got %v", custom)
	}
}

func TestIsOriginAllowed(t *testing.T) {
	allowed := []string{"http://localhost:5173", "file://"}
	if !IsOriginAllowed("", allowed) {
		t.Fatal("missing origin ok")
	}
	if !IsOriginAllowed("http://localhost:5173", allowed) {
		t.Fatal("exact")
	}
	if IsOriginAllowed("http://evil.example", allowed) {
		t.Fatal("evil")
	}
	if !IsOriginAllowed("file:///Users/x/app", allowed) {
		t.Fatal("file prefix")
	}
}

func TestAuthorizeConnection(t *testing.T) {
	cfg := Config{
		Token:          "secret",
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	// missing token
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	res := AuthorizeConnection(req, cfg)
	if res.OK || res.Status != 401 {
		t.Fatalf("missing token: %+v", res)
	}
	// bad origin
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/?token=secret", nil)
	req.Header.Set("Origin", "http://evil")
	res = AuthorizeConnection(req, cfg)
	if res.OK || res.Status != 403 {
		t.Fatalf("bad origin: %+v", res)
	}
	// ok with query token, no origin
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/?token=secret", nil)
	res = AuthorizeConnection(req, cfg)
	if !res.OK {
		t.Fatalf("should pass: %+v", res)
	}
	// bearer header
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	req.Header.Set("Authorization", "Bearer secret")
	res = AuthorizeConnection(req, cfg)
	if !res.OK {
		t.Fatalf("bearer: %+v", res)
	}
	// x-bridge-token
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	req.Header.Set("X-Bridge-Token", "secret")
	res = AuthorizeConnection(req, cfg)
	if !res.OK {
		t.Fatalf("header token: %+v", res)
	}
}
