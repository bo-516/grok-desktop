package sessionstream

import "encoding/json"

// ResyncStatus is the outcome of a resync request.
type ResyncStatus string

const (
	// ResyncOK: Frames holds every retained frame after fromSeq (possibly none).
	ResyncOK ResyncStatus = "ok"
	// ResyncTooOld: frames after fromSeq were evicted from the ring; the
	// client must fall back to a full hydrate (get_state / session/load).
	ResyncTooOld ResyncStatus = "too_old"
	// ResyncEpochMismatch: the requested epoch has no live stream for the
	// session (runtime respawned, reloaded, closed, or the bridge restarted).
	// Latest* describe the session's current stream, when there is one.
	ResyncEpochMismatch ResyncStatus = "epoch_mismatch"
)

// ResyncResult answers one resync request. Field tags are the wire shape of
// the `resync_result` frame (minus `type` / `sessionId`, added by the caller).
type ResyncResult struct {
	// Status says whether Frames is usable.
	Status ResyncStatus `json:"status"`
	// Epoch echoes the requested epoch so the client can match its position.
	Epoch Epoch `json:"epoch"`
	// FromSeq echoes the requested position.
	FromSeq int64 `json:"fromSeq"`
	// HeadSeq is the requested stream's last seq (0 unless Status is ok/too_old).
	HeadSeq int64 `json:"headSeq"`
	// LatestEpoch is the session's snapshot epoch ("" when no live stream).
	LatestEpoch Epoch `json:"latestEpoch,omitempty"`
	// LatestHeadSeq is LatestEpoch's head seq.
	LatestHeadSeq int64 `json:"latestHeadSeq,omitempty"`
	// Frames are the retained frames after FromSeq, oldest first, byte-for-byte
	// as originally sent. Nil unless Status is ok.
	Frames []json.RawMessage `json:"frames,omitempty"`
}

// Resync replays the frames of stream (sessionID, epoch) after fromSeq.
//
// reply receives the result while the stream lock is held (ok / too_old), so
// a reply written to the requesting client lands before any newer live frame
// of that stream. reply must not call back into the hub. A negative fromSeq
// is treated as 0 (replay everything retained).
func (h *Hub) Resync(sessionID string, epoch Epoch, fromSeq int64, reply func(ResyncResult)) {
	if fromSeq < 0 {
		fromSeq = 0
	}
	h.mu.Lock()
	var st *stream
	if ss := h.sessions[sessionID]; ss != nil && epoch != "" {
		st = ss.byEpoch[epoch]
	}
	latest, latestSt := h.snapshotEpochLocked(sessionID)
	h.mu.Unlock()

	if st == nil {
		reply(h.mismatch(epoch, fromSeq, latest, latestSt))
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.dropped {
		reply(ResyncResult{Status: ResyncEpochMismatch, Epoch: epoch, FromSeq: fromSeq})
		return
	}
	res := ResyncResult{Epoch: epoch, FromSeq: fromSeq, HeadSeq: st.seq}
	if latestSt == st {
		res.LatestEpoch, res.LatestHeadSeq = latest, st.seq
	}
	frames, ok := st.ring.since(fromSeq)
	if !ok {
		res.Status = ResyncTooOld
		reply(res)
		return
	}
	res.Status = ResyncOK
	res.Frames = frames
	reply(res)
}

// mismatch builds an epoch_mismatch answer that points at the session's
// current stream (if any) so the client knows where the bridge is now.
// latestSt's head is read under its own lock.
func (h *Hub) mismatch(epoch Epoch, fromSeq int64, latest Epoch, latestSt *stream) ResyncResult {
	res := ResyncResult{Status: ResyncEpochMismatch, Epoch: epoch, FromSeq: fromSeq}
	if latestSt == nil {
		return res
	}
	latestSt.mu.Lock()
	if !latestSt.dropped {
		res.LatestEpoch, res.LatestHeadSeq = latest, latestSt.seq
	}
	latestSt.mu.Unlock()
	return res
}
