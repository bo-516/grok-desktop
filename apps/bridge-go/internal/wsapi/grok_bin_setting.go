package wsapi

import (
	"os"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
)

// grokBinSnapshot is the `grok_bin` reply body: what is saved, what overrides
// it, and what the bridge would run right now.
type grokBinSnapshot struct {
	// CustomPath is the saved custom path; "" when auto-detecting.
	CustomPath string `json:"customPath"`
	// EnvOverride is GROK_BIN from the bridge environment; when non-empty it
	// wins over CustomPath, and the UI says so.
	EnvOverride string `json:"envOverride"`
	// ResolvedPath is the binary new sessions would use; "" when none.
	ResolvedPath string `json:"resolvedPath"`
	// Source is the rule that produced ResolvedPath (grokbin.Source*).
	Source string `json:"source"`
	// ResolveError explains why nothing resolved; "" when ResolvedPath is set.
	ResolveError string `json:"resolveError"`
}

// readGrokBinSnapshot captures the current setting and resolution.
//
// @returns A fresh snapshot (reads the settings file and runs Locate; no exec).
func readGrokBinSnapshot() grokBinSnapshot {
	snap := grokBinSnapshot{CustomPath: grokbin.LoadCustomBin(), EnvOverride: os.Getenv("GROK_BIN")}
	loc, err := grokbin.Locate()
	if err != nil {
		snap.ResolveError = err.Error()
		return snap
	}
	snap.ResolvedPath = loc.Path
	snap.Source = string(loc.Source)
	return snap
}

// handleGrokBinGet answers `grok_bin_get` {requestId} with
// `grok_bin` {requestId, ok: true, setting}.
//
// @param ws Requesting socket.
// @param msg Raw client frame; requestId is echoed for correlation.
// @returns Always nil.
func (h *Handlers) handleGrokBinGet(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	h.Send(ws, map[string]any{
		"type": "grok_bin", "requestId": requestID, "ok": true, "setting": readGrokBinSnapshot(),
	})
	return nil
}

// handleGrokBinSet answers `grok_bin_set` {requestId, path}: validates and
// saves the custom grok path ("" clears it) and replies with `grok_bin`.
// The saved path applies to the next spawn and probe (Locate re-reads the
// file), so no restart is needed; running sessions keep their process.
// On a rejected path ok=false, error says why, and nothing is saved.
//
// @param ws Requesting socket.
// @param msg Raw client frame; a missing path reads as "" (clear).
// @returns Always nil; failures ride inside the reply.
func (h *Handlers) handleGrokBinSet(ws *websocket.Conn, msg map[string]any) error {
	requestID, _ := msg["requestId"].(string)
	raw, _ := msg["path"].(string)
	reply := map[string]any{"type": "grok_bin", "requestId": requestID, "ok": true}
	if _, err := grokbin.SaveCustomBin(raw); err != nil {
		reply["ok"] = false
		reply["error"] = err.Error()
	}
	reply["setting"] = readGrokBinSnapshot()
	h.Send(ws, reply)
	return nil
}
