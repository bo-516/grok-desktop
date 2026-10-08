package session

import (
	"sync"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

// runtimeStream is the relay identity of one runtime spawned by StartOrResume:
// its epoch, which session it owns (primary), and how that session came to be.
// Every per-session frame the runtime relays goes through relay() so it is
// stamped with (epoch, seq) and annotated with bridge-asserted provenance.
//
// With deps.Streams nil (unit tests that build LifecycleDeps by hand) relay
// falls back to plain deps.Broadcast and the provenance calls are no-ops.
type runtimeStream struct {
	// deps carries Broadcast and the optional stream hub.
	deps LifecycleDeps
	// epoch is this runtime's frame source id ("" without a hub).
	epoch sessionstream.Epoch
	// resumeID is the session/load target ("" for session/new).
	resumeID string
	// startID is the client `start` request id echoed in provenance.
	startID string
	// mu guards bound.
	mu sync.Mutex
	// bound is the primary id whose provenance/epoch binding was recorded.
	bound string
}

// newRuntimeStream allocates an epoch for a runtime about to spawn.
// resumeID / startID come from the start request (either may be empty).
func newRuntimeStream(deps LifecycleDeps, resumeID, startID string) *runtimeStream {
	rs := &runtimeStream{deps: deps, resumeID: resumeID, startID: startID}
	if deps.Streams != nil {
		rs.epoch = deps.Streams.NewEpoch()
	}
	return rs
}

// notePrimary records the runtime's own session id from a state snapshot and,
// the first time each id is seen, claims its provenance (resumed when it
// matches the session/load target, otherwise started) and binds the epoch to
// it. Cheap on repeat calls (OnState fires per update). Empty ids are ignored.
func (rs *runtimeStream) notePrimary(sessionID string) {
	if sessionID == "" {
		return
	}
	rs.mu.Lock()
	if rs.bound == sessionID {
		rs.mu.Unlock()
		return
	}
	rs.bound = sessionID
	rs.mu.Unlock()
	if rs.deps.Streams == nil {
		return
	}
	kind := sessionstream.KindStarted
	startID := rs.startID
	if rs.resumeID != "" && sessionID == rs.resumeID {
		kind = sessionstream.KindResumed
		startID = ""
	}
	rs.deps.Streams.Provenance.ClaimPrimary(sessionID, kind, startID)
	rs.deps.Streams.BindPrimary(sessionID, rs.epoch)
}

// noteUpdate records child links before a session_update is relayed: a
// subagent_spawned / subagent_finished update names a child of the session
// it arrived on (nested children are named by their own parent's stream).
// A frame that merely streams through this runtime under another id is not
// treated as a child — a session forked in this process could look the same.
func (rs *runtimeStream) noteUpdate(update map[string]any, sessionID string) {
	if rs.deps.Streams == nil || sessionID == "" {
		return
	}
	if child := sessionstream.SubagentChildID(update); child != "" {
		rs.deps.Streams.Provenance.LinkChild(child, sessionID)
	}
}

// relay publishes one per-session frame of this runtime: annotate with
// provenance (hydrate frames always, live frames only for children), then
// stamp (epoch, seq) and fan out. Empty sessionID or no hub → plain broadcast.
func (rs *runtimeStream) relay(sessionID string, msg map[string]any, hydrate bool) {
	publishSessionFrame(rs.deps, rs.epoch, sessionID, msg, hydrate)
}

// drop releases this runtime's streams (call when the runtime is disposed or
// never made it into the pool).
func (rs *runtimeStream) drop() {
	if rs.deps.Streams != nil && rs.epoch != "" {
		rs.deps.Streams.DropEpoch(rs.epoch)
	}
}

// publishSessionFrame is the shared stamp-and-send path for per-session
// frames. epoch "" (or a nil hub / empty session id) sends unstamped through
// deps.Broadcast, which keeps legacy callers and tests working unchanged.
func publishSessionFrame(
	deps LifecycleDeps,
	epoch sessionstream.Epoch,
	sessionID string,
	msg map[string]any,
	hydrate bool,
) {
	if deps.Streams == nil || sessionID == "" {
		deps.Broadcast(msg)
		return
	}
	deps.Streams.Provenance.Annotate(msg, sessionID, hydrate)
	if epoch == "" {
		deps.Broadcast(msg)
		return
	}
	deps.Streams.Publish(sessionID, epoch, msg)
}

// relayPoolFocus publishes a pool-hit focus frame for a resident session on
// its owning runtime's stream (looked up by session id, since the pool
// entry does not carry the epoch).
func relayPoolFocus(deps LifecycleDeps, sessionID string, msg map[string]any, hydrate bool) {
	var epoch sessionstream.Epoch
	if deps.Streams != nil {
		epoch = deps.Streams.PrimaryEpoch(sessionID)
	}
	publishSessionFrame(deps, epoch, sessionID, msg, hydrate)
}
