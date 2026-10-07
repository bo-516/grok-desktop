package wsapi

import (
	"path/filepath"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// readModelCatalog answers `read_model_catalog` with `model_catalog`.
// The probe can take tens of seconds, so it runs off the socket read loop.
// Send is safe from this goroutine (per-connection write mutex). A failure is
// reported on model_catalog, not as a broadcast error, so a slow initialize
// does not look like a session crash. Does not call session/new.
func (h *Handlers) readModelCatalog(ws *websocket.Conn, msg map[string]any) {
	requestID, _ := msg["requestId"].(string)
	cwd := h.State.DefaultListCwd
	if cwd == "" {
		cwd = h.DefaultCwd
	}
	if c, ok := msg["cwd"].(string); ok && c != "" {
		if abs, err := filepath.Abs(c); err == nil {
			cwd = abs
		}
	}
	go func() {
		snap, err := session.ReadModelCatalog(h.Pool, cwd)
		if err != nil {
			h.Send(ws, map[string]any{
				"type":      "model_catalog",
				"requestId": requestID,
				"ok":        false,
				"error":     err.Error(),
			})
			return
		}
		h.Send(ws, map[string]any{
			"type":            "model_catalog",
			"requestId":       requestID,
			"ok":              true,
			"model":           snap.Model,
			"availableModels": snap.AvailableModels,
			"configOptions":   snap.ConfigOptions,
		})
	}()
}
