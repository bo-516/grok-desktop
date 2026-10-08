package sessionstream_test

import (
	"encoding/json"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

// resync runs Hub.Resync and returns the single reply.
func resync(t *testing.T, hub *sessionstream.Hub, sessionID string, epoch sessionstream.Epoch, fromSeq int64) sessionstream.ResyncResult {
	t.Helper()
	var got *sessionstream.ResyncResult
	hub.Resync(sessionID, epoch, fromSeq, func(res sessionstream.ResyncResult) {
		if got != nil {
			t.Fatal("reply called twice")
		}
		got = &res
	})
	if got == nil {
		t.Fatal("reply never called")
	}
	return *got
}

func TestResyncReplaysFramesVerbatimAfterFromSeq(t *testing.T) {
	hub, clients := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	for i := 0; i < 5; i++ {
		hub.Publish("s1", epoch, update("s1", i))
	}
	res := resync(t, hub, "s1", epoch, 2)
	if res.Status != sessionstream.ResyncOK || res.HeadSeq != 5 || len(res.Frames) != 3 {
		t.Fatalf("status=%s head=%d frames=%d", res.Status, res.HeadSeq, len(res.Frames))
	}
	live := clients[0].frames
	for i, f := range res.Frames {
		if string(f) != string(live[2+i]) {
			t.Fatalf("frame %d not byte-identical:\n%s\n%s", i, f, live[2+i])
		}
	}
	if res.LatestEpoch != epoch || res.LatestHeadSeq != 5 {
		t.Fatalf("latest = %q/%d", res.LatestEpoch, res.LatestHeadSeq)
	}
	// The wire shape embeds frames as JSON objects, not strings.
	raw, _ := json.Marshal(res)
	var shape struct {
		Frames []map[string]any `json:"frames"`
	}
	if err := json.Unmarshal(raw, &shape); err != nil || len(shape.Frames) != 3 {
		t.Fatalf("frames must marshal as objects: %s (%v)", raw, err)
	}
}

func TestResyncCurrentClientGetsEmptyOK(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{}, 1)
	epoch := hub.NewEpoch()
	hub.Publish("s1", epoch, update("s1", 0))
	res := resync(t, hub, "s1", epoch, 1)
	if res.Status != sessionstream.ResyncOK || len(res.Frames) != 0 || res.HeadSeq != 1 {
		t.Fatalf("status=%s frames=%d head=%d", res.Status, len(res.Frames), res.HeadSeq)
	}
}

func TestResyncTooOldAfterRingEviction(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{MaxFrames: 4}, 1)
	epoch := hub.NewEpoch()
	for i := 0; i < 10; i++ {
		hub.Publish("s1", epoch, update("s1", i))
	}
	// Ring holds 7..10; a client at 5 needs 6, which is gone.
	res := resync(t, hub, "s1", epoch, 5)
	if res.Status != sessionstream.ResyncTooOld || res.HeadSeq != 10 || res.Frames != nil {
		t.Fatalf("status=%s head=%d frames=%v", res.Status, res.HeadSeq, res.Frames)
	}
	// A client at 6 is exactly at the edge and can still be caught up.
	res = resync(t, hub, "s1", epoch, 6)
	if res.Status != sessionstream.ResyncOK || len(res.Frames) != 4 {
		t.Fatalf("edge: status=%s frames=%d", res.Status, len(res.Frames))
	}
}

func TestResyncTooOldWhenByteCapEvicts(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{MaxBytes: 300}, 1)
	epoch := hub.NewEpoch()
	for i := 0; i < 20; i++ {
		hub.Publish("s1", epoch, update("s1", i))
	}
	if res := resync(t, hub, "s1", epoch, 0); res.Status != sessionstream.ResyncTooOld {
		t.Fatalf("byte cap must evict early frames, got %s", res.Status)
	}
}

func TestResyncEpochMismatchPointsAtCurrentStream(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{}, 1)
	old := hub.NewEpoch()
	hub.Publish("s1", old, update("s1", 0))
	hub.DropEpoch(old) // runtime disposed (crash / restart)
	fresh := hub.NewEpoch()
	hub.BindPrimary("s1", fresh)
	hub.Publish("s1", fresh, update("s1", 1))
	hub.Publish("s1", fresh, update("s1", 2))

	res := resync(t, hub, "s1", old, 1)
	if res.Status != sessionstream.ResyncEpochMismatch {
		t.Fatalf("status=%s, want epoch_mismatch", res.Status)
	}
	if res.Epoch != old || res.LatestEpoch != fresh || res.LatestHeadSeq != 2 || res.Frames != nil {
		t.Fatalf("mismatch reply = %+v", res)
	}
	// Re-anchoring on the new epoch from 0 replays it whole.
	if res := resync(t, hub, "s1", fresh, 0); res.Status != sessionstream.ResyncOK || len(res.Frames) != 2 {
		t.Fatalf("fresh epoch replay: status=%s frames=%d", res.Status, len(res.Frames))
	}
}

func TestResyncUnknownSessionIsMismatchWithoutLatest(t *testing.T) {
	hub, _ := newHubWithClients(sessionstream.Config{}, 1)
	res := resync(t, hub, "nope", "x.1", 3)
	if res.Status != sessionstream.ResyncEpochMismatch || res.LatestEpoch != "" || res.FromSeq != 3 {
		t.Fatalf("unknown session reply = %+v", res)
	}
	if res := resync(t, hub, "nope", "x.1", -5); res.FromSeq != 0 {
		t.Fatalf("negative fromSeq must clamp to 0, got %d", res.FromSeq)
	}
}
