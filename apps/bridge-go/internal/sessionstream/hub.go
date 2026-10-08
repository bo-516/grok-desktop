// Package sessionstream gives every relayed per-session frame a bridge-owned
// position — (epoch, seq) — and keeps a bounded ring of recent frames so a
// client that missed some can be caught up (`resync`) instead of guessing.
//
// An epoch is one frame *source*: one agent runtime (grok process + ACP
// connection). Respawning or reloading a session (crash recovery,
// restart_session, a later resume) creates a new runtime and therefore a new
// epoch whose seq restarts at 1, so a seq restart is never ambiguous. A
// session may be fed by two sources at once (a subagent child streams through
// its parent's process while the user also opened it on its own), so streams
// are keyed by (sessionId, epoch) and each has its own monotonic seq.
//
// The timeline reduce stays in the UI (phase 1): frames are stored as the
// exact bytes sent to clients and replayed verbatim.
package sessionstream

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
)

// Epoch identifies one frame source (one agent runtime). Opaque to clients;
// unique across bridge restarts because it embeds a random boot id. The zero
// value "" means "no epoch" and disables stamping.
type Epoch string

// Default ring bounds per stream. A typical chunk is a few hundred bytes, so
// 1024 frames cover several seconds of fast streaming; the byte cap keeps a
// large replay_end or tool output from pinning memory.
const (
	DefaultMaxFrames = 1024
	DefaultMaxBytes  = 4 << 20
)

// Config bounds the per-stream ring. Zero values select the defaults.
type Config struct {
	// MaxFrames caps retained frames per (session, epoch) stream.
	MaxFrames int
	// MaxBytes caps the summed JSON bytes retained per stream.
	MaxBytes int
}

// stream is the ordered frame log of one (session, epoch) pair.
// mu serializes stamp + ring append + client write, so every connected
// client receives this stream's frames in seq order.
type stream struct {
	mu sync.Mutex
	// created orders streams of one session (newest wins "latest").
	created uint64
	// seq is the last stamped sequence number (0 before the first frame).
	seq int64
	// ring retains recent frames for resync.
	ring *frameRing
	// dropped is set once the epoch was dropped; later publishes go unstamped.
	dropped bool
}

// sessionStreams indexes every live stream of one session.
type sessionStreams struct {
	// byEpoch maps each live epoch feeding this session to its stream.
	byEpoch map[Epoch]*stream
	// primary is the epoch of the runtime whose own session this is ("" when
	// the session is only hosted, e.g. a subagent child).
	primary Epoch
}

// Hub owns all streams plus the provenance registry for one bridge process.
// Safe for concurrent use.
type Hub struct {
	// mu guards the maps below; never held while a stream lock is held.
	mu sync.Mutex
	// boot is a random per-process prefix so epochs never repeat across restarts.
	boot string
	// counter numbers epochs and stream creations.
	counter atomic.Uint64
	// cfg holds the validated ring bounds.
	cfg Config
	// write fans one encoded frame out to every connected client.
	write func(raw []byte)
	// sessions maps sessionId to its live streams.
	sessions map[string]*sessionStreams
	// epochSessions maps each live epoch to the sessions it has streamed.
	epochSessions map[Epoch]map[string]struct{}
	// live marks epochs handed out by NewEpoch and not yet dropped.
	live map[Epoch]struct{}
	// Provenance records how each session id entered the bridge.
	Provenance *Registry
}

// NewHub builds a hub. write must send raw to every connected client and is
// called with a stream lock held (keep it free of hub calls). A nil write
// makes Publish record frames without sending them (tests).
func NewHub(cfg Config, write func(raw []byte)) *Hub {
	if cfg.MaxFrames <= 0 {
		cfg.MaxFrames = DefaultMaxFrames
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = DefaultMaxBytes
	}
	if write == nil {
		write = func([]byte) {}
	}
	return &Hub{
		boot:          randomBootID(),
		cfg:           cfg,
		write:         write,
		sessions:      map[string]*sessionStreams{},
		epochSessions: map[Epoch]map[string]struct{}{},
		live:          map[Epoch]struct{}{},
		Provenance:    NewRegistry(0),
	}
}

// randomBootID returns 8 hex chars of crypto randomness ("boot" if the
// system RNG fails — epochs then stay unique within this process only).
func randomBootID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "boot"
	}
	return hex.EncodeToString(b[:])
}

// NewEpoch hands out a fresh epoch for a runtime about to spawn.
// Every frame that runtime relays should be published under it, and
// DropEpoch must be called when the runtime is disposed.
func (h *Hub) NewEpoch() Epoch {
	e := Epoch(fmt.Sprintf("%s.%d", h.boot, h.counter.Add(1)))
	h.mu.Lock()
	h.live[e] = struct{}{}
	h.mu.Unlock()
	return e
}

// streamFor returns (creating if needed) the stream for (sessionID, epoch).
// Returns nil when the epoch is unknown or already dropped.
func (h *Hub) streamFor(sessionID string, epoch Epoch) *stream {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.live[epoch]; !ok {
		return nil
	}
	ss := h.sessions[sessionID]
	if ss == nil {
		ss = &sessionStreams{byEpoch: map[Epoch]*stream{}}
		h.sessions[sessionID] = ss
	}
	st := ss.byEpoch[epoch]
	if st == nil {
		st = &stream{
			created: h.counter.Add(1),
			ring:    newFrameRing(h.cfg.MaxFrames, h.cfg.MaxBytes),
		}
		ss.byEpoch[epoch] = st
		if h.epochSessions[epoch] == nil {
			h.epochSessions[epoch] = map[string]struct{}{}
		}
		h.epochSessions[epoch][sessionID] = struct{}{}
	}
	return st
}

// Publish stamps msg with `epoch` + the stream's next `seq`, retains the
// encoded frame in the ring and writes it to every client — all under the
// stream lock, so clients see one global order per stream.
//
// msg is mutated (epoch/seq keys added). An empty sessionID, a zero epoch, or
// an epoch already dropped (a late frame from a disposed runtime) is written
// unstamped and not retained, exactly like the pre-seq relay.
// Returns the assigned seq, or 0 when the frame went out unstamped or could
// not be encoded (nothing is written then).
func (h *Hub) Publish(sessionID string, epoch Epoch, msg map[string]any) int64 {
	var st *stream
	if sessionID != "" && epoch != "" {
		st = h.streamFor(sessionID, epoch)
	}
	if st == nil {
		h.writeUnstamped(msg)
		return 0
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.dropped {
		h.writeUnstamped(msg)
		return 0
	}
	seq := st.seq + 1
	msg["epoch"] = string(epoch)
	msg["seq"] = seq
	raw, err := json.Marshal(msg)
	if err != nil {
		return 0
	}
	st.seq = seq
	st.ring.push(seq, raw)
	h.write(raw)
	return seq
}

// writeUnstamped encodes and fans out msg without a stream position.
// Encoding failures drop the frame (same as the legacy broadcast).
func (h *Hub) writeUnstamped(msg map[string]any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.write(raw)
}

// BindPrimary records that `epoch` is the runtime whose own session is
// sessionID (as opposed to a session it merely hosts). Pool-focus frames and
// get_state snapshots use this epoch. No-op for empty arguments.
func (h *Hub) BindPrimary(sessionID string, epoch Epoch) {
	if sessionID == "" || epoch == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.live[epoch]; !ok {
		return
	}
	ss := h.sessions[sessionID]
	if ss == nil {
		ss = &sessionStreams{byEpoch: map[Epoch]*stream{}}
		h.sessions[sessionID] = ss
	}
	ss.primary = epoch
	// Index the binding so DropEpoch clears it even before the first frame.
	if h.epochSessions[epoch] == nil {
		h.epochSessions[epoch] = map[string]struct{}{}
	}
	h.epochSessions[epoch][sessionID] = struct{}{}
}

// PrimaryEpoch returns the epoch bound by BindPrimary, or "" when the session
// has no live runtime of its own.
func (h *Hub) PrimaryEpoch(sessionID string) Epoch {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ss := h.sessions[sessionID]; ss != nil {
		return ss.primary
	}
	return ""
}

// snapshotEpochLocked picks the epoch a snapshot of sessionID should report:
// the primary when bound, else the newest live stream. Caller holds h.mu.
// Returns ("", nil) when the session has no live stream.
func (h *Hub) snapshotEpochLocked(sessionID string) (Epoch, *stream) {
	ss := h.sessions[sessionID]
	if ss == nil {
		return "", nil
	}
	if st := ss.byEpoch[ss.primary]; ss.primary != "" && st != nil {
		return ss.primary, st
	}
	var best Epoch
	var bestSt *stream
	for e, st := range ss.byEpoch {
		if bestSt == nil || st.created > bestSt.created {
			best, bestSt = e, st
		}
	}
	return best, bestSt
}

// WithHead runs fn with the session's snapshot epoch and its current head
// seq, holding that stream's lock so a snapshot written inside fn is ordered
// against live frames of the same stream. fn gets ("", 0) when the session
// has no live stream. fn must not call back into the hub.
func (h *Hub) WithHead(sessionID string, fn func(epoch Epoch, headSeq int64)) {
	h.mu.Lock()
	epoch, st := h.snapshotEpochLocked(sessionID)
	h.mu.Unlock()
	if st == nil {
		fn("", 0)
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.dropped {
		fn("", 0)
		return
	}
	fn(epoch, st.seq)
}

// DropEpoch forgets every stream fed by epoch (its runtime was disposed) and
// releases their rings. Later Publish calls with it go out unstamped, and a
// resync naming it answers epoch_mismatch. Safe to call more than once.
func (h *Hub) DropEpoch(epoch Epoch) {
	h.mu.Lock()
	delete(h.live, epoch)
	var victims []*stream
	for sessionID := range h.epochSessions[epoch] {
		ss := h.sessions[sessionID]
		if ss == nil {
			continue
		}
		if st := ss.byEpoch[epoch]; st != nil {
			victims = append(victims, st)
		}
		delete(ss.byEpoch, epoch)
		if ss.primary == epoch {
			ss.primary = ""
		}
		if len(ss.byEpoch) == 0 && ss.primary == "" {
			delete(h.sessions, sessionID)
		}
	}
	delete(h.epochSessions, epoch)
	h.mu.Unlock()
	// Mark outside h.mu: a publisher may hold a stream lock during a slow write.
	for _, st := range victims {
		st.mu.Lock()
		st.dropped = true
		st.ring = newFrameRing(1, 1)
		st.mu.Unlock()
	}
}
