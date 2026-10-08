package sessionstream

import "encoding/json"

// ringEntry is one retained frame: its stream sequence number and the exact
// JSON bytes that were written to the clients (replayed verbatim on resync).
type ringEntry struct {
	seq int64
	raw []byte
}

// frameRing is a bounded, oldest-first window over one stream's recent frames.
//
// Retained seqs are always contiguous: `floor` is the highest seq that is no
// longer retained (0 while nothing has been dropped), so a client whose last
// seen seq is >= floor can be caught up from the ring and anything older is
// "too old". Not safe for concurrent use; the owning stream's lock guards it.
type frameRing struct {
	// entries holds retained frames; live data is entries[start:].
	entries []ringEntry
	// start is the index of the oldest live entry (amortized compaction).
	start int
	// bytes is the summed len(raw) of live entries.
	bytes int
	// floor is the highest seq no longer retained (0 = nothing evicted yet).
	floor int64
	// maxFrames caps the live entry count (>= 1).
	maxFrames int
	// maxBytes caps the summed frame bytes (>= 1).
	maxBytes int
}

// newFrameRing builds an empty ring with the given bounds.
// Non-positive bounds are clamped to 1 so the ring can always hold the newest
// frame; callers pass validated Config values.
func newFrameRing(maxFrames, maxBytes int) *frameRing {
	if maxFrames < 1 {
		maxFrames = 1
	}
	if maxBytes < 1 {
		maxBytes = 1
	}
	return &frameRing{maxFrames: maxFrames, maxBytes: maxBytes}
}

// live returns the number of retained frames.
func (r *frameRing) live() int { return len(r.entries) - r.start }

// push retains frame `seq` (callers push strictly increasing seqs) and evicts
// the oldest frames until both bounds hold again.
//
// A single frame larger than maxBytes is not retained at all: everything up
// to and including it becomes unavailable (floor = seq) so the retained
// window never has a hole in the middle.
func (r *frameRing) push(seq int64, raw []byte) {
	if len(raw) > r.maxBytes {
		r.entries = nil
		r.start = 0
		r.bytes = 0
		r.floor = seq
		return
	}
	r.entries = append(r.entries, ringEntry{seq: seq, raw: raw})
	r.bytes += len(raw)
	for r.live() > r.maxFrames || r.bytes > r.maxBytes {
		oldest := r.entries[r.start]
		r.entries[r.start] = ringEntry{} // release the bytes for GC
		r.start++
		r.bytes -= len(oldest.raw)
		r.floor = oldest.seq
	}
	// Compact once the dead prefix dominates so the backing array stays bounded.
	if r.start > 0 && r.start*2 >= len(r.entries) {
		r.entries = append([]ringEntry(nil), r.entries[r.start:]...)
		r.start = 0
	}
}

// since returns the retained frames with seq > fromSeq, oldest first.
// ok is false when frames after fromSeq were already evicted (fromSeq < floor),
// i.e. the caller is too far behind and must fall back to a full hydrate.
// An empty slice with ok true means the caller is already current.
func (r *frameRing) since(fromSeq int64) (frames []json.RawMessage, ok bool) {
	if fromSeq < r.floor {
		return nil, false
	}
	frames = []json.RawMessage{}
	for _, e := range r.entries[r.start:] {
		if e.seq > fromSeq {
			frames = append(frames, json.RawMessage(e.raw))
		}
	}
	return frames, true
}

// oldestSeq returns the seq of the oldest retained frame, or 0 when empty.
func (r *frameRing) oldestSeq() int64 {
	if r.live() == 0 {
		return 0
	}
	return r.entries[r.start].seq
}
