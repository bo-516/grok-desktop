package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestBridgeURLInjectMiddleware_InsertsHeadScript rewrites HTML index with the bridge global.
func TestBridgeURLInjectMiddleware_InsertsHeadScript(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`))
	})
	h := BridgeURLInjectMiddleware("ws://127.0.0.1:9?token=abc")(inner)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "window.__GROK_BRIDGE_URL__=") {
		t.Fatalf("inject missing: %s", body)
	}
	// Must appear before the module script.
	inj := strings.Index(body, "__GROK_BRIDGE_URL__")
	mod := strings.Index(body, `type="module"`)
	if inj < 0 || mod < 0 || inj > mod {
		t.Fatalf("inject must precede module script: inj=%d mod=%d body=%s", inj, mod, body)
	}
	if !strings.Contains(body, "ws://127.0.0.1:9?token=abc") {
		t.Fatalf("url missing: %s", body)
	}
}

// TestBridgeURLInjectMiddleware_SkipsAssets leaves non-HTML alone.
func TestBridgeURLInjectMiddleware_SkipsAssets(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = w.Write([]byte("console.log(1)"))
	})
	h := BridgeURLInjectMiddleware("ws://x")(inner)
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), "__GROK_BRIDGE_URL__") {
		t.Fatal("should not inject into JS assets")
	}
	if rec.Body.String() != "console.log(1)" {
		t.Fatalf("body mutated: %q", rec.Body.String())
	}
}
