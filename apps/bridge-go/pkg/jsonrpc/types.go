// Package jsonrpc provides NDJSON JSON-RPC 2.0 framing helpers used by the
// ACP stdio transport. Timeline reduce is intentionally out of scope.
package jsonrpc

import "encoding/json"

// Message is a generic JSON-RPC envelope for classify/decode.
// Keys follow the JSON-RPC 2.0 wire shape (jsonrpc, id, method, params, result, error).
type Message map[string]any

// Error is the error object on a JSON-RPC response.
// Code is a JSON-RPC / application error code; Message is human-readable;
// Data is optional structured detail (may be nil).
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// AsRawMessage marshals v to json.RawMessage; returns nil on marshal failure.
// Useful when a caller needs to stash an opaque payload without panicking.
func AsRawMessage(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
