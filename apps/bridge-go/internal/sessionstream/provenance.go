package sessionstream

import (
	"strings"
	"sync"
)

// Kind is how a session id entered the bridge, asserted first-hand.
type Kind string

const (
	// KindStarted: session/new answered a client `start` (forceNew or no resume).
	KindStarted Kind = "started"
	// KindResumed: session/load of an existing id (client resume, restart,
	// crash recovery).
	KindResumed Kind = "resumed"
	// KindChild: a subagent_spawned / subagent_finished update on another
	// session's stream named this id as its child; ParentSessionID is that
	// session. Merely streaming through another session's process is NOT
	// enough (a fork created there could do the same), so it is not used.
	KindChild Kind = "child"
)

// DefaultRegistryMax bounds how many session ids the registry remembers.
const DefaultRegistryMax = 4096

// Provenance is the wire shape of the `provenance` field on frames.
type Provenance struct {
	// Kind is started / resumed / child.
	Kind Kind `json:"kind"`
	// ParentSessionID is set for children (and kept as lineage when a child
	// is later resumed on its own).
	ParentSessionID string `json:"parentSessionId,omitempty"`
	// StartID echoes the client-generated id of the `start` request that
	// created this session, so the requesting window can recognize its own
	// session without matching info text. Empty for resumes and children.
	StartID string `json:"startId,omitempty"`
}

// registryEntry is one remembered session.
type registryEntry struct {
	prov Provenance
}

// Registry remembers the provenance of session ids seen by this bridge.
// Bounded FIFO; safe for concurrent use.
type Registry struct {
	mu      sync.Mutex
	entries map[string]*registryEntry
	// order is insertion order for FIFO eviction.
	order []string
	// max caps len(entries).
	max int
}

// NewRegistry builds an empty registry; max <= 0 selects DefaultRegistryMax.
func NewRegistry(max int) *Registry {
	if max <= 0 {
		max = DefaultRegistryMax
	}
	return &Registry{entries: map[string]*registryEntry{}, max: max}
}

// entryLocked returns (creating if needed) the entry for id. Caller holds mu.
func (r *Registry) entryLocked(id string) *registryEntry {
	if e := r.entries[id]; e != nil {
		return e
	}
	e := &registryEntry{}
	r.entries[id] = e
	r.order = append(r.order, id)
	for len(r.entries) > r.max && len(r.order) > 0 {
		victim := r.order[0]
		r.order = r.order[1:]
		if victim != id {
			delete(r.entries, victim)
		}
	}
	return e
}

// ClaimPrimary records that a runtime owns sessionID as its own session.
// kind should be KindStarted or KindResumed; startID is the client start
// request id (may be empty). A known parent link is kept as lineage.
// No-op for an empty sessionID.
func (r *Registry) ClaimPrimary(sessionID string, kind Kind, startID string) {
	if sessionID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.entryLocked(sessionID)
	e.prov.Kind = kind
	e.prov.StartID = startID
}

// LinkChild records that childID belongs under parentID, from a
// subagent_spawned / subagent_finished update parentID's stream carried
// (the latest link wins; a child is only ever announced by its own parent).
// A primary claim keeps its kind — only the lineage is added.
// No-op when either id is empty or they are equal.
func (r *Registry) LinkChild(childID, parentID string) {
	if childID == "" || parentID == "" || childID == parentID {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.entryLocked(childID)
	e.prov.ParentSessionID = parentID
	if e.prov.Kind == "" {
		e.prov.Kind = KindChild
	}
}

// Lookup returns the provenance remembered for sessionID.
// ok is false for ids the bridge never started, resumed or linked.
func (r *Registry) Lookup(sessionID string) (Provenance, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.entries[sessionID]
	if e == nil || e.prov.Kind == "" {
		return Provenance{}, false
	}
	return e.prov, true
}

// Annotate adds msg["provenance"] for sessionID when known.
// Hydrate frames (state / replay_*) always carry it; live frames
// (session_update / session_lifecycle) carry it only for sessions with a
// parent, since children never receive a hydrate frame of their own.
func (r *Registry) Annotate(msg map[string]any, sessionID string, hydrate bool) {
	prov, ok := r.Lookup(sessionID)
	if !ok {
		return
	}
	if !hydrate && prov.ParentSessionID == "" {
		return
	}
	msg["provenance"] = prov
}

// SubagentChildID extracts the child session id named by a
// subagent_spawned / subagent_finished update (child_session_id, else
// subagent_id — grok-build reuses the subagent id as the child session id).
// Returns "" for any other update.
func SubagentChildID(update map[string]any) string {
	kind, _ := update["sessionUpdate"].(string)
	if kind != "subagent_spawned" && kind != "subagent_finished" {
		return ""
	}
	for _, key := range []string{"child_session_id", "childSessionId", "subagent_id", "subagentId"} {
		if v, ok := update[key].(string); ok {
			if t := strings.TrimSpace(v); t != "" {
				return t
			}
		}
	}
	return ""
}
