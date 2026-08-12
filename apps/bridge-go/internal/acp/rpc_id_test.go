package acp

import (
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/jsonrpc"
)

// rpcIDKey lives on the client; codec numbers decode as float64 so this
// normalization must keep working after the jsonrpc package split.
func TestRpcIDKeyNormalizesJSONNumber(t *testing.T) {
	resp := jsonrpc.DecodeLine(jsonrpc.EncodeMessage(map[string]any{
		"jsonrpc": "2.0",
		"id":      3,
		"result":  map[string]any{"ok": true},
	}))
	k := jsonrpc.ClassifyMessage(resp.Message)
	if rpcIDKey(k.ID) != 3 {
		t.Fatalf("rpcIDKey(%T %v) = %v want 3", k.ID, k.ID, rpcIDKey(k.ID))
	}
}
