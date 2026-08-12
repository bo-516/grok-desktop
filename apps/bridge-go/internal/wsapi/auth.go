package wsapi

import (
	"net/http"

	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/bridgeauth"
)

// WsAuthConfig is injectable auth configuration for the bridge.
// Alias of bridgeauth.Config (Token + AllowedOrigins).
type WsAuthConfig = bridgeauth.Config

// WsAuthResult is the outcome of validating an inbound WS upgrade.
// Alias of bridgeauth.Result (OK / Reason / Status).
type WsAuthResult = bridgeauth.Result

// ResolveListenPort parses BRIDGE_PORT / CLI value; empty or invalid → defaultPort.
func ResolveListenPort(raw string, defaultPort int) int {
	return bridgeauth.ResolveListenPort(raw, defaultPort)
}

// ResolveBridgeToken returns env token when set, otherwise a random secret.
func ResolveBridgeToken(envToken string) string {
	return bridgeauth.ResolveBridgeToken(envToken)
}

// ResolveAllowedOrigins parses comma-separated Origin allow-list.
func ResolveAllowedOrigins(raw string) []string {
	return bridgeauth.ResolveAllowedOrigins(raw)
}

// ExtractTokenFromRequest reads token from query, X-Bridge-Token, or Authorization Bearer.
func ExtractTokenFromRequest(r *http.Request) string {
	return bridgeauth.ExtractTokenFromRequest(r)
}

// IsOriginAllowed reports whether Origin may connect.
func IsOriginAllowed(origin string, allowed []string) bool {
	return bridgeauth.IsOriginAllowed(origin, allowed)
}

// AuthorizeWsConnection validates token + Origin for an inbound WebSocket upgrade.
func AuthorizeWsConnection(r *http.Request, config WsAuthConfig) WsAuthResult {
	return bridgeauth.AuthorizeConnection(r, config)
}

// BridgeWsURL builds the public WS URL clients should use (token in query).
func BridgeWsURL(port int, token, host string) string {
	return bridgeauth.BridgeWsURL(port, token, host)
}
