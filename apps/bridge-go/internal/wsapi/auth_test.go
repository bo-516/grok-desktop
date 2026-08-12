package wsapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Thin re-export smoke: full coverage lives in pkg/bridgeauth.
func TestAuthReexport(t *testing.T) {
	if ResolveListenPort("9000", 8765) != 9000 {
		t.Fatal("port")
	}
	if ResolveBridgeToken(" tok ") != "tok" {
		t.Fatal("token")
	}
	cfg := WsAuthConfig{Token: "secret", AllowedOrigins: []string{"http://localhost:5173"}}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/?token=secret", nil)
	res := AuthorizeWsConnection(req, cfg)
	if !res.OK {
		t.Fatalf("authorize: %+v", res)
	}
	if BridgeWsURL(1, "t", "") == "" {
		t.Fatal("url")
	}
}
