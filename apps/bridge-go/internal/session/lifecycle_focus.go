package session

// Lifecycle fingerprinting and pool-focus frames, moved out of lifecycle.go
// to keep that file under the size limit. Behavior is unchanged except that
// focus frames now ride the owning runtime's stream (see stream_relay.go).

import (
	"fmt"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

// lifecycleFingerprint is the subset of SessionState whose change warrants a
// lifecycle (or full state) frame.
type lifecycleFingerprint struct {
	status  acp.SessionStatus
	permKey string
	model   string
	mode    string
	id      string
}

// lifecycleFP fingerprints a snapshot; the pending permission is keyed by
// request id + tool call id so a new prompt for the same tool still differs.
func lifecycleFP(session acp.SessionState) lifecycleFingerprint {
	permKey := ""
	if session.PendingPermission != nil {
		tcID := ""
		if session.PendingPermission.ToolCall != nil {
			if v, ok := session.PendingPermission.ToolCall["toolCallId"].(string); ok {
				tcID = v
			}
		}
		permKey = fmt.Sprintf("%v:%s", session.PendingPermission.RequestID, tcID)
	}
	return lifecycleFingerprint{
		status: session.Status, permKey: permKey,
		model: session.Model, mode: session.Mode, id: session.ID,
	}
}

// lifecycleChanged reports whether next differs from prev (nil prev = first
// snapshot, always a change).
func lifecycleChanged(prev *lifecycleFingerprint, next lifecycleFingerprint) bool {
	if prev == nil {
		return true
	}
	return prev.status != next.status ||
		prev.permKey != next.permKey ||
		prev.model != next.model ||
		prev.mode != next.mode ||
		prev.id != next.id
}

// broadcastPoolFocus tells the UI a resident session is focused without wiping
// client-side timeline. Go SessionState.timeline is always empty, so a full
// `state` hydrate on pool hit blanks catalog-seeded history after refresh.
// Prefer session_lifecycle (+ info) unless the snapshot somehow carries body.
// Both frames ride the owning runtime's stream (stamped epoch/seq).
func broadcastPoolFocus(deps LifecycleDeps, session acp.SessionState, info string) {
	if len(session.Timeline) > 0 {
		relayPoolFocus(deps, session.ID, map[string]any{"type": "state", "session": session}, true)
	} else {
		msg := map[string]any{
			"type":      "session_lifecycle",
			"sessionId": session.ID,
			"status":    session.Status,
			"model":     session.Model,
			"mode":      session.Mode,
		}
		if session.PendingPermission != nil {
			msg["pendingPermission"] = session.PendingPermission
		} else {
			msg["pendingPermission"] = nil
		}
		relayPoolFocus(deps, session.ID, msg, false)
	}
	if info != "" {
		deps.Broadcast(map[string]any{
			"type": "info", "message": info, "sessionId": session.ID,
		})
	}
	deps.BroadcastPool()
}
