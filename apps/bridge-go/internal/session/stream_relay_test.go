package session

import (
	"encoding/json"
	"sync"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

// relayRig wires LifecycleDeps to a real hub plus recorders for the stamped
// (hub) and unstamped (Broadcast) paths.
type relayRig struct {
	deps      LifecycleDeps
	mu        sync.Mutex
	stamped   []map[string]any
	broadcast []map[string]any
}

// newRelayRig builds the rig; withHub false leaves deps.Streams nil.
func newRelayRig(t *testing.T, withHub bool) *relayRig {
	t.Helper()
	r := &relayRig{}
	r.deps = LifecycleDeps{
		Broadcast: func(msg map[string]any) {
			r.mu.Lock()
			r.broadcast = append(r.broadcast, msg)
			r.mu.Unlock()
		},
		BroadcastPool: func() {},
	}
	if withHub {
		r.deps.Streams = sessionstream.NewHub(sessionstream.Config{}, func(raw []byte) {
			var m map[string]any
			if err := json.Unmarshal(raw, &m); err != nil {
				t.Errorf("bad frame: %v", err)
			}
			r.mu.Lock()
			r.stamped = append(r.stamped, m)
			r.mu.Unlock()
		})
	}
	return r
}

// last returns the newest stamped frame.
func (r *relayRig) last(t *testing.T) map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.stamped) == 0 {
		t.Fatal("no stamped frame")
	}
	return r.stamped[len(r.stamped)-1]
}

func TestRuntimeStreamClaimsStartedWithStartID(t *testing.T) {
	rig := newRelayRig(t, true)
	rs := newRuntimeStream(rig.deps, "", "start-42")
	rs.notePrimary("new-1")
	rs.relay("new-1", map[string]any{"type": "state", "session": map[string]any{"id": "new-1"}}, true)

	f := rig.last(t)
	prov, _ := f["provenance"].(map[string]any)
	if prov["kind"] != "started" || prov["startId"] != "start-42" {
		t.Fatalf("provenance = %v", f["provenance"])
	}
	if f["seq"] != float64(1) || f["epoch"] != string(rs.epoch) {
		t.Fatalf("stamp = %v/%v", f["epoch"], f["seq"])
	}
	if rig.deps.Streams.PrimaryEpoch("new-1") != rs.epoch {
		t.Fatal("primary epoch must be bound")
	}
}

func TestRuntimeStreamClaimsResumedForLoadTarget(t *testing.T) {
	rig := newRelayRig(t, true)
	rs := newRuntimeStream(rig.deps, "old-1", "start-ignored")
	rs.notePrimary("old-1")
	p, ok := rig.deps.Streams.Provenance.Lookup("old-1")
	if !ok || p.Kind != sessionstream.KindResumed || p.StartID != "" {
		t.Fatalf("resume provenance = %+v", p)
	}
	// Handshake fell back to session/new under a different id.
	rs.notePrimary("fresh-2")
	if p, _ := rig.deps.Streams.Provenance.Lookup("fresh-2"); p.Kind != sessionstream.KindStarted {
		t.Fatalf("fallback id must be started, got %+v", p)
	}
}

func TestRuntimeStreamLinksOnlyAnnouncedChildren(t *testing.T) {
	rig := newRelayRig(t, true)
	rs := newRuntimeStream(rig.deps, "", "")
	rs.notePrimary("parent")

	// A frame streaming through this process under another id (no spawn
	// notice) is not asserted as a child — a fork could look the same.
	rs.noteUpdate(map[string]any{"sessionUpdate": "agent_message_chunk"}, "kid-a")
	rs.relay("kid-a", map[string]any{"type": "session_update", "sessionId": "kid-a"}, false)
	if _, ok := rig.last(t)["provenance"]; ok {
		t.Fatal("unannounced id must not carry provenance")
	}

	// Explicit spawn notice on the parent stream links it.
	spawn := map[string]any{"sessionUpdate": "subagent_spawned", "subagent_id": "kid-a"}
	rs.noteUpdate(spawn, "parent")
	rs.relay("kid-a", map[string]any{"type": "session_update", "sessionId": "kid-a"}, false)

	reg := rig.deps.Streams.Provenance
	if p, _ := reg.Lookup("kid-a"); p.Kind != sessionstream.KindChild || p.ParentSessionID != "parent" {
		t.Fatalf("kid-a = %+v", p)
	}
	f := rig.last(t)
	prov, _ := f["provenance"].(map[string]any)
	if prov["kind"] != "child" || prov["parentSessionId"] != "parent" {
		t.Fatalf("child live frame provenance = %v", f["provenance"])
	}
	// Primary live frames stay lean.
	rs.relay("parent", map[string]any{"type": "session_update", "sessionId": "parent"}, false)
	if _, ok := rig.last(t)["provenance"]; ok {
		t.Fatal("primary session_update must not carry provenance")
	}
}

func TestRuntimeStreamDropRetiresEpoch(t *testing.T) {
	rig := newRelayRig(t, true)
	rs := newRuntimeStream(rig.deps, "", "")
	rs.notePrimary("s1")
	rs.relay("s1", map[string]any{"type": "session_update", "sessionId": "s1"}, false)
	rs.drop()
	if rig.deps.Streams.PrimaryEpoch("s1") != "" {
		t.Fatal("drop must clear the primary binding")
	}
	rs.relay("s1", map[string]any{"type": "session_update", "sessionId": "s1"}, false)
	if _, ok := rig.last(t)["seq"]; ok {
		t.Fatal("frames after drop must go out unstamped")
	}
}

func TestRelayWithoutHubFallsBackToBroadcast(t *testing.T) {
	rig := newRelayRig(t, false)
	rs := newRuntimeStream(rig.deps, "", "")
	rs.notePrimary("s1")
	rs.noteUpdate(map[string]any{"sessionUpdate": "subagent_spawned", "subagent_id": "k"}, "s1")
	rs.relay("s1", map[string]any{"type": "session_update", "sessionId": "s1"}, false)
	relayPoolFocus(rig.deps, "s1", map[string]any{"type": "session_lifecycle", "sessionId": "s1"}, false)
	rs.drop()
	if len(rig.broadcast) != 2 {
		t.Fatalf("want 2 plain broadcasts, got %d", len(rig.broadcast))
	}
	for _, m := range rig.broadcast {
		if _, ok := m["seq"]; ok {
			t.Fatalf("no hub → no seq: %v", m)
		}
	}
}

func TestPoolFocusRidesOwningRuntimeStream(t *testing.T) {
	rig := newRelayRig(t, true)
	rs := newRuntimeStream(rig.deps, "", "")
	rs.notePrimary("s1")
	rs.relay("s1", map[string]any{"type": "session_update", "sessionId": "s1"}, false)
	relayPoolFocus(rig.deps, "s1", map[string]any{"type": "session_lifecycle", "sessionId": "s1"}, false)
	f := rig.last(t)
	if f["type"] != "session_lifecycle" || f["seq"] != float64(2) || f["epoch"] != string(rs.epoch) {
		t.Fatalf("pool focus frame = %v", f)
	}
	// A session with no runtime of its own goes out unstamped.
	relayPoolFocus(rig.deps, "ghost", map[string]any{"type": "session_lifecycle", "sessionId": "ghost"}, false)
	if len(rig.broadcast) != 1 {
		t.Fatalf("ghost focus must use plain broadcast, got %d", len(rig.broadcast))
	}
}
