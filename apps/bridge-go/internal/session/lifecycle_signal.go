package session

import (
	"fmt"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
)

// lifecycleFingerprint is the slice of session state that changes the rail
// and composer chrome. Timeline body is excluded: Go does not reduce it, so
// comparing it would either no-op or force empty full-state paints.
type lifecycleFingerprint struct {
	// status is the ACP session status (idle, streaming, …).
	status acp.SessionStatus
	// permKey identifies a pending permission. Empty means none is showing.
	permKey string
	// model is the selected model id.
	model string
	// mode is the selected mode id.
	mode string
	// id is the ACP session id. A change means a different session focused.
	id string
}

// lifecycleFP builds the fingerprint for one snapshot.
// A nil pending permission yields an empty permKey. A permission whose
// tool call lacks toolCallId still keys on the request id alone.
//
// @param session Latest snapshot. Zero value is a valid "nothing yet" print.
// @returns Comparable fingerprint. Never nil-panics on a missing permission.
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

// lifecycleChanged reports whether the UI must hear about next.
// A nil prev means the first snapshot for that session and always changes.
//
// @param prev Previous fingerprint, or nil when none was stored.
// @param next Fingerprint just observed.
// @returns True when any tracked field differs.
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
//
// Both frames ride the owning runtime's stream (stamped epoch/seq) via
// relayPoolFocus; the trailing info frame and pool broadcast do not.
//
// @param deps Broadcast and BroadcastPool must be non-nil.
// @param session Resident snapshot. Empty timeline takes the lifecycle path.
// @param info Optional info-frame text. Empty skips that frame.
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
