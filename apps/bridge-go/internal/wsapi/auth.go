// Package wsapi implements the bridge WebSocket server, token/Origin auth,
// and client message routing (relay freeze protocol).
package wsapi

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// WsAuthConfig is injectable auth configuration for the bridge.
type WsAuthConfig struct {
	// Token is the shared secret required on every connection.
	Token string
	// AllowedOrigins is the Origin allow-list; missing Origin is accepted for non-browser clients.
	AllowedOrigins []string
}

// WsAuthResult is the outcome of validating an inbound WS upgrade.
type WsAuthResult struct {
	OK     bool
	Reason string
	Status int
}

// ResolveListenPort parses BRIDGE_PORT / CLI value; empty or invalid → defaultPort.
// Port 0 means OS-assigned ephemeral.
func ResolveListenPort(raw string, defaultPort int) int {
	if raw == "" {
		return defaultPort
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 65535 {
		return defaultPort
	}
	return n
}

// ResolveBridgeToken returns env token when set, otherwise a random secret.
func ResolveBridgeToken(envToken string) string {
	trimmed := strings.TrimSpace(envToken)
	if trimmed != "" {
		return trimmed
	}
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ResolveAllowedOrigins parses comma-separated Origin allow-list.
// Default includes Vite dev + null/file for packaged shells.
func ResolveAllowedOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:4173",
			"http://127.0.0.1:4173",
			"null",
			"file://",
		}
	}
	seen := map[string]bool{}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimSpace(part)
		if o == "" || seen[o] {
			continue
		}
		seen[o] = true
		out = append(out, o)
	}
	return out
}

// ExtractTokenFromRequest reads token from query, X-Bridge-Token, or Authorization Bearer.
func ExtractTokenFromRequest(r *http.Request) string {
	if r.URL != nil {
		if q := r.URL.Query().Get("token"); q != "" {
			return q
		}
	}
	// Also parse raw URL if RequestURI has query but URL was rewritten.
	if r.RequestURI != "" {
		if u, err := url.ParseRequestURI(r.RequestURI); err == nil {
			if q := u.Query().Get("token"); q != "" {
				return q
			}
		}
	}
	if h := strings.TrimSpace(r.Header.Get("X-Bridge-Token")); h != "" {
		return h
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(auth) > 7 && strings.EqualFold(auth[:7], "Bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
}

// IsOriginAllowed reports whether Origin may connect.
// Missing Origin (non-browser: curl, Node ws) is accepted when token is valid.
func IsOriginAllowed(origin string, allowed []string) bool {
	if origin == "" {
		return true
	}
	for _, a := range allowed {
		if a == origin {
			return true
		}
	}
	// file:// origins may include a path suffix depending on the engine.
	if strings.HasPrefix(origin, "file:") {
		for _, a := range allowed {
			if a == "file://" {
				return true
			}
		}
	}
	return false
}

// AuthorizeWsConnection validates token + Origin for an inbound WebSocket upgrade.
func AuthorizeWsConnection(r *http.Request, config WsAuthConfig) WsAuthResult {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin, config.AllowedOrigins) {
		o := origin
		if o == "" {
			o = "(missing)"
		}
		return WsAuthResult{OK: false, Reason: "origin not allowed: " + o, Status: 403}
	}
	token := ExtractTokenFromRequest(r)
	if token == "" {
		return WsAuthResult{OK: false, Reason: "missing bridge token", Status: 401}
	}
	if token != config.Token {
		return WsAuthResult{OK: false, Reason: "invalid bridge token", Status: 401}
	}
	return WsAuthResult{OK: true}
}

// BridgeWsURL builds the public WS URL clients should use (token in query).
func BridgeWsURL(port int, token, host string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	return "ws://" + host + ":" + strconv.Itoa(port) + "?token=" + url.QueryEscape(token)
}
