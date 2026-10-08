package userterm

import (
	"sort"
	"sync"
)

// maxOutOfOrderOps bounds how many early ops the sequencer parks while waiting
// for a missing seq. The WS read loop dispatches every frame on its own
// goroutine, so reordering spans at most a handful of frames; a gap that grows
// past this means the client skipped a number, and the sequencer jumps over it
// rather than parking input forever.
const maxOutOfOrderOps = 256

// opSequencer applies terminal input / resize ops in the client's seq order.
//
// Why: wsapi.Server.handleWS runs OnClientMessage in a fresh goroutine per
// frame (so a blocking prompt never starves permission replies). Two
// keystrokes sent back to back can therefore reach the terminal in either
// order. The desktop numbers every input/resize per terminal (1, 2, 3, …) and
// this type restores that order. Ops run under the sequencer lock, which also
// serializes PTY writes.
type opSequencer struct {
	// mu guards next / parked and serializes op execution.
	mu sync.Mutex
	// next is the seq the sequencer will run next (starts at 1).
	next uint64
	// parked holds ops that arrived before their predecessors, keyed by seq.
	parked map[uint64]func()
}

// newOpSequencer returns a sequencer expecting seq 1 first.
func newOpSequencer() *opSequencer {
	return &opSequencer{next: 1, parked: make(map[uint64]func())}
}

// submit runs op in order.
//
// @param seq The client's per-terminal sequence number. 0 means "unordered":
// the op runs immediately (still serialized with other ops). A seq below the
// next expected one is a duplicate / replay and is dropped.
// @param op The work to run (PTY write / resize). Must not call submit.
// @returns How many ops ran during this call (0 when op was parked or dropped).
func (s *opSequencer) submit(seq uint64, op func()) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq == 0 {
		op()
		return 1
	}
	if seq < s.next {
		return 0
	}
	s.parked[seq] = op
	if len(s.parked) > maxOutOfOrderOps {
		// A seq went missing for good: resume from the oldest parked op.
		s.next = smallestKey(s.parked)
	}
	ran := 0
	for {
		ready, ok := s.parked[s.next]
		if !ok {
			return ran
		}
		delete(s.parked, s.next)
		s.next++
		ready()
		ran++
	}
}

// smallestKey returns the lowest key of a non-empty map.
//
// @param m Parked ops; must not be empty (the caller just inserted one).
// @returns The minimum seq present.
func smallestKey(m map[uint64]func()) uint64 {
	keys := make([]uint64, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	return keys[0]
}
