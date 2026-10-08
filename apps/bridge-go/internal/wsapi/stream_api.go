package wsapi

import (
	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

// Session stream protocol (see internal/sessionstream):
//
//	bridge → UI  session_update / session_lifecycle / state / replay_begin /
//	             replay_end broadcasts carry `epoch` + `seq` (per session and
//	             runtime, starting at 1). Hydrate frames (and child live
//	             frames) also carry `provenance`.
//	bridge → UI  point-to-point `state` snapshots (get_state, connect) carry
//	             `epoch` + `headSeq` (the stream position they reflect).
//	UI → bridge  {type:"resync", sessionId, epoch, fromSeq}
//	bridge → UI  {type:"resync_result", sessionId, status, epoch, fromSeq,
//	             headSeq, latestEpoch?, latestHeadSeq?, frames?}
//	             status ok → frames after fromSeq, verbatim; too_old /
//	             epoch_mismatch → client falls back to get_state.

// handleResync answers one `resync` request from the ring. The reply is
// written while the stream lock is held, so it reaches this client before
// any newer live frame of that stream. Without a hub (never in production)
// every request answers epoch_mismatch so the client takes the full path.
// Malformed fields read as zero values: empty ids → epoch_mismatch,
// non-numeric fromSeq → 0 (replay everything retained).
func (h *Handlers) handleResync(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	epoch, _ := msg["epoch"].(string)
	var fromSeq int64
	if v, ok := msg["fromSeq"].(float64); ok {
		fromSeq = int64(v)
	}
	reply := func(res sessionstream.ResyncResult) {
		out := map[string]any{
			"type":      "resync_result",
			"sessionId": sessionID,
			"status":    res.Status,
			"epoch":     res.Epoch,
			"fromSeq":   res.FromSeq,
			"headSeq":   res.HeadSeq,
		}
		if res.LatestEpoch != "" {
			out["latestEpoch"] = res.LatestEpoch
			out["latestHeadSeq"] = res.LatestHeadSeq
		}
		if res.Status == sessionstream.ResyncOK {
			out["frames"] = res.Frames
		}
		h.Send(ws, out)
	}
	if h.Streams == nil {
		reply(sessionstream.ResyncResult{
			Status: sessionstream.ResyncEpochMismatch, Epoch: sessionstream.Epoch(epoch), FromSeq: fromSeq,
		})
		return nil
	}
	h.Streams.Resync(sessionID, sessionstream.Epoch(epoch), fromSeq, reply)
	return nil
}

// sendStateSnapshot sends a point-to-point `state` hydrate for one session,
// stamped with the stream position it reflects (`epoch` + `headSeq`) and the
// bridge-asserted `provenance`, written under the stream lock so no live
// frame of that stream can overtake it on this socket. Without a hub (or for
// a session with no live stream) the frame goes out unstamped as before.
func (h *Handlers) sendStateSnapshot(ws *websocket.Conn, session acp.SessionState) {
	if h.Streams == nil || session.ID == "" {
		h.Send(ws, map[string]any{"type": "state", "session": session})
		return
	}
	h.Streams.WithHead(session.ID, func(epoch sessionstream.Epoch, headSeq int64) {
		msg := map[string]any{"type": "state", "session": session}
		if epoch != "" {
			msg["epoch"] = epoch
			msg["headSeq"] = headSeq
		}
		h.Streams.Provenance.Annotate(msg, session.ID, true)
		h.Send(ws, msg)
	})
}
