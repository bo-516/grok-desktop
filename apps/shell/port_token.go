package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
)

// PickFreePort binds 127.0.0.1:0 briefly and returns the OS-assigned port.
// The listener is closed before return so the bridge can re-bind the same port
// (race is acceptable for local desktop; bridge start fails loudly if stolen).
func PickFreePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("pick free port: %w", err)
	}
	defer ln.Close()
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || addr.Port <= 0 {
		return 0, fmt.Errorf("pick free port: unexpected addr %v", ln.Addr())
	}
	return addr.Port, nil
}

// GenerateToken returns a cryptographically random base64url token (24 bytes → ~32 chars).
// Used as BRIDGE_TOKEN so only the shell-injected UI can open the bridge WebSocket.
func GenerateToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// BridgeWSURL builds the browser WebSocket URL with token query param.
// host should be 127.0.0.1 for loopback; token is URL-encoded by the caller path
// via raw query assembly (token is base64url so no special chars).
func BridgeWSURL(host string, port int, token string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("ws://%s:%d?token=%s", host, port, token)
}
